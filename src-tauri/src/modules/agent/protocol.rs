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
