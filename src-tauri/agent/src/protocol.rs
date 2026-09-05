//! JSON-lines 协议的请求/响应与各 method 的 params/result 类型。
//!
//! 命名全部 camelCase,与主程序前端既有字段风格一致;mtime 一律为
//! 毫秒级 UNIX 时间戳,对齐 `fs::wsl_ops`(秒 × 1000)的既有契约。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 客户端 → agent 的单行请求。
#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// agent → 客户端的单行响应。
#[derive(Debug, Clone, Serialize)]
pub struct Response {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn ok(id: u64, result: Value) -> Self {
        Self {
            id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(id: u64, error: impl Into<String>) -> Self {
        Self {
            id,
            ok: false,
            result: None,
            error: Some(error.into()),
        }
    }

    pub fn to_line(&self) -> String {
        let mut line = serde_json::to_string(self).unwrap_or_else(|_| {
            // Response 只含 Value,序列化失败仅可能来自非字符串 map key;
            // 此时退化为一条确定可序列化的错误响应,绝不能 panic 拖垮进程。
            format!(
                r#"{{"id":{},"ok":false,"error":"response serialization failed"}}"#,
                self.id
            )
        });
        line.push('\n');
        line
    }
}

// ---- 各 method 的 params/result ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub version: String,
    pub protocol: &'static str,
    pub arch: String,
    pub pid: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDirParams {
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    /// 毫秒级 UNIX 时间戳;与主程序 wsl_ops 契约一致(不可得时为 0)。
    pub mtime: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDirResult {
    pub entries: Vec<DirEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatParams {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatResult {
    pub kind: EntryKind,
    pub size: u64,
    pub mtime: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileParams {
    pub path: String,
    #[serde(default)]
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    pub content_base64: String,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecParams {
    pub argv: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub stdin_base64: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub max_output_bytes: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    /// 退出码;超时被杀或因信号退出时可能为 null。
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub stdout_base64: String,
    pub stderr_base64: String,
    pub truncated: bool,
}

// ---- fs 写操作 ----

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileParams {
    pub path: String,
    pub content_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFileParams {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDirParams {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameParams {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteParams {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyParams {
    pub from: String,
    pub to: String,
}

// ---- fs search / listFiles / grep / glob ----
// 响应形状与主程序 `fs/search.rs`、`fs/grep.rs` 的 serde 结构逐字段对齐,
// 保证前端无需感知执行位置。path 展示串由 rootDisplay(工作区根的展示
// 形式)拼接,与宿主 display_path 的 WSL 分支公式一致。

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    pub root: String,
    pub query: String,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub show_hidden: Option<bool>,
    #[serde(default)]
    pub root_display: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub rel: String,
    pub name: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFilesParams {
    pub root: String,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub max_depth: Option<usize>,
    #[serde(default)]
    pub show_hidden: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFilesResult {
    pub files: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepParams {
    pub pattern: String,
    pub root: String,
    #[serde(default)]
    pub glob: Option<Vec<String>>,
    #[serde(default)]
    pub case_insensitive: Option<bool>,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub root_display: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepHit {
    pub path: String,
    pub rel: String,
    pub line: u64,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResponse {
    pub hits: Vec<GrepHit>,
    pub truncated: bool,
    pub files_scanned: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobParams {
    pub pattern: String,
    pub root: String,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub root_display: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobHit {
    pub path: String,
    pub rel: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobResponse {
    pub hits: Vec<GlobHit>,
    pub truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_parses_camel_case_line() {
        let req: Request =
            serde_json::from_str(r#"{"id":7,"method":"fs.readDir","params":{"path":"/home/u"}}"#)
                .expect("valid request");
        assert_eq!(req.id, 7);
        assert_eq!(req.method, "fs.readDir");
        assert_eq!(req.params["path"], "/home/u");
    }

    #[test]
    fn request_params_default_to_null_when_absent() {
        let req: Request = serde_json::from_str(r#"{"id":1,"method":"ping"}"#).expect("valid");
        assert!(req.params.is_null());
    }

    #[test]
    fn response_ok_line_round_trips() {
        let line = Response::ok(3, serde_json::json!({ "entries": [] })).to_line();
        assert!(line.ends_with('\n'));
        let value: Value = serde_json::from_str(line.trim()).expect("valid json");
        assert_eq!(value["id"], 3);
        assert_eq!(value["ok"], true);
        assert_eq!(value["result"]["entries"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn response_err_line_has_error_only() {
        let line = Response::err(9, "boom").to_line();
        let value: Value = serde_json::from_str(line.trim()).expect("valid json");
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"], "boom");
        assert!(value.get("result").is_none());
    }

    #[test]
    fn exec_params_accept_camel_case_fields() {
        let params: ExecParams = serde_json::from_value(serde_json::json!({
            "argv": ["git", "status"],
            "cwd": "/repo",
            "env": { "LC_ALL": "C" },
            "timeoutMs": 1500,
            "maxOutputBytes": 4096
        }))
        .expect("valid params");
        assert_eq!(params.argv, vec!["git", "status"]);
        assert_eq!(params.timeout_ms, Some(1500));
        assert!(params.stdin_base64.is_none());
    }
}
