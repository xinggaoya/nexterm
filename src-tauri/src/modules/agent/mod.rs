//! nexterm-agent 宿主侧入口:类型化 API。
//!
//! 设计契约:**agent 永远只是加速路径**。所有调用方(fs::wsl_ops、
//! git::process)在 Err 时都必须回退到既有 legacy 路径,agent 资产缺失
//! 或发行版熔断时行为与改造前完全一致。

pub(crate) mod connection;
pub(crate) mod install;
pub(crate) mod manager;
pub(crate) mod protocol;

use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde_json::Value;

use crate::modules::fs::wsl_ops::{WslDirEntry, WslEntryKind, WslFileStat};

/// fs 读操作的整体超时(含 WSL 冷启动余量)。
const FS_TIMEOUT: Duration = Duration::from_secs(30);
/// 批量搬运（可能跨设备 copy 整个目录树）比单次 fs 操作慢得多，
/// 超时不能复用 FS_TIMEOUT，否则大目录拖拽会收到假失败。
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(180);
/// exec 的业务超时由调用方给定;传输层在此之上再多等一段。
const TRANSPORT_GRACE: Duration = Duration::from_secs(5);

/// exec 的结构化结果,字段语义对齐 `git::types::GitOutput` 与
/// legacy `wsl.exe` 路径,便于调用方等价替换。
pub struct ExecOutcome {
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub truncated: bool,
}

/// 在发行版内直接执行 `argv`(不经过 shell),可选 cwd/env/stdin。
#[allow(clippy::too_many_arguments)]
pub fn exec_simple(
    distro: &str,
    argv: Vec<String>,
    cwd: Option<String>,
    env: &[(&str, &str)],
    stdin: Option<&[u8]>,
    timeout: Duration,
    max_output_bytes: usize,
) -> Result<ExecOutcome, String> {
    let params = protocol::exec_params(cwd.as_deref(), &argv, env, stdin, timeout, max_output_bytes);
    let value = manager::request(
        distro,
        protocol::METHOD_EXEC,
        params,
        timeout + TRANSPORT_GRACE,
    )?;
    parse_exec_outcome(&value)
}

