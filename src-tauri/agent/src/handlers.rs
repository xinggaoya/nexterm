//! method 分发与具体实现。fs 操作用 `std::fs`,任何平台可跑(测试友好);
//! exec 仅在 unix 目标可用 —— agent 本就只为 Linux 构建。

#[cfg(unix)]
use std::io::Read;
#[cfg(unix)]
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
#[cfg(unix)]
use std::time::Instant;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde_json::{json, Value};

use crate::protocol::{
    CopyParams, CreateDirParams, CreateFileParams, DeleteParams, DirEntry, EntryKind, ExecParams,
    ExecResult, GlobParams, GrepParams, ListFilesParams, PingResult, ReadDirParams, ReadDirResult,
    ReadFileParams, ReadFileResult, RenameParams, Request, Response, SearchParams, StatParams,
    StatResult, WriteFileParams,
};

/// fs.readFile 的默认上限。主程序在调用前已用 stat 过滤 10 MiB 以上的文件,
/// 这里留出余量,仅作防 OOM 的最后防线。
pub const DEFAULT_READ_FILE_MAX_BYTES: u64 = 16 * 1024 * 1024;

/// exec 输出的默认上限。git 集成会显式传主程序自己的 `MAX_OUTPUT_BYTES`,
/// 该默认值只兜底。
pub const DEFAULT_EXEC_MAX_OUTPUT_BYTES: usize = 32 * 1024 * 1024;

/// exec 默认超时:无 timeout_ms 参数时兜底,防止子进程挂死拖垮连接。
pub const DEFAULT_EXEC_TIMEOUT: Duration = Duration::from_secs(120);

/// 同时处理的请求上限。超出直接回 error 而不是排队,让客户端尽早走回退。
const MAX_CONCURRENT_WORKERS: usize = 32;

static ACTIVE_WORKERS: AtomicUsize = AtomicUsize::new(0);

/// 处理一条已解析的请求,返回要写回的响应。`serve` 负责调用并写回。
pub fn handle(request: &Request) -> Response {
    if ACTIVE_WORKERS.load(Ordering::Acquire) >= MAX_CONCURRENT_WORKERS {
        return Response::err(request.id, "agent busy: too many in-flight requests");
    }
    ACTIVE_WORKERS.fetch_add(1, Ordering::AcqRel);
    let result = dispatch(&request.method, request.params.clone());
    ACTIVE_WORKERS.fetch_sub(1, Ordering::AcqRel);
    match result {
        Ok(value) => Response::ok(request.id, value),
        Err(error) => Response::err(request.id, error),
    }
}

fn dispatch(method: &str, params: Value) -> Result<Value, String> {
    match method {
        "ping" => Ok(json!(ping())),
        "fs.readDir" => {
            let params: ReadDirParams = parse_params(params)?;
            Ok(json!(fs_read_dir(params)?))
        }
        "fs.stat" => {
            let params: StatParams = parse_params(params)?;
            Ok(json!(fs_stat(params)?))
        }
        "fs.readFile" => {
            let params: ReadFileParams = parse_params(params)?;
            Ok(json!(fs_read_file(params)?))
        }
        "exec" => {
            let params: ExecParams = parse_params(params)?;
            Ok(json!(exec(params)?))
        }
        "fs.writeFile" => {
            let params: WriteFileParams = parse_params(params)?;
            fs_write_file(params)?;
            Ok(json!({}))
        }
        "fs.createFile" => {
            let params: CreateFileParams = parse_params(params)?;
            fs_create_file(params)?;
            Ok(json!({}))
        }
        "fs.createDir" => {
            let params: CreateDirParams = parse_params(params)?;
            fs_create_dir(params)?;
            Ok(json!({}))
        }
        "fs.rename" => {
            let params: RenameParams = parse_params(params)?;
            fs_rename(params)?;
            Ok(json!({}))
        }
        "fs.delete" => {
            let params: DeleteParams = parse_params(params)?;
            fs_delete(params)?;
            Ok(json!({}))
        }
        "fs.copy" => {
            let params: CopyParams = parse_params(params)?;
            fs_copy(params)?;
            Ok(json!({}))
        }
        "fs.search" => {
            let params: SearchParams = parse_params(params)?;
            Ok(serde_json::to_value(crate::search::fs_search(params)?)
                .map_err(|error| error.to_string())?)
        }
        "fs.listFiles" => {
            let params: ListFilesParams = parse_params(params)?;
            Ok(serde_json::to_value(crate::search::fs_list_files(params)?)
                .map_err(|error| error.to_string())?)
        }
        "fs.grep" => {
            let params: GrepParams = parse_params(params)?;
            Ok(serde_json::to_value(crate::search::fs_grep(params)?)
                .map_err(|error| error.to_string())?)
        }
        "fs.glob" => {
            let params: GlobParams = parse_params(params)?;
            Ok(serde_json::to_value(crate::search::fs_glob(params)?)
                .map_err(|error| error.to_string())?)
        }
        other => Err(format!("unknown method: {other}")),
    }
}

