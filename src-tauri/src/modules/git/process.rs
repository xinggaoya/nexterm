use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use shared_child::SharedChild;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::types::{
    GitOutput, TextSource, DEFAULT_TIMEOUT_SECS, MAX_FILE_BYTES, MAX_OUTPUT_BYTES,
    MAX_TIMEOUT_SECS, MIN_GIT_VERSION,
};
use crate::modules::process::{drain_limited, suppress_command_window, wait_with_timeout, WaitFailure};
#[cfg(windows)]
use crate::modules::workspace::validate_wsl_distro_name;
use crate::modules::workspace::WorkspaceEnv;

#[derive(Clone)]
enum Availability {
    Ok,
    NotInstalled,
    TooOld(String),
}

const AVAILABILITY_TTL: Duration = Duration::from_secs(60);

struct AvailabilityCache {
    value: Availability,
    checked_at: Instant,
}

static GIT_AVAILABILITY: OnceLock<Mutex<HashMap<String, AvailabilityCache>>> = OnceLock::new();

fn availability_cell() -> &'static Mutex<HashMap<String, AvailabilityCache>> {
    GIT_AVAILABILITY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune_expired_availability_entries(cache: &mut HashMap<String, AvailabilityCache>) {
    cache.retain(|_, entry| entry.checked_at.elapsed() < AVAILABILITY_TTL);
}

fn workspace_cache_key(workspace: &WorkspaceEnv) -> String {
    match workspace {
        WorkspaceEnv::Local => "local".into(),
        WorkspaceEnv::Wsl { distro } => format!("wsl:{distro}"),
        WorkspaceEnv::Ssh { profile_id } => format!("ssh:{profile_id}"),
    }
}

pub fn ensure_git_available(workspace: &WorkspaceEnv) -> Result<()> {
    let cache_key = workspace_cache_key(workspace);
    let cached = match availability_cell().lock() {
        Ok(mut guard) => {
            prune_expired_availability_entries(&mut guard);
            guard
                .get(&cache_key)
                .filter(|entry| entry.checked_at.elapsed() < AVAILABILITY_TTL)
                .map(|entry| entry.value.clone())
        }
        // A poisoned cache means an earlier panic — treat the cache as empty
        // and fall through to a fresh probe rather than aborting the IPC
        // handler. The probe itself runs `git --version`, which is the
        // authoritative source either way.
        Err(error) => {
            log::warn!("git availability cache poisoned; falling back to a fresh probe: {error}");
            None
        }
    };
    let value = match cached {
        Some(v) => v,
        None => {
            let fresh = check_git_availability(workspace);
            if let Ok(mut guard) = availability_cell().lock() {
                prune_expired_availability_entries(&mut guard);
                guard.insert(
                    cache_key,
                    AvailabilityCache {
                        value: fresh.clone(),
                        checked_at: Instant::now(),
                    },
                );
            }
            fresh
        }
    };
    match value {
        Availability::Ok => Ok(()),
        Availability::NotInstalled => Err(GitError::NotInstalled),
        Availability::TooOld(v) => Err(GitError::TooOld {
            found: v,
            required: MIN_GIT_VERSION,
        }),
    }
}

fn check_git_availability(workspace: &WorkspaceEnv) -> Availability {
    let output = match run_git_uncached(workspace, None, ["--version"], 10) {
        Ok(o) => o,
        Err(_) => return Availability::NotInstalled,
    };
    if output.timed_out || output.exit_code != Some(0) {
        return Availability::NotInstalled;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = parse_git_version(stdout.trim()).unwrap_or_else(|| "unknown".into());
    if !version_meets_minimum(&version, MIN_GIT_VERSION) {
        return Availability::TooOld(version);
    }
    Availability::Ok
}

fn parse_git_version(line: &str) -> Option<String> {
    line.split_whitespace()
        .find(|tok| tok.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(|s| s.split('.').take(3).collect::<Vec<_>>().join("."))
}

fn version_meets_minimum(found: &str, required: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.split('.')
            .map(|p| p.parse::<u32>().unwrap_or(0))
            .collect()
    };
    let f = parse(found);
    let r = parse(required);
    for (i, &b) in r.iter().enumerate() {
        let a = f.get(i).copied().unwrap_or(0);
        if a > b {
            return true;
        }
        if a < b {
            return false;
        }
    }
    true
}

pub fn git_show_text(workspace: &WorkspaceEnv, repo_root: &str, spec: &str) -> Result<TextSource> {
    let output = run_git(
        workspace,
        Some(repo_root),
        [
            OsStr::new("show"),
            OsStr::new("--no-textconv"),
            OsStr::new(spec),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git show"));
    }
    if output.exit_code != Some(0) {
        return Ok(TextSource::Missing);
    }
    Ok(decode_text(output.stdout))
}

pub fn git_stdout_line_opt<I, S>(
    workspace: &WorkspaceEnv,
    cwd: &str,
    args: I,
) -> Result<Option<String>>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = run_git(workspace, Some(cwd), args, DEFAULT_TIMEOUT_SECS)?;
    if output.timed_out {
        return Err(GitError::TimedOut("git command"));
    }
    if output.exit_code != Some(0) {
        return Ok(None);
    }
    let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
    let line = stdout.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        Ok(None)
    } else {
        Ok(Some(line.to_string()))
    }
}

