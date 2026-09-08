//! 终端 shell profile 探测与白名单解析。
//!
//! 前端设置里选择的是 profile id（如 `"pwsh"`、`"git-bash"`）；把 id
//! 解析成可执行文件路径只发生在这一层。`pty_open` 只接收 id，webview
//! 无法借此拉起白名单之外的任意程序。
//!
//! - Windows：PATH + 已知安装路径探测（PowerShell 7 / Windows
//!   PowerShell / CMD / Git Bash / Nushell / Cygwin），探测顺序即设置
//!   界面的展示顺序；
//! - unix：passwd 登录 shell（或 `$SHELL`）+ `/etc/shells` 去重。
//!
//! `windows_shell_path()`（auto 顺序：pwsh → PowerShell 5 → cmd）同时
//! 被一次性命令（`shell_run_command`）用作无头 shell 选择，auto 语义
//! 与历史行为保持完全一致。

use std::path::{Path, PathBuf};

use serde::Serialize;

/// 本地（非 WSL / 非 SSH）交互 shell 的类别，决定 pty 启动参数与
/// shell 集成的注入方式。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShellKind {
    Powershell,
    Cmd,
    Zsh,
    Bash,
    Fish,
    Other,
}

impl ShellKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ShellKind::Powershell => "powershell",
            ShellKind::Cmd => "cmd",
            ShellKind::Zsh => "zsh",
            ShellKind::Bash => "bash",
            ShellKind::Fish => "fish",
            ShellKind::Other => "other",
        }
    }

    /// 按可执行文件名（含扩展名）推断类别。未知程序一律 Other：
    /// 无集成脚本、不附加参数。
    pub fn from_program(program: &Path) -> ShellKind {
        match program
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .as_deref()
        {
            Some("pwsh.exe" | "pwsh" | "powershell.exe") => ShellKind::Powershell,
            Some("cmd.exe") => ShellKind::Cmd,
            Some("bash.exe" | "bash") => ShellKind::Bash,
            Some("zsh" | "zsh.exe") => ShellKind::Zsh,
            Some("fish" | "fish.exe") => ShellKind::Fish,
            _ => ShellKind::Other,
        }
    }
}

/// 探测到的终端 shell profile（对齐前端 `ShellProfileInfo`）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
    pub id: String,
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
    pub kind: String,
}

/// 全量探测本机可用的 shell profile。探测只是几十次 stat，同步返回
/// 即可。只返回存在的条目，顺序即设置界面的展示顺序。
pub fn detected_profiles() -> Vec<ShellProfile> {
    #[cfg(windows)]
    {
        detected_profiles_windows()
    }
    #[cfg(unix)]
    {
        detected_profiles_unix()
    }
    #[cfg(not(any(windows, unix)))]
    {
        Vec::new()
    }
}

