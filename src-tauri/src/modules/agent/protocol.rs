//! 客户端视角的 JSON-lines 解析与请求构造。
//!
//! 解析刻意宽松(agent 是另一个 crate,协议演进时旧宿主要能容忍未知字段):
//! 只取 `id` / `ok` / `result` / `error`,带 `event` 无 `id` 的行按通知处理。

use serde_json::Value;

pub(crate) struct Incoming {
    pub id: u64,
    pub ok: bool,
    pub result: Option<Value>,
    pub error: Option<String>,
}

pub(crate) enum ParsedLine {
    Response(Incoming),
    /// 预留:未来 agent 主动推送(如 watch 事件);当前仅记录不消费。
    Event(String),
    Ignored,
}

pub(crate) fn build_request_line(id: u64, method: &str, params: &Value) -> String {
    let request = serde_json::json!({ "id": id, "method": method, "params": params });
    let mut line = request.to_string();
    line.push('\n');
    line
}

pub(crate) fn parse_line(line: &str) -> ParsedLine {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return ParsedLine::Ignored;
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return ParsedLine::Ignored;
    };
    if let Some(id) = value.get("id").and_then(Value::as_u64) {
        let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
        let error = value
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string);
        return ParsedLine::Response(Incoming {
            id,
            ok,
            // 字段存在即为 Some(含 null);error 响应不带 result 字段。
            result: value.get("result").cloned(),
            error,
        });
    }
    if let Some(event) = value.get("event").and_then(Value::as_str) {
        return ParsedLine::Event(event.to_string());
    }
    ParsedLine::Ignored
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_request_produces_json_line() {
        let line = build_request_line(4, "fs.stat", &json!({ "path": "/tmp" }));
        assert!(line.ends_with('\n'));
        let value: Value = serde_json::from_str(line.trim()).expect("valid json");
        assert_eq!(value["id"], 4);
        assert_eq!(value["method"], "fs.stat");
        assert_eq!(value["params"]["path"], "/tmp");
    }

    #[test]
    fn parses_ok_and_error_responses() {
        let ok = parse_line(r#"{"id":1,"ok":true,"result":{"version":"0.1.2"}}"#);
        let ParsedLine::Response(incoming) = ok else {
            panic!("expected response");
        };
        assert!(incoming.ok);
        assert_eq!(incoming.result.as_ref().and_then(|v| v["version"].as_str()), Some("0.1.2"));

        let err = parse_line(r#"{"id":2,"ok":false,"error":"boom"}"#);
        let ParsedLine::Response(incoming) = err else {
            panic!("expected response");
        };
        assert!(!incoming.ok);
        assert_eq!(incoming.error.as_deref(), Some("boom"));
    }

    #[test]
    fn null_result_response_keeps_ok_flag() {
        let parsed = parse_line(r#"{"id":3,"ok":true,"result":null}"#);
        let ParsedLine::Response(incoming) = parsed else {
            panic!("expected response");
        };
        assert!(incoming.ok);
        assert!(incoming.result.is_some());
    }

    #[test]
    fn event_and_garbage_lines_are_tolerated() {
        assert!(matches!(parse_line(r#"{"event":"log"}"#), ParsedLine::Event(_)));
        assert!(matches!(parse_line("garbage"), ParsedLine::Ignored));
        assert!(matches!(parse_line("   "), ParsedLine::Ignored));
    }
}

// ---- 方法名与参数构造的唯一定义 ----
// WSL(agent/mod.rs 经 manager::request)与 SSH(ssh::remote.rs 经
// agent_once)两条传输通道共用。方法名或参数字段变更时只改这里,
// 避免两侧 JSON 构造镜像漂移。

/// fs.readFile:返回内容 base64。
pub(crate) const METHOD_FS_READ_FILE: &str = "fs.readFile";
/// fs.readDir:目录条目列表。
pub(crate) const METHOD_FS_READ_DIR: &str = "fs.readDir";
/// fs.stat:文件元信息。
pub(crate) const METHOD_FS_STAT: &str = "fs.stat";
/// fs.writeFile:contentBase64 全量写。
pub(crate) const METHOD_FS_WRITE_FILE: &str = "fs.writeFile";
/// fs.createFile
pub(crate) const METHOD_FS_CREATE_FILE: &str = "fs.createFile";
/// fs.createDir
pub(crate) const METHOD_FS_CREATE_DIR: &str = "fs.createDir";
/// fs.rename
pub(crate) const METHOD_FS_RENAME: &str = "fs.rename";
/// fs.delete
pub(crate) const METHOD_FS_DELETE: &str = "fs.delete";
/// fs.copy
pub(crate) const METHOD_FS_COPY: &str = "fs.copy";
/// fs.search
pub(crate) const METHOD_FS_SEARCH: &str = "fs.search";
/// fs.listFiles
pub(crate) const METHOD_FS_LIST_FILES: &str = "fs.listFiles";
/// fs.grep
pub(crate) const METHOD_FS_GREP: &str = "fs.grep";
/// fs.glob
pub(crate) const METHOD_FS_GLOB: &str = "fs.glob";
/// exec:不经 shell 的 argv 执行。
pub(crate) const METHOD_EXEC: &str = "exec";

pub(crate) fn fs_read_file_params(path: &str) -> Value {
    serde_json::json!({ "path": path })
}

pub(crate) fn fs_read_dir_params(path: &str) -> Value {
    serde_json::json!({ "path": path })
}

pub(crate) fn fs_stat_params(path: &str) -> Value {
    serde_json::json!({ "path": path })
}

pub(crate) fn fs_write_file_params(path: &str, content_base64: &str) -> Value {
    serde_json::json!({ "path": path, "contentBase64": content_base64 })
}

pub(crate) fn fs_create_file_params(path: &str) -> Value {
    serde_json::json!({ "path": path })
}

pub(crate) fn fs_create_dir_params(path: &str) -> Value {
    serde_json::json!({ "path": path })
}

pub(crate) fn fs_rename_params(from: &str, to: &str) -> Value {
    serde_json::json!({ "from": from, "to": to })
}

pub(crate) fn fs_delete_params(path: &str) -> Value {
    serde_json::json!({ "path": path })
}

pub(crate) fn fs_copy_params(from: &str, to: &str) -> Value {
    serde_json::json!({ "from": from, "to": to })
}

pub(crate) fn fs_search_params(
    root: &str,
    query: &str,
    limit: Option<usize>,
    show_hidden: bool,
    root_display: &str,
) -> Value {
    serde_json::json!({
        "root": root,
        "query": query,
        "limit": limit,
        "showHidden": show_hidden,
        "rootDisplay": root_display,
    })
}

pub(crate) fn fs_list_files_params(
    root: &str,
    limit: Option<usize>,
    max_depth: Option<usize>,
    show_hidden: bool,
) -> Value {
    serde_json::json!({
        "root": root,
        "limit": limit,
        "maxDepth": max_depth,
        "showHidden": show_hidden,
    })
}

pub(crate) fn fs_grep_params(
    pattern: &str,
    root: &str,
    glob: Option<&[String]>,
    case_insensitive: bool,
    max_results: Option<usize>,
    root_display: &str,
) -> Value {
    serde_json::json!({
        "pattern": pattern,
        "root": root,
        "glob": glob,
        "caseInsensitive": case_insensitive,
        "maxResults": max_results,
        "rootDisplay": root_display,
    })
}

pub(crate) fn fs_glob_params(
    pattern: &str,
    root: &str,
    max_results: Option<usize>,
    root_display: &str,
) -> Value {
    serde_json::json!({
        "pattern": pattern,
        "root": root,
        "maxResults": max_results,
        "rootDisplay": root_display,
    })
}

/// exec 参数。`stdin` 为 Some 时才输出 `stdinBase64`(WSL 通道支持
/// stdin;SSH git 桥不传该字段,保持与既有协议形状一致)。
#[allow(clippy::too_many_arguments)]
pub(crate) fn exec_params(
    cwd: Option<&str>,
    argv: &[String],
    env: &[(&str, &str)],
    stdin: Option<&[u8]>,
    timeout: std::time::Duration,
    max_output_bytes: usize,
) -> Value {
    let mut env_map = serde_json::Map::new();
    for (key, value) in env {
        env_map.insert((*key).to_string(), Value::String((*value).to_string()));
    }
    let mut params = serde_json::Map::new();
    params.insert("argv".to_string(), serde_json::json!(argv));
    params.insert("cwd".to_string(), serde_json::json!(cwd));
    params.insert("env".to_string(), Value::Object(env_map));
    if let Some(bytes) = stdin {
        use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
        use base64::Engine as _;
        params.insert(
            "stdinBase64".to_string(),
            Value::String(BASE64_STANDARD.encode(bytes)),
        );
    }
    params.insert(
        "timeoutMs".to_string(),
        serde_json::json!(timeout.as_millis() as u64),
    );
    params.insert(
        "maxOutputBytes".to_string(),
        serde_json::json!(max_output_bytes),
    );
    Value::Object(params)
}

#[cfg(test)]
mod params_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn exec_params_includes_stdin_only_when_present() {
        let argv = vec!["git".to_string(), "status".to_string()];
        let env = [("GIT_DIR", "/repo")];
        let with_stdin = exec_params(
            Some("/repo"),
            &argv,
            &env,
            Some(b"hello"),
            std::time::Duration::from_secs(5),
            1024,
        );
        assert_eq!(with_stdin["argv"], json!(["git", "status"]));
        assert_eq!(with_stdin["timeoutMs"], json!(5000));
        assert!(with_stdin.get("stdinBase64").is_some());

        let without_stdin = exec_params(None, &argv, &env, None, std::time::Duration::from_secs(5), 1024);
        assert!(without_stdin.get("stdinBase64").is_none());
        assert!(without_stdin["cwd"].is_null());
    }

    #[test]
    fn fs_write_file_params_shape() {
        let value = fs_write_file_params("/a", "QUJD");
        assert_eq!(value, json!({ "path": "/a", "contentBase64": "QUJD" }));
    }
}
