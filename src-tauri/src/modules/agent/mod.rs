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
use serde_json::{json, Value};

use crate::modules::fs::wsl_ops::{WslDirEntry, WslEntryKind, WslFileStat};

/// fs 读操作的整体超时(含 WSL 冷启动余量)。
const FS_TIMEOUT: Duration = Duration::from_secs(30);
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
    let mut env_map = serde_json::Map::new();
    for (key, value) in env {
        env_map.insert((*key).to_string(), Value::String((*value).to_string()));
    }
    let params = json!({
        "argv": argv,
        "cwd": cwd,
        "env": Value::Object(env_map),
        "stdinBase64": stdin.map(|bytes| BASE64_STANDARD.encode(bytes)),
        "timeoutMs": timeout.as_millis() as u64,
        "maxOutputBytes": max_output_bytes,
    });
    let value = manager::request(distro, "exec", params, timeout + TRANSPORT_GRACE)?;
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
        "fs.readDir",
        json!({ "path": path }),
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
    let value = manager::request(distro, "fs.stat", json!({ "path": path }), FS_TIMEOUT)?;
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
        "fs.readFile",
        json!({ "path": path }),
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
        "fs.writeFile",
        json!({ "path": path, "contentBase64": content_base64 }),
        Duration::from_secs(60),
    )?;
    let _ = value;
    Ok(())
}

pub fn create_file(distro: &str, path: &str) -> Result<(), String> {
    manager::request(distro, "fs.createFile", json!({ "path": path }), FS_TIMEOUT)
        .map(|_| ())
}

pub fn create_dir(distro: &str, path: &str) -> Result<(), String> {
    manager::request(distro, "fs.createDir", json!({ "path": path }), FS_TIMEOUT).map(|_| ())
}

pub fn rename(distro: &str, from: &str, to: &str) -> Result<(), String> {
    manager::request(
        distro,
        "fs.rename",
        json!({ "from": from, "to": to }),
        FS_TIMEOUT,
    )
    .map(|_| ())
}

pub fn delete(distro: &str, path: &str) -> Result<(), String> {
    manager::request(distro, "fs.delete", json!({ "path": path }), FS_TIMEOUT).map(|_| ())
}

pub fn copy(distro: &str, from: &str, to: &str) -> Result<(), String> {
    manager::request(
        distro,
        "fs.copy",
        json!({ "from": from, "to": to }),
        FS_TIMEOUT,
    )
    .map(|_| ())
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
        "fs.search",
        json!({
            "root": root,
            "query": query,
            "limit": limit,
            "showHidden": show_hidden,
            "rootDisplay": root_display,
        }),
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
        "fs.listFiles",
        json!({
            "root": root,
            "limit": limit,
            "maxDepth": max_depth,
            "showHidden": show_hidden,
        }),
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
        "fs.grep",
        json!({
            "pattern": pattern,
            "root": root,
            "glob": glob,
            "caseInsensitive": case_insensitive,
            "maxResults": max_results,
            "rootDisplay": root_display,
        }),
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
        "fs.glob",
        json!({
            "pattern": pattern,
            "root": root,
            "maxResults": max_results,
            "rootDisplay": root_display,
        }),
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