/// Run git, returning multiple stdout lines (UTF-8). Empty trailing lines stripped.
pub fn git_stdout_lines<I, S>(workspace: &WorkspaceEnv, cwd: &str, args: I) -> Result<Vec<String>>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = run_git(workspace, Some(cwd), args, DEFAULT_TIMEOUT_SECS)?;
    if output.timed_out {
        return Err(GitError::TimedOut("git command"));
    }
    if output.exit_code != Some(0) {
        return Ok(Vec::new());
    }
    let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
    Ok(stdout
        .lines()
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect())
}

pub fn read_text_file(path: &Path) -> Result<TextSource> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(TextSource::Missing),
        Err(e) => return Err(GitError::Io(e)),
    };
    if meta.file_type().is_symlink() {
        return Err(GitError::SymlinkRejected(path.to_path_buf()));
    }
    if !meta.is_file() {
        return Ok(TextSource::Missing);
    }
    let size = meta.len();
    if size > MAX_FILE_BYTES {
        return Err(GitError::FileTooLarge {
            path: path.to_path_buf(),
            size,
            max: MAX_FILE_BYTES,
        });
    }
    let bytes = std::fs::read(path)?;
    Ok(decode_text(bytes))
}

pub fn run_git<I, S>(
    workspace: &WorkspaceEnv,
    cwd: Option<&str>,
    args: I,
    timeout_secs: u64,
) -> Result<GitOutput>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_git_uncached(workspace, cwd, args, timeout_secs)
}

fn run_git_uncached<I, S>(
    workspace: &WorkspaceEnv,
    cwd: Option<&str>,
    args: I,
    timeout_secs: u64,
) -> Result<GitOutput>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let dur = Duration::from_secs(timeout_secs.clamp(1, MAX_TIMEOUT_SECS));
    let args: Vec<OsString> = args
        .into_iter()
        .map(|arg| arg.as_ref().to_os_string())
        .collect();

    // agent 优先:WSL 下所有 git 命令经常驻 agent 执行,省掉每次
    // `wsl.exe` 进程 spawn;agent 不可用或失败时落回 legacy 路径。
    #[cfg(windows)]
    if let WorkspaceEnv::Wsl { distro } = workspace {
        match run_git_via_agent(distro, cwd, &args, dur) {
            Some(output) => return Ok(output),
            None => log::debug!("agent git exec unavailable; falling back to wsl.exe"),
        }
    }

    // SSH 工作区:git 经 SSH 通道上的远端 agent 执行(Phase 2)。
    if let WorkspaceEnv::Ssh { profile_id } = workspace {
        return run_git_via_remote_agent(profile_id, cwd, &args, dur);
    }

    let mut cmd = build_git_command(workspace, cwd, &args)?;
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "")
        .env("SSH_ASKPASS", "")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("GCM_PROVIDER", "")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| GitError::Spawn(e.to_string()))?);
    let mut stdout_pipe = child
        .take_stdout()
        .ok_or_else(|| GitError::Spawn("no stdout pipe".into()))?;
    let mut stderr_pipe = child
        .take_stderr()
        .ok_or_else(|| GitError::Spawn("no stderr pipe".into()))?;

    // stdout 常见为结构化输出(64KB 预分配),stderr 多为短消息(4KB)。
    let stdout_handle =
        thread::spawn(move || drain_limited(&mut stdout_pipe, MAX_OUTPUT_BYTES, 16 * 1024, 64 * 1024));
    let stderr_handle =
        thread::spawn(move || drain_limited(&mut stderr_pipe, MAX_OUTPUT_BYTES, 16 * 1024, 4 * 1024));

    let (exit_code, timed_out) = match wait_with_timeout(&child, dur) {
        Ok(result) => result,
        Err(WaitFailure::Io(e)) => return Err(GitError::Io(e)),
        Err(WaitFailure::Disconnected) => {
            return Err(GitError::Spawn("git wait thread disconnected".into()));
        }
    };

    let (stdout, stdout_truncated) = stdout_handle.join().unwrap_or((Vec::new(), false));
    let (stderr, _stderr_truncated) = stderr_handle.join().unwrap_or((Vec::new(), false));

    Ok(GitOutput {
        stdout,
        stderr,
        exit_code,
        timed_out,
        truncated: stdout_truncated,
    })
}