pub(crate) fn parse_exec_outcome(value: &Value) -> Result<ExecOutcome, String> {
    let stdout_b64 = value
        .get("stdoutBase64")
        .and_then(Value::as_str)
        .ok_or_else(|| "agent exec response missing stdoutBase64".to_string())?;
    let stderr_b64 = value
        .get("stderrBase64")
        .and_then(Value::as_str)
        .ok_or_else(|| "agent exec response missing stderrBase64".to_string())?;
    Ok(ExecOutcome {
        exit_code: value
            .get("exitCode")
            .and_then(Value::as_i64)
            .map(|code| code as i32),
        timed_out: value
            .get("timedOut")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        stdout: BASE64_STANDARD
            .decode(stdout_b64)
            .map_err(|error| format!("agent exec stdout base64: {error}"))?,
        stderr: BASE64_STANDARD
            .decode(stderr_b64)
            .map_err(|error| format!("agent exec stderr base64: {error}"))?,
        truncated: value
            .get("truncated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

pub fn read_dir(distro: &str, path: &str) -> Result<Vec<WslDirEntry>, String> {
    let value = manager::request(
        distro,
        protocol::METHOD_FS_READ_DIR,
        protocol::fs_read_dir_params(path),
        FS_TIMEOUT,
    )?;
    parse_dir_entries(&value)
}

/// 从 `fs.readDir` 响应解析条目列表(WSL 与 SSH 远端共用)。
pub(crate) fn parse_dir_entries(value: &Value) -> Result<Vec<WslDirEntry>, String> {
    let entries = value
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| "agent readDir response missing entries".to_string())?;
    entries
        .iter()
        .map(|entry| {
            Ok(WslDirEntry {
                name: entry
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "entry missing name".to_string())?
                    .to_string(),
                kind: parse_kind(entry.get("kind").and_then(Value::as_str))?,
                size: entry.get("size").and_then(Value::as_u64).unwrap_or(0),
                mtime: entry.get("mtime").and_then(Value::as_u64).unwrap_or(0),
            })
        })
        .collect()
}

pub fn stat(distro: &str, path: &str) -> Result<WslFileStat, String> {
    let value = manager::request(
        distro,
        protocol::METHOD_FS_STAT,
        protocol::fs_stat_params(path),
        FS_TIMEOUT,
    )?;
    parse_stat(&value)
}

/// 从 `fs.stat` 响应解析(WSL 与 SSH 远端共用)。
pub(crate) fn parse_stat(value: &Value) -> Result<WslFileStat, String> {
    Ok(WslFileStat {
        kind: parse_kind(value.get("kind").and_then(Value::as_str))?,
        size: value.get("size").and_then(Value::as_u64).unwrap_or(0),
        mtime: value.get("mtime").and_then(Value::as_u64).unwrap_or(0),
    })
}

pub fn read_file(distro: &str, path: &str) -> Result<Vec<u8>, String> {
    let value = manager::request(
        distro,
        protocol::METHOD_FS_READ_FILE,
        protocol::fs_read_file_params(path),
        FS_TIMEOUT,
    )?;
    parse_file_bytes(&value)
}

/// 从 `fs.readFile` 响应解析内容(WSL 与 SSH 远端共用)。
pub(crate) fn parse_file_bytes(value: &Value) -> Result<Vec<u8>, String> {
    let content = value
        .get("contentBase64")
        .and_then(Value::as_str)
        .ok_or_else(|| "agent readFile response missing contentBase64".to_string())?;
    BASE64_STANDARD
        .decode(content)
        .map_err(|error| format!("agent readFile base64: {error}"))
}

// ---- Phase 0b:写操作与 search/grep 家族(WSL 路由用)----
// 结果形状与宿主 fs/mutate.rs、fs/search.rs、fs/grep.rs 的 serde 结构逐字段对齐;
// agent 响应为 camelCase(协议约定),解析时逐一映射。

pub fn write_file(distro: &str, path: &str, content_base64: &str) -> Result<(), String> {
    let value = manager::request(
        distro,
        protocol::METHOD_FS_WRITE_FILE,
        protocol::fs_write_file_params(path, content_base64),
        Duration::from_secs(60),
    )?;
    let _ = value;
    Ok(())
}

pub fn create_file(distro: &str, path: &str) -> Result<(), String> {
    manager::request(
        distro,
        protocol::METHOD_FS_CREATE_FILE,
        protocol::fs_create_file_params(path),
        FS_TIMEOUT,
    )
    .map(|_| ())
}

pub fn create_dir(distro: &str, path: &str) -> Result<(), String> {
    manager::request(
        distro,
        protocol::METHOD_FS_CREATE_DIR,
        protocol::fs_create_dir_params(path),
        FS_TIMEOUT,
    )
    .map(|_| ())
}

pub fn rename(distro: &str, from: &str, to: &str) -> Result<(), String> {
    manager::request(
        distro,
        protocol::METHOD_FS_RENAME,
        protocol::fs_rename_params(from, to),
        FS_TIMEOUT,
    )
    .map(|_| ())
}

pub fn delete(distro: &str, path: &str) -> Result<(), String> {
    manager::request(
        distro,
        protocol::METHOD_FS_DELETE,
        protocol::fs_delete_params(path),
        FS_TIMEOUT,
    )
    .map(|_| ())
}

pub fn copy(distro: &str, from: &str, to: &str) -> Result<(), String> {
    manager::request(
        distro,
        protocol::METHOD_FS_COPY,
        protocol::fs_copy_params(from, to),
        FS_TIMEOUT,
    )
    .map(|_| ())
}

/// 批量搬运的 WSL 通道入口。搬运规则（冲突策略 / 跨设备回落 / 符号链接）
/// 全部在 agent 内的 `nexterm-fs-core` 执行，宿主只负责拼参数与解码结果，
/// 因此本地 / WSL / SSH 三条路径的行为逐字节一致。
pub fn move_many(
    distro: &str,
    items: &[nexterm_fs_core::TransferItem],
    conflict: nexterm_fs_core::ConflictPolicy,
) -> Result<nexterm_fs_core::TransferResult, String> {
    let value = manager::request(
        distro,
        protocol::METHOD_FS_MOVE_MANY,
        protocol::transfer_many_params(items, conflict),
        // 批量搬运可能跨设备 copy 整个子树，给足超时而不是让 UI 干等。
        TRANSFER_TIMEOUT,
    )?;
    parse_transfer_result(&value)
}

pub fn copy_many(
    distro: &str,
    items: &[nexterm_fs_core::TransferItem],
    conflict: nexterm_fs_core::ConflictPolicy,
) -> Result<nexterm_fs_core::TransferResult, String> {
    let value = manager::request(
        distro,
        protocol::METHOD_FS_COPY_MANY,
        protocol::transfer_many_params(items, conflict),
        TRANSFER_TIMEOUT,
    )?;
    parse_transfer_result(&value)
}

/// 解码 agent 回传的搬运结果。DTO 由共享 crate 定义，宿主不重新声明
/// 一份 —— 声明两份就会在某次协议演进时静默错位。
fn parse_transfer_result(value: &Value) -> Result<nexterm_fs_core::TransferResult, String> {
    serde_json::from_value(value.clone())
        .map_err(|error| format!("invalid fs transfer result from agent: {error}"))
}

fn get_str(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn get_u64(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

pub struct SearchHitParsed {
    pub path: String,
    pub rel: String,
    pub name: String,
    pub is_dir: bool,
}

pub struct SearchResultParsed {
    pub hits: Vec<SearchHitParsed>,
    pub truncated: bool,
}

pub fn search(
    distro: &str,
    root: &str,
    query: &str,
    limit: Option<usize>,
    show_hidden: bool,
    root_display: &str,
) -> Result<SearchResultParsed, String> {
    let value = manager::request(
        distro,
        protocol::METHOD_FS_SEARCH,
        protocol::fs_search_params(root, query, limit, show_hidden, root_display),
        Duration::from_secs(60),
    )?;
    parse_search_result(&value)
}

pub(crate) fn parse_search_result(value: &Value) -> Result<SearchResultParsed, String> {
    let mut hits = Vec::new();
    if let Some(items) = value.get("hits").and_then(Value::as_array) {
        for hit in items {
            hits.push(SearchHitParsed {
                path: get_str(hit, "path"),
                rel: get_str(hit, "rel"),
                name: get_str(hit, "name"),
                is_dir: hit.get("isDir").and_then(Value::as_bool).unwrap_or(false),
            });
        }
    }
    Ok(SearchResultParsed {
        truncated: value.get("truncated").and_then(Value::as_bool).unwrap_or(false),
        hits,
    })
}

pub fn list_files(
    distro: &str,
    root: &str,
    limit: Option<usize>,
    max_depth: Option<usize>,
    show_hidden: bool,
) -> Result<(Vec<String>, bool), String> {
    let value = manager::request(
        distro,
        protocol::METHOD_FS_LIST_FILES,
        protocol::fs_list_files_params(root, limit, max_depth, show_hidden),
        Duration::from_secs(60),
    )?;
    parse_list_files(&value)
}

pub(crate) fn parse_list_files(value: &Value) -> Result<(Vec<String>, bool), String> {
    // files 是纯字符串数组。
    let files = value
        .get("files")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let truncated = value.get("truncated").and_then(Value::as_bool).unwrap_or(false);
    Ok((files, truncated))
}

pub struct GrepHitParsed {
    pub path: String,
    pub rel: String,
    pub line: u64,
    pub text: String,
}

pub struct GrepResponseParsed {
    pub hits: Vec<GrepHitParsed>,
    pub truncated: bool,
    pub files_scanned: usize,
}

#[allow(clippy::too_many_arguments)]
pub fn grep(
    distro: &str,
    pattern: &str,
    root: &str,
    glob: Option<&[String]>,
    case_insensitive: bool,
    max_results: Option<usize>,
    root_display: &str,
) -> Result<GrepResponseParsed, String> {
    let value = manager::request(
        distro,
        protocol::METHOD_FS_GREP,
        protocol::fs_grep_params(pattern, root, glob, case_insensitive, max_results, root_display),
        Duration::from_secs(120),
    )?;
    parse_grep_response(&value)
}

pub(crate) fn parse_grep_response(value: &Value) -> Result<GrepResponseParsed, String> {
    let mut hits = Vec::new();
    if let Some(items) = value.get("hits").and_then(Value::as_array) {
        for hit in items {
            hits.push(GrepHitParsed {
                path: get_str(hit, "path"),
                rel: get_str(hit, "rel"),
                line: get_u64(hit, "line"),
                text: get_str(hit, "text"),
            });
        }
    }
    Ok(GrepResponseParsed {
        hits,
        truncated: value.get("truncated").and_then(Value::as_bool).unwrap_or(false),
        files_scanned: get_u64(value, "filesScanned") as usize,
    })
}

pub struct GlobHitParsed {
    pub path: String,
    pub rel: String,
}

pub fn glob(
    distro: &str,
    pattern: &str,
    root: &str,
    max_results: Option<usize>,
    root_display: &str,
) -> Result<(Vec<GlobHitParsed>, bool), String> {
    let value = manager::request(
        distro,
        protocol::METHOD_FS_GLOB,
        protocol::fs_glob_params(pattern, root, max_results, root_display),
        Duration::from_secs(60),
    )?;
    parse_glob(&value)
}

pub(crate) fn parse_glob(value: &Value) -> Result<(Vec<GlobHitParsed>, bool), String> {
    let mut hits = Vec::new();
    if let Some(items) = value.get("hits").and_then(Value::as_array) {
        for hit in items {
            hits.push(GlobHitParsed {
                path: get_str(hit, "path"),
                rel: get_str(hit, "rel"),
            });
        }
    }
    let truncated = value.get("truncated").and_then(Value::as_bool).unwrap_or(false);
    Ok((hits, truncated))
}

fn parse_kind(raw: Option<&str>) -> Result<WslEntryKind, String> {
    match raw {
        Some("file") => Ok(WslEntryKind::File),
        Some("dir") => Ok(WslEntryKind::Dir),
        Some("symlink") => Ok(WslEntryKind::Symlink),
        other => Err(format!("agent entry has invalid kind: {other:?}")),
    }
}