fn parse_params<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|error| format!("invalid params: {error}"))
}

fn ping() -> PingResult {
    PingResult {
        version: env!("CARGO_PKG_VERSION").to_string(),
        protocol: crate::PROTOCOL_VERSION,
        arch: std::env::consts::ARCH.to_string(),
        pid: std::process::id(),
    }
}

/// stat 语义对齐 wsl_ops 的 STAT_SCRIPT:优先跟随符号链接(`stat -L`),
/// 断链按 symlink 用 lstat 兜底,与 shell 脚本的 `-e`/`-L` 分支一一对应。
fn stat_target(path: &str) -> Result<(EntryKind, u64, u64), String> {
    if let Ok(meta) = std::fs::metadata(path) {
        let kind = if meta.is_dir() {
            EntryKind::Dir
        } else {
            EntryKind::File
        };
        return Ok((kind, meta.len(), mtime_ms(&meta)));
    }
    let meta = std::fs::symlink_metadata(path).map_err(|error| format!("{path}: {error}"))?;
    Ok((EntryKind::Symlink, meta.len(), mtime_ms(&meta)))
}

fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub fn fs_read_dir(params: ReadDirParams) -> Result<ReadDirResult, String> {
    let root = params.path;
    let meta = std::fs::metadata(&root).map_err(|error| format!("not a directory: {root}: {error}"))?;
    if !meta.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let read = std::fs::read_dir(&root).map_err(|error| format!("read_dir {root}: {error}"))?;
    let mut entries = Vec::new();
    for entry in read {
        // 与 READ_DIR_SCRIPT 的 `|| continue` 一致:单条目失败不拖垮整个列表。
        let Ok(entry) = entry else { continue };
        let Ok(raw_name) = entry.file_name().into_string() else {
            continue;
        };
        let path = entry.path();
        let Ok((kind, size, mtime)) = stat_target(&path.to_string_lossy()) else {
            continue;
        };
        // 去掉名字里的控制字符,与脚本的 `tr '\t\n' '  '` 动机相同(协议按行分帧)。
        let name: String = raw_name
            .chars()
            .map(|c| if c == '\t' || c == '\n' { ' ' } else { c })
            .collect();
        entries.push(DirEntry { name, kind, size, mtime });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(ReadDirResult { entries })
}

pub fn fs_stat(params: StatParams) -> Result<StatResult, String> {
    let (kind, size, mtime) = stat_target(&params.path)?;
    Ok(StatResult { kind, size, mtime })
}

pub fn fs_read_file(params: ReadFileParams) -> Result<ReadFileResult, String> {
    let max = params.max_bytes.unwrap_or(DEFAULT_READ_FILE_MAX_BYTES);
    let meta = std::fs::metadata(&params.path).map_err(|error| format!("{}: {error}", params.path))?;
    if meta.is_dir() {
        return Err(format!("{}: is a directory", params.path));
    }
    if meta.len() > max {
        return Err(format!("{}: file too large ({} > {max})", params.path, meta.len()));
    }
    let mut bytes = std::fs::read(&params.path).map_err(|error| format!("{}: {error}", params.path))?;
    // stat 与 read 之间文件可能增长;宁可截断也不越过上限。
    let truncated = bytes.len() as u64 > max;
    if truncated {
        bytes.truncate(max as usize);
    }
    Ok(ReadFileResult {
        content_base64: BASE64_STANDARD.encode(&bytes),
        truncated,
    })
}

#[cfg(unix)]
pub fn exec(params: ExecParams) -> Result<ExecResult, String> {
    let program = params.argv.first().ok_or_else(|| "exec: argv is empty".to_string())?;
    let max_output = params.max_output_bytes.unwrap_or(DEFAULT_EXEC_MAX_OUTPUT_BYTES);
    let timeout = params
        .timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_EXEC_TIMEOUT);

    let mut cmd = Command::new(program);
    cmd.args(&params.argv[1..]);
    if let Some(cwd) = params.cwd.filter(|s| !s.is_empty()) {
        cmd.current_dir(&cwd);
    }
    for (key, value) in &params.env {
        cmd.env(key, value);
    }
    if params.stdin_base64.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|error| format!("exec {program}: {error}"))?;
    if let Some(data) = params.stdin_base64 {
        let bytes = BASE64_STANDARD
            .decode(data.as_bytes())
            .map_err(|error| format!("exec stdin: invalid base64: {error}"))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "exec: no stdin pipe".to_string())?;
        use std::io::Write;
        // 子进程可能先于读完 stdin 退出(EPIPE);写入失败不视为整体失败。
        let _ = stdin.write_all(&bytes);
        drop(stdin);
    }

    let mut stdout_pipe = child.stdout.take().ok_or_else(|| "exec: no stdout".to_string())?;
    let mut stderr_pipe = child.stderr.take().ok_or_else(|| "exec: no stderr".to_string())?;
    let stdout_reader = std::thread::spawn(move || drain_capped(&mut stdout_pipe, max_output));
    let stderr_reader = std::thread::spawn(move || drain_capped(&mut stderr_pipe, max_output));

    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    timed_out = true;
                    // kill 后必须 reap,否则残留 zombie。
                    break child.wait().ok();
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(error) => return Err(format!("exec {program}: wait failed: {error}")),
        }
    };

    let (stdout, stdout_truncated) = stdout_reader.join().unwrap_or((Vec::new(), false));
    let (stderr, stderr_truncated) = stderr_reader.join().unwrap_or((Vec::new(), false));

    Ok(ExecResult {
        exit_code: status.and_then(|status| status.code()),
        timed_out,
        stdout_base64: BASE64_STANDARD.encode(&stdout),
        stderr_base64: BASE64_STANDARD.encode(&stderr),
        truncated: stdout_truncated || stderr_truncated,
    })
}