/// SSH 工作区的 git 执行。同步上下文内等待异步远端操作:经
/// async_runtime::spawn + mpsc 桥接,超时上限 = git 业务超时 + 传输余量。
fn run_git_via_remote_agent(
    profile_id: &str,
    cwd: Option<&str>,
    args: &[OsString],
    timeout: Duration,
) -> Result<GitOutput> {
    // JSON 协议只收 UTF-8 参数;非 UTF-8 参数在远端 shell 场景同样危险。
    let mut argv = Vec::with_capacity(args.len() + 1);
    argv.push("git".to_string());
    for arg in args {
        argv.push(arg.to_str().map(str::to_string).ok_or_else(|| {
            GitError::command("git over ssh", "non-utf8 argument".to_string())
        })?);
    }
    let profile_id = profile_id.to_string();
    let cwd = cwd.map(str::to_string);
    let (tx, rx) = mpsc::channel();
    tauri::async_runtime::spawn(async move {
        let result = crate::modules::ssh::remote::remote_git_exec(
            &profile_id,
            cwd.as_deref(),
            &argv,
            GIT_AGENT_ENV,
            timeout,
            MAX_OUTPUT_BYTES,
        )
        .await;
        let _ = tx.send(result);
    });
    match rx.recv_timeout(timeout + AGENT_TRANSPORT_GRACE + LEGACY_TRANSPORT_GRACE) {
        Ok(Ok(outcome)) => Ok(GitOutput {
            stdout: outcome.stdout,
            stderr: outcome.stderr,
            exit_code: outcome.exit_code,
            timed_out: outcome.timed_out,
            truncated: outcome.truncated,
        }),
        Ok(Err(error)) => Err(GitError::command("git over ssh", error)),
        Err(_) => Err(GitError::TimedOut("git over ssh")),
    }
}

fn build_git_command(
    _workspace: &WorkspaceEnv,
    cwd: Option<&str>,
    args: &[OsString],
) -> Result<Command> {
    #[cfg(windows)]
    if let WorkspaceEnv::Wsl { distro } = _workspace {
        validate_wsl_distro_name(distro)
            .map_err(|_| GitError::command("unsafe WSL distro name", distro.clone()))?;
        let mut cmd = Command::new("wsl.exe");
        cmd.arg("-d").arg(distro);
        if let Some(cwd) = cwd.filter(|s| !s.is_empty()) {
            cmd.arg("--cd").arg(cwd);
        }
        cmd.arg("--exec").arg("git");
        cmd.args(args);
        suppress_command_window(&mut cmd);
        return Ok(cmd);
    }

    let mut cmd = Command::new("git");
    cmd.args(args);
    if let Some(dir) = cwd.filter(|s| !s.is_empty()) {
        cmd.current_dir(Path::new(dir));
    }
    suppress_command_window(&mut cmd);
    Ok(cmd)
}

/// agent 传输的 env 覆盖集:与 `run_git_uncached` 给 legacy 命令设的
/// 环境完全一致(wsl.exe 会把它们透传进 Linux 侧 git)。
#[cfg(windows)]
const GIT_AGENT_ENV: &[(&str, &str)] = &[
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GIT_ASKPASS", ""),
    ("SSH_ASKPASS", ""),
    ("GIT_OPTIONAL_LOCKS", "0"),
    ("GCM_INTERACTIVE", "Never"),
    ("GCM_PROVIDER", ""),
    ("LC_ALL", "C"),
];