fn make_profile(id: &str, name: &str, program: PathBuf, kind: ShellKind) -> ShellProfile {
    ShellProfile {
        id: id.to_string(),
        name: name.to_string(),
        program: program.to_string_lossy().into_owned(),
        args: Vec::new(),
        kind: kind.as_str().to_string(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Windows
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub fn detected_profiles_windows() -> Vec<ShellProfile> {
    let mut out = Vec::new();
    if let Some(p) = find_pwsh() {
        out.push(make_profile("pwsh", "PowerShell 7", p, ShellKind::Powershell));
    }
    if let Some(p) = find_windows_powershell() {
        out.push(make_profile(
            "powershell",
            "Windows PowerShell",
            p,
            ShellKind::Powershell,
        ));
    }
    if let Some(p) = find_cmd() {
        out.push(make_profile("cmd", "CMD", p, ShellKind::Cmd));
    }
    if let Some(p) = find_git_bash() {
        out.push(make_profile("git-bash", "Git Bash", p, ShellKind::Bash));
    }
    if let Some(p) = which_in_path("nu.exe") {
        out.push(make_profile("nu", "Nushell", p, ShellKind::Other));
    }
    if let Some(p) = find_cygwin_bash() {
        out.push(make_profile("cygwin-bash", "Cygwin Bash", p, ShellKind::Bash));
    }
    out
}

/// 本地交互 shell 的 id 解析：id 缺失 / `"auto"` / 未命中白名单时一律
/// 回退 auto 选择，保证 pty_open 永远能拉起一个可用的 shell。
#[cfg(windows)]
pub struct ResolvedLocalShell {
    /// 命中的 profile id；回退时为 `"auto"`（供日志定位）。
    pub id: String,
    pub program: PathBuf,
    pub kind: ShellKind,
}

#[cfg(windows)]
pub fn resolve_local_shell(shell_id: Option<&str>) -> ResolvedLocalShell {
    let auto = || {
        let program = windows_shell_path();
        ResolvedLocalShell {
            id: "auto".to_string(),
            kind: ShellKind::from_program(&program),
            program,
        }
    };
    let id = match shell_id {
        None | Some("") | Some("auto") => return auto(),
        Some(other) => other,
    };
    match detected_profiles_windows()
        .into_iter()
        .find(|p| p.id == id)
    {
        Some(profile) => {
            let program = PathBuf::from(&profile.program);
            let kind = ShellKind::from_program(&program);
            ResolvedLocalShell {
                id: profile.id,
                program,
                kind,
            }
        }
        None => {
            log::warn!("shell profile '{id}' not found, falling back to auto");
            auto()
        }
    }
}

/// Windows 本地 shell 的选择:优先 PowerShell 7,回退 Windows
/// 自带的 PowerShell 5,最后兜底 cmd.exe。
#[cfg(windows)]
pub fn windows_shell_path() -> PathBuf {
    windows_shell_path_from(
        which_in_path("pwsh.exe"),
        std::env::var_os("ProgramFiles").map(PathBuf::from),
        std::env::var_os("SystemRoot").map(PathBuf::from),
    )
}

/// `windows_shell_path` 的纯逻辑版本，注入探测结果以便测试。
#[cfg(windows)]
fn windows_shell_path_from(
    path_hit: Option<PathBuf>,
    program_files: Option<PathBuf>,
    system_root: Option<PathBuf>,
) -> PathBuf {
    if let Some(p) = path_hit {
        return p;
    }

    if let Some(candidate) = program_files
        .map(|pf| pf.join("PowerShell").join("7").join("pwsh.exe"))
    {
        if candidate.is_file() {
            return candidate;
        }
    }

    let system32 = system_root
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32");
    let ps5 = system32
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if ps5.is_file() {
        return ps5;
    }

    system32.join("cmd.exe")
}

#[cfg(windows)]
fn first_existing(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|p| p.is_file())
}

#[cfg(windows)]
fn find_pwsh() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(hit) = which_in_path("pwsh.exe") {
        candidates.push(hit);
    }
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        let pf = PathBuf::from(pf);
        candidates.push(pf.join("PowerShell").join("7").join("pwsh.exe"));
        candidates.push(pf.join("PowerShell").join("7-preview").join("pwsh.exe"));
    }
    if let Some(lapp) = std::env::var_os("LocalAppData") {
        candidates.push(
            PathBuf::from(lapp)
                .join("Microsoft")
                .join("WindowsApps")
                .join("pwsh.exe"),
        );
    }
    first_existing(candidates)
}

#[cfg(windows)]
fn system32_dir() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
}

#[cfg(windows)]
fn find_windows_powershell() -> Option<PathBuf> {
    let ps5 = system32_dir()
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    ps5.is_file().then_some(ps5)
}

#[cfg(windows)]
fn find_cmd() -> Option<PathBuf> {
    let cmd = system32_dir().join("cmd.exe");
    cmd.is_file().then_some(cmd)
}

#[cfg(windows)]
fn find_git_bash() -> Option<PathBuf> {
    let bases: Vec<PathBuf> = [
        std::env::var_os("ProgramFiles").map(PathBuf::from),
        std::env::var_os("ProgramFiles(x86)").map(PathBuf::from),
        std::env::var_os("LocalAppData").map(|v| PathBuf::from(v).join("Programs")),
    ]
    .into_iter()
    .flatten()
    .collect();
    let candidates = bases
        .into_iter()
        .map(|base| base.join("Git").join("bin").join("bash.exe"))
        .collect();
    first_existing(candidates)
}

