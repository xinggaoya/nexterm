use std::io::{self, BufReader};

use super::errors::LspError;
use super::framing::{read_frame, write_frame};

fn to_io(e: LspError) -> io::Error {
    io::Error::other(e.to_string())
}

/// mock-lsp 入口：把任何读到的 LSP 帧按请求类型回一份最小 JSON-RPC 响应。
/// 仅用于 Section 2 传输层 e2e 验证。
pub fn run_mock_stdio() -> io::Result<()> {
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let stdout = io::stdout();
    let mut writer = stdout.lock();

    loop {
        match read_frame(&mut reader) {
            Ok(Some(frame)) => {
                if frame.contains("\"method\":\"initialize\"") {
                    let response = r#"{"jsonrpc":"2.0","id":1,"result":{"capabilities":{}}}"#;
                    write_frame(&mut writer, response).map_err(to_io)?;
                } else if frame.contains("\"method\":\"shutdown\"") {
                    let response = r#"{"jsonrpc":"2.0","id":2,"result":null}"#;
                    write_frame(&mut writer, response).map_err(to_io)?;
                } else if frame.contains("\"method\":\"exit\"") {
                    return Ok(());
                } else {
                    let response = r#"{"jsonrpc":"2.0","id":1,"result":null}"#;
                    write_frame(&mut writer, response).map_err(to_io)?;
                }
            }
            Ok(None) => return Ok(()),
            Err(_) => return Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn echo_roundtrip() {
        let request = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
        let mut bytes: Vec<u8> = Vec::new();
        crate::modules::lsp::framing::write_frame(&mut bytes, request).unwrap();
        let mut reader = Cursor::new(bytes);
        let frame = read_frame(&mut reader).unwrap().unwrap();
        assert!(frame.contains("initialize"));
    }
}