/// 传输层在业务超时之上再多等的余量,覆盖 agent 往返与 JSON 编解码。
#[cfg(windows)]
const AGENT_TRANSPORT_GRACE: Duration = Duration::from_secs(5);

/// legacy 传输(wsl.exe / SSH 直连)在业务超时之外的兜底余量:该 5s
/// 早于 agent 通道存在,覆盖远端 shell 往返与 JSON 编解码等固定开销,
/// 与 AGENT_TRANSPORT_GRACE 叠加使用。
const LEGACY_TRANSPORT_GRACE: Duration = Duration::from_secs(5);

/// 经常驻 agent 执行 git。返回 `None` 表示 agent 不可用(资产缺失、
/// 熔断、非 UTF-8 参数、agent 报错),调用方应走 legacy 路径。
#[cfg(windows)]
fn run_git_via_agent(
    distro: &str,
    cwd: Option<&str>,
    args: &[OsString],
    timeout: Duration,
) -> Option<GitOutput> {
    let mut argv = Vec::with_capacity(args.len() + 1);
    argv.push("git".to_string());
    for arg in args {
        // JSON 协议只收 UTF-8;含非 UTF-8 参数时交给 legacy 路径处理。
        argv.push(arg.to_str()?.to_string());
    }
    let outcome = crate::modules::agent::exec_simple(
        distro,
        argv,
        cwd.map(str::to_string),
        GIT_AGENT_ENV,
        None,
        timeout + AGENT_TRANSPORT_GRACE,
        MAX_OUTPUT_BYTES,
    )
    .ok()?;
    Some(GitOutput {
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        exit_code: outcome.exit_code,
        timed_out: outcome.timed_out,
        truncated: outcome.truncated,
    })
}

pub fn ensure_success(output: &GitOutput, context: &'static str) -> Result<()> {
    if output.timed_out {
        return Err(GitError::TimedOut(context));
    }
    if output.exit_code == Some(0) {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if let Some(err) = classify_auth_error(&stderr) {
        return Err(err);
    }
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "unknown git error".into()
    };
    Err(GitError::CommandFailed { context, detail })
}

fn classify_auth_error(stderr: &str) -> Option<GitError> {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("could not read username")
        || lower.contains("could not read password")
        || lower.contains("authentication failed")
        || lower.contains("permission denied (publickey)")
        || lower.contains("invalid credentials")
    {
        return Some(GitError::AuthRequired(
            stderr.lines().next().unwrap_or(stderr).to_string(),
        ));
    }
    if lower.contains("host key verification failed") {
        return Some(GitError::HostKeyUnverified);
    }
    None
}