#[cfg(not(unix))]
pub fn exec(_params: ExecParams) -> Result<ExecResult, String> {
    Err("exec is only supported on unix targets".into())
}

// ---- fs 写操作(语义对齐主程序 fs/mutate.rs 与 file.rs::write_atomic)----

/// 原子写:目标父目录内 tempfile + persist(rename),防预置 symlink 攻击。
fn write_atomic(target: &std::path::Path, content: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = target
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    tmp.as_file_mut()
        .write_all(content)
        .map_err(|error| error.to_string())?;
    tmp.as_file_mut()
        .sync_all()
        .map_err(|error| error.to_string())?;
    tmp.persist(target)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

pub fn fs_write_file(params: WriteFileParams) -> Result<(), String> {
    let bytes = BASE64_STANDARD
        .decode(params.content_base64.as_bytes())
        .map_err(|error| format!("writeFile base64: {error}"))?;
    write_atomic(std::path::Path::new(&params.path), &bytes)
}

pub fn fs_create_file(params: CreateFileParams) -> Result<(), String> {
    let path = std::path::Path::new(&params.path);
    if path.exists() {
        return Err(format!("already exists: {}", path.display()));
    }
    std::fs::write(path, b"").map_err(|error| format!("{}: {error}", path.display()))
}

pub fn fs_create_dir(params: CreateDirParams) -> Result<(), String> {
    let path = std::path::Path::new(&params.path);
    if path.exists() {
        return Err(format!("already exists: {}", path.display()));
    }
    std::fs::create_dir_all(path).map_err(|error| format!("{}: {error}", path.display()))
}

pub fn fs_rename(params: RenameParams) -> Result<(), String> {
    let from = std::path::Path::new(&params.from);
    let to = std::path::Path::new(&params.to);
    if !from.exists() {
        return Err(format!("not found: {}", from.display()));
    }
    if to.exists() {
        return Err(format!("already exists: {}", to.display()));
    }
    std::fs::rename(from, to).map_err(|error| error.to_string())
}

pub fn fs_delete(params: DeleteParams) -> Result<(), String> {
    let path = std::path::Path::new(&params.path);
    let meta = std::fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    let result = if meta.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    result.map_err(|error| format!("{}: {error}", path.display()))
}

pub fn fs_copy(params: CopyParams) -> Result<(), String> {
    let from = std::path::Path::new(&params.from);
    let to = std::path::Path::new(&params.to);
    if !from.exists() {
        return Err(format!("not found: {}", from.display()));
    }
    if to.exists() {
        return Err(format!("already exists: {}", to.display()));
    }
    let meta = std::fs::symlink_metadata(from).map_err(|error| error.to_string())?;
    if meta.is_dir() {
        copy_dir_recursive(from, to)?;
    } else {
        std::fs::copy(from, to).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {e}", dst.display()))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("readdir {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        let child_src = entry.path();
        let child_dst = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&child_src, &child_dst)?;
        } else if ft.is_file() {
            std::fs::copy(&child_src, &child_dst)
                .map_err(|e| format!("copy {}: {e}", child_src.display()))?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn drain_capped<R: Read>(reader: &mut R, cap: usize) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    let mut truncated = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let room = cap.saturating_sub(out.len());
                if room == 0 {
                    truncated = true;
                    // 继续读空管道但不积压,避免子进程在写端阻塞。
                    continue;
                }
                let take = room.min(n);
                out.extend_from_slice(&buf[..take]);
                if take < n {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    (out, truncated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::ReadFileParams as ReadFileP;

    fn tempdir(label: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        path.push(format!(
            "nexterm-agent-{label}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create tempdir");
        path
    }

    #[test]
    fn ping_reports_version_and_protocol() {
        let value = dispatch("ping", Value::Null).expect("ping ok");
        assert_eq!(value["protocol"], crate::PROTOCOL_VERSION);
        assert!(value["version"].is_string());
        assert!(value["pid"].as_u64().unwrap_or(0) > 0);
    }

    #[test]
    fn unknown_method_is_an_error() {
        let error = dispatch("nope", Value::Null).unwrap_err();
        assert!(error.contains("unknown method"), "got: {error}");
    }

    #[test]
    fn invalid_params_are_rejected_cleanly() {
        let error = dispatch("fs.stat", json!({ "wrong": true })).unwrap_err();
        assert!(error.contains("invalid params"), "got: {error}");
    }

    #[test]
    fn fs_stat_and_read_dir_match_layout() {
        let root = tempdir("stat");
        std::fs::write(root.join("a.txt"), b"hello").expect("write file");
        std::fs::create_dir_all(root.join("sub")).expect("write dir");

        let stat = dispatch("fs.stat", json!({ "path": root.join("a.txt") })).expect("stat ok");
        assert_eq!(stat["kind"], "file");
        assert_eq!(stat["size"], 5);

        let listing =
            dispatch("fs.readDir", json!({ "path": root })).expect("readDir ok");
        let entries = listing["entries"].as_array().expect("entries array");
        let names: Vec<&str> = entries
            .iter()
            .map(|entry| entry["name"].as_str().expect("name"))
            .collect();
        assert_eq!(names, vec!["a.txt", "sub"]);
        assert_eq!(entries[0]["kind"], "file");
        assert_eq!(entries[1]["kind"], "dir");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn fs_read_file_encodes_base64_and_rejects_dirs() {
        let root = tempdir("read");
        std::fs::write(root.join("bin"), [1u8, 2, 3]).expect("write file");

        let params = ReadFileP {
            path: root.join("bin").to_string_lossy().into_owned(),
            max_bytes: None,
        };
        let result = fs_read_file(params).expect("read ok");
        assert_eq!(BASE64_STANDARD.decode(&result.content_base64).expect("b64"), vec![1, 2, 3]);
        assert!(!result.truncated);

        let dir_params = ReadFileP {
            path: root.to_string_lossy().into_owned(),
            max_bytes: None,
        };
        let error = fs_read_file(dir_params).unwrap_err();
        assert!(error.contains("is a directory"), "got: {error}");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn fs_read_file_enforces_max_bytes() {
        let root = tempdir("max");
        std::fs::write(root.join("big"), vec![0u8; 128]).expect("write file");
        let params = ReadFileP {
            path: root.join("big").to_string_lossy().into_owned(),
            max_bytes: Some(64),
        };
        let error = fs_read_file(params).unwrap_err();
        assert!(error.contains("file too large"), "got: {error}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn exec_captures_stdout_and_exit_code() {
        let params: ExecParams = serde_json::from_value(json!({
            "argv": ["sh", "-c", "printf hello; printf oops >&2; exit 3"],
            "cwd": std::env::temp_dir().to_string_lossy()
        }))
        .expect("params");
        let result = exec(params).expect("exec ok");
        assert_eq!(BASE64_STANDARD.decode(&result.stdout_base64).expect("b64"), b"hello");
        assert_eq!(BASE64_STANDARD.decode(&result.stderr_base64).expect("b64"), b"oops");
        assert_eq!(result.exit_code, Some(3));
        assert!(!result.timed_out);
    }

    #[cfg(unix)]
    #[test]
    fn exec_applies_env_and_cwd() {
        let params: ExecParams = serde_json::from_value(json!({
            "argv": ["sh", "-c", "printf %s \"$NEXTERM_TEST_VALUE/$PWD\""],
            "cwd": "/tmp",
            "env": { "NEXTERM_TEST_VALUE": "v42" }
        }))
        .expect("params");
        let result = exec(params).expect("exec ok");
        let out = String::from_utf8(BASE64_STANDARD.decode(&result.stdout_base64).expect("b64"))
            .expect("utf8");
        assert_eq!(out, "v42//tmp");
        assert_eq!(result.exit_code, Some(0));
    }

    #[cfg(unix)]
    #[test]
    fn exec_kills_on_timeout_and_reports() {
        let params: ExecParams = serde_json::from_value(json!({
            "argv": ["sh", "-c", "sleep 5"],
            "timeoutMs": 150
        }))
        .expect("params");
        let result = exec(params).expect("exec ok");
        assert!(result.timed_out);
    }

    #[cfg(unix)]
    #[test]
    fn exec_writes_stdin() {
        let params: ExecParams = serde_json::from_value(json!({
            "argv": ["cat"],
            "stdinBase64": BASE64_STANDARD.encode("piped-input")
        }))
        .expect("params");
        let result = exec(params).expect("exec ok");
        assert_eq!(
            String::from_utf8(BASE64_STANDARD.decode(&result.stdout_base64).expect("b64"))
                .expect("utf8"),
            "piped-input"
        );
    }
}
