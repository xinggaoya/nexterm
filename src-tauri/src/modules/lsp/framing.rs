use std::io::{BufRead, Write};

use super::errors::LspError;

pub const HEADER_PREFIX: &str = "Content-Length: ";

/// 解析 `Content-Length: <n>`；仅在 trimmed line 以 prefix 开头时返回 Some(n)，否则 None。
pub fn content_length(line: &str) -> Option<usize> {
    let trimmed = line.trim();
    if !trimmed.starts_with(HEADER_PREFIX) {
        return None;
    }
    let value = trimmed.strip_prefix(HEADER_PREFIX)?;
    value.parse().ok()
}

/// 从 reader 读取单个完整 LSP 帧。EOF 时返回 Ok(None)，未读完返回 Ok(None)。
pub fn read_frame<R: BufRead>(reader: &mut R) -> Result<Option<String>, LspError> {
    let mut announced: Option<usize> = None;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).map_err(LspError::Io)?;
        if read == 0 {
            return Ok(None);
        }
        let cleaned = line.trim_end_matches(|c| c == '\r' || c == '\n');
        if cleaned.is_empty() {
            break;
        }
        if let Some(len) = content_length(cleaned) {
            announced = Some(len);
        }
    }
    let len = match announced {
        Some(n) => n,
        None => return Ok(None),
    };
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).map_err(LspError::Io)?;
    Ok(Some(String::from_utf8(buf).map_err(LspError::Utf8)?))
}

/// 把 message 编码为完整 LSP 帧并写入 writer。
pub fn write_frame<W: Write>(writer: &mut W, message: &str) -> Result<(), LspError> {
    let bytes = message.as_bytes();
    let header = format!("Content-Length: {}\r\n\r\n", bytes.len());
    writer.write_all(header.as_bytes()).map_err(LspError::Io)?;
    writer.write_all(bytes).map_err(LspError::Io)?;
    writer.flush().map_err(LspError::Io)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn roundtrips_single_frame() {
        let original = "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":null}";
        let mut bytes: Vec<u8> = Vec::new();
        write_frame(&mut bytes, original).unwrap();
        let mut cursor = Cursor::new(bytes);
        let parsed = read_frame(&mut cursor).unwrap().unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn reads_partial_buffer_returns_none() {
        let mut bytes: Vec<u8> = Vec::new();
        write_frame(&mut bytes, "x").unwrap();
        let mut cursor = Cursor::new(&bytes[..bytes.len() - 5]);
        assert!(read_frame(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn handles_multiple_frames_in_sequence() {
        let mut bytes: Vec<u8> = Vec::new();
        write_frame(&mut bytes, "first").unwrap();
        write_frame(&mut bytes, "second").unwrap();
        let mut cursor = Cursor::new(bytes);
        assert_eq!(read_frame(&mut cursor).unwrap().unwrap(), "first");
        assert_eq!(read_frame(&mut cursor).unwrap().unwrap(), "second");
    }

    #[test]
    fn rejects_invalid_content_length() {
        assert_eq!(content_length("Content-Length: 42"), Some(42));
        assert_eq!(content_length("Garbage: 42"), None);
    }
}