fn decode_text(bytes: Vec<u8>) -> TextSource {
    let sniff_len = bytes.len().min(8192);
    if bytes[..sniff_len].contains(&0) {
        return TextSource::Binary;
    }
    match String::from_utf8(bytes) {
        Ok(text) => TextSource::Text(text),
        Err(e) => TextSource::Text(String::from_utf8_lossy(&e.into_bytes()).into_owned()),
    }
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    use super::build_git_command;
    use super::{
        parse_git_version, prune_expired_availability_entries, version_meets_minimum, Availability,
        AvailabilityCache, AVAILABILITY_TTL,
    };
    #[cfg(windows)]
    use crate::modules::workspace::WorkspaceEnv;
    use std::collections::HashMap;
    #[cfg(windows)]
    use std::ffi::OsString;
    use std::time::{Duration, Instant};

    #[test]
    fn extracts_simple_version() {
        assert_eq!(
            parse_git_version("git version 2.42.0"),
            Some("2.42.0".into())
        );
    }

    #[test]
    fn extracts_apple_version() {
        assert_eq!(
            parse_git_version("git version 2.39.3 (Apple Git-145)"),
            Some("2.39.3".into())
        );
    }

    #[test]
    fn version_compare() {
        assert!(version_meets_minimum("2.23.0", "2.23"));
        assert!(version_meets_minimum("2.40.1", "2.23"));
        assert!(version_meets_minimum("3.0.0", "2.23"));
        assert!(!version_meets_minimum("2.22.0", "2.23"));
        assert!(!version_meets_minimum("1.9.5", "2.23"));
        // patch component must not regress the comparison
        assert!(version_meets_minimum("2.23.5", "2.23.4"));
        assert!(!version_meets_minimum("2.23.3", "2.23.4"));
    }

    #[test]
    fn prunes_expired_workspace_availability_entries() {
        let mut cache = HashMap::from([
            (
                "local".to_string(),
                AvailabilityCache {
                    value: Availability::Ok,
                    checked_at: Instant::now(),
                },
            ),
            (
                "wsl:Ubuntu".to_string(),
                AvailabilityCache {
                    value: Availability::NotInstalled,
                    checked_at: Instant::now() - AVAILABILITY_TTL - Duration::from_secs(1),
                },
            ),
        ]);

        prune_expired_availability_entries(&mut cache);

        assert!(cache.contains_key("local"));
        assert!(!cache.contains_key("wsl:Ubuntu"));
    }

    #[cfg(windows)]
    #[test]
    fn builds_wsl_git_command_with_cd_and_exec() {
        let cmd = build_git_command(
            &WorkspaceEnv::Wsl {
                distro: "Ubuntu".into(),
            },
            Some("/home/vinicios/Nova pasta/repo"),
            &[OsString::from("status"), OsString::from("--short")],
        )
        .expect("valid WSL distro");
        let program = cmd.get_program().to_string_lossy().into_owned();
        let args: Vec<String> = cmd
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(program, "wsl.exe");
        assert_eq!(
            args,
            vec![
                "-d",
                "Ubuntu",
                "--cd",
                "/home/vinicios/Nova pasta/repo",
                "--exec",
                "git",
                "status",
                "--short",
            ]
        );
    }

    #[cfg(windows)]
    #[test]
    fn rejects_unsafe_wsl_distro_name_for_git_command() {
        let err = build_git_command(
            &WorkspaceEnv::Wsl {
                distro: "../Ubuntu".into(),
            },
            None,
            &[],
        )
        .unwrap_err();
        assert!(err.to_string().contains("unsafe WSL distro name"));
    }
}

#[cfg(all(test, windows))]
mod wsl_agent_e2e {
    use super::*;
    use crate::modules::workspace::WorkspaceEnv;

    /// 端到端(需真实 WSL 发行版 `Ubuntu` 与已构建内嵌 musl 资产):
    ///   NEXTERM_AGENT_E2E=1 cargo test --lib wsl_git_via_agent -- --ignored
    /// 覆盖 `run_git_uncached` 的 WSL agent 路由:探针 → agent 安装 →
    /// git init/status 全部经 agent 通道执行。
    #[test]
    #[ignore = "requires real WSL distro; run with NEXTERM_AGENT_E2E=1 --ignored"]
    fn wsl_git_via_agent_roundtrip() {
        assert!(
            crate::modules::agent::install::asset_available(),
            "agent unavailable: build the musl asset and set NEXTERM_AGENT_E2E=1"
        );
        let workspace = WorkspaceEnv::Wsl {
            distro: "Ubuntu".into(),
        };
        crate::modules::git::process::ensure_git_available(&workspace)
            .expect("git availability via agent");

        let repo = format!("/tmp/nexterm-git-e2e-{}", std::process::id());
        // 准备:agent exec 建 repo + 提交一个文件
        for cmd in [
            format!("rm -rf {repo} && mkdir -p {repo} && cd {repo} && git init -q"),
            format!("cd {repo} && printf x > tracked.txt && git add tracked.txt && git -c user.email=t@t -c user.name=t commit -qm init && printf y > untracked.txt"),
        ] {
            let out = std::process::Command::new("wsl.exe")
                .args(["-d", "Ubuntu", "--exec", "sh", "-c", &cmd])
                .output()
                .expect("wsl sh");
            assert!(
                out.status.success(),
                "prep failed: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }

        // 关键验证:status 经 agent 路由,应看到 untracked 文件
        let output = run_git(
            &workspace,
            Some(&repo),
            ["status", "--short"],
            30,
        )
        .expect("git status via agent");
        assert!(!output.timed_out);
        assert_eq!(output.exit_code, Some(0));
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            stdout.contains("?? untracked.txt"),
            "unexpected status output: {stdout}"
        );

        // 清理
        let _ = std::process::Command::new("wsl.exe")
            .args(["-d", "Ubuntu", "--exec", "rm", "-rf", &repo])
            .output();
    }
}