#[cfg(windows)]
fn find_cygwin_bash() -> Option<PathBuf> {
    let system_drive = std::env::var_os("SystemDrive").unwrap_or_else(|| "C:".into());
    let base = PathBuf::from(system_drive);
    first_existing(vec![
        base.join("cygwin64").join("bin").join("bash.exe"),
        base.join("cygwin").join("bin").join("bash.exe"),
    ])
}

#[cfg(windows)]
fn which_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

// ──────────────────────────────────────────────────────────────────────────
// unix
// ──────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
pub fn detected_profiles_unix() -> Vec<ShellProfile> {
    let mut programs: Vec<String> = Vec::new();
    if let Some(login) = login_shell_from_passwd() {
        programs.push(login);
    }
    if let Ok(env_shell) = std::env::var("SHELL") {
        programs.push(env_shell);
    }
    programs.extend(etc_shells());

    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for program in programs {
        let path = PathBuf::from(&program);
        if !path.is_file() || seen.contains(&program) {
            continue;
        }
        seen.push(program);
        let base = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("shell")
            .to_string();
        let name = capitalize(&base);
        let kind = ShellKind::from_program(&path);
        out.push(make_profile(&base, &name, path, kind));
    }
    out
}

/// auto 选择：passwd 登录 shell → `$SHELL`。与 pty 侧 unix 构建共享。
#[cfg(unix)]
pub fn default_unix_shell_program() -> Option<String> {
    login_shell_from_passwd()
        .or_else(|| std::env::var("SHELL").ok())
        .filter(|s| !s.is_empty())
}

/// 显式 profile id → 程序路径；未命中返回 None（调用方回退 auto）。
#[cfg(unix)]
pub fn resolve_unix_shell_program(id: &str) -> Option<String> {
    detected_profiles_unix()
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.program)
}

#[cfg(unix)]
fn login_shell_from_passwd() -> Option<String> {
    use std::ffi::CStr;
    unsafe {
        let uid = libc::getuid();
        let pw = libc::getpwuid(uid);
        if pw.is_null() {
            return None;
        }
        let shell_ptr = (*pw).pw_shell;
        if shell_ptr.is_null() {
            return None;
        }
        CStr::from_ptr(shell_ptr).to_str().ok().map(String::from)
    }
}

#[cfg(unix)]
fn etc_shells() -> Vec<String> {
    match std::fs::read_to_string("/etc/shells") {
        Ok(content) => parse_etc_shells(&content),
        Err(_) => Vec::new(),
    }
}

#[cfg(unix)]
fn parse_etc_shells(content: &str) -> Vec<String> {
    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_string)
        .collect()
}

#[cfg(unix)]
fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// tests
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // `Path::file_name` 在不同平台的拆分规则不同:Windows 认 `\` 和 `/`,
    // unix 只认 `/`。所以 Windows 路径断言只在 windows 编译目标下跑,
    // unix 路径断言只在 unix 目标下跑 —— 否则反斜杠路径会被当成一个
    // 超长文件名,case 全部 fallthrough 到 Other,linux CI 会因此红。
    #[cfg(windows)]
    #[test]
    fn kind_from_program_detects_windows_shells() {
        assert_eq!(
            ShellKind::from_program(Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe")),
            ShellKind::Powershell
        );
        assert_eq!(
            ShellKind::from_program(Path::new(r"C:\Windows\System32\cmd.exe")),
            ShellKind::Cmd
        );
        assert_eq!(
            ShellKind::from_program(Path::new(r"C:\Program Files\Git\bin\bash.exe")),
            ShellKind::Bash
        );
    }

    #[cfg(unix)]
    #[test]
    fn kind_from_program_detects_unix_shells() {
        assert_eq!(
            ShellKind::from_program(Path::new("/bin/zsh")),
            ShellKind::Zsh
        );
        assert_eq!(
            ShellKind::from_program(Path::new("/usr/bin/fish")),
            ShellKind::Fish
        );
        assert_eq!(
            ShellKind::from_program(Path::new("/usr/bin/nu")),
            ShellKind::Other
        );
    }

    #[test]
    fn kind_strings_are_stable() {
        assert_eq!(ShellKind::Powershell.as_str(), "powershell");
        assert_eq!(ShellKind::Cmd.as_str(), "cmd");
        assert_eq!(ShellKind::Zsh.as_str(), "zsh");
        assert_eq!(ShellKind::Bash.as_str(), "bash");
        assert_eq!(ShellKind::Fish.as_str(), "fish");
        assert_eq!(ShellKind::Other.as_str(), "other");
    }

    #[cfg(unix)]
    #[test]
    fn parse_etc_shells_skips_comments_and_blanks() {
        let parsed = parse_etc_shells("# comment\n/bin/bash\n\n  /usr/bin/zsh  \n/bin/sh\n");
        assert_eq!(parsed, vec!["/bin/bash", "/usr/bin/zsh", "/bin/sh"]);
    }

    #[cfg(unix)]
    #[test]
    fn capitalize_uppercases_first_char_only() {
        assert_eq!(capitalize("bash"), "Bash");
        assert_eq!(capitalize("zsh"), "Zsh");
        assert_eq!(capitalize(""), "");
    }

    #[cfg(windows)]
    #[test]
    fn auto_shell_order_prefers_path_hit() {
        let hit = PathBuf::from(r"C:\tools\pwsh.exe");
        assert_eq!(
            windows_shell_path_from(
                Some(hit.clone()),
                Some(PathBuf::from(r"C:\PF")),
                Some(PathBuf::from(r"C:\Windows"))
            ),
            hit
        );
    }

    #[cfg(windows)]
    #[test]
    fn auto_shell_falls_through_to_cmd_when_nothing_exists() {
        assert_eq!(
            windows_shell_path_from(
                None,
                Some(PathBuf::from(r"C:\definitely-missing-pf")),
                Some(PathBuf::from(r"C:\definitely-missing-root"))
            ),
            PathBuf::from(r"C:\definitely-missing-root\System32\cmd.exe")
        );
    }

    #[cfg(windows)]
    #[test]
    fn auto_shell_picks_pwsh7_when_installed() {
        let pf = tempfile::tempdir().expect("tempdir");
        let pwsh7 = pf.path().join("PowerShell").join("7").join("pwsh.exe");
        std::fs::create_dir_all(pwsh7.parent().unwrap()).expect("mkdir");
        std::fs::write(&pwsh7, b"").expect("touch");
        assert_eq!(
            windows_shell_path_from(None, Some(pf.path().to_path_buf()), None),
            pwsh7
        );
    }

    #[cfg(windows)]
    #[test]
    fn first_existing_returns_first_hit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let hit = dir.path().join("b.exe");
        std::fs::write(&hit, b"").expect("touch");
        assert_eq!(
            first_existing(vec![dir.path().join("a.exe"), hit.clone()]),
            Some(hit)
        );
        assert_eq!(first_existing(vec![dir.path().join("a.exe")]), None);
    }

    #[cfg(windows)]
    #[test]
    fn resolve_local_shell_falls_back_to_auto_on_unknown_id() {
        let resolved = resolve_local_shell(Some("definitely-not-a-shell"));
        assert_eq!(resolved.id, "auto");
    }

    #[cfg(windows)]
    #[test]
    fn resolve_local_shell_treats_missing_and_auto_as_auto() {
        assert_eq!(resolve_local_shell(None).id, "auto");
        assert_eq!(resolve_local_shell(Some("auto")).id, "auto");
        assert_eq!(resolve_local_shell(Some("")).id, "auto");
    }

    #[cfg(windows)]
    #[test]
    fn resolve_local_shell_resolves_whitelisted_id() {
        let detected = detected_profiles_windows();
        // auto 的第一个候选必须同时在探测列表里（同源探测），因此
        // "pwsh" 存在时解析结果就是它的真实路径。
        if let Some(expected) = detected.iter().find(|p| p.id == "pwsh") {
            let resolved = resolve_local_shell(Some("pwsh"));
            assert_eq!(resolved.id, "pwsh");
            assert_eq!(resolved.program, PathBuf::from(&expected.program));
        }
    }
}
