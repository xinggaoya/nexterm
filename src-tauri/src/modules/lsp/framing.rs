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

/// 从 reader 读取单个完整 LSP 帧。
///
/// 三种结果必须区分开，否则调用方无法决定「退出循环」还是「继续读」：
/// - [`Frame::Frame`]：拿到一个完整帧
/// - [`Frame::Eof`]：流已结束（server 退出 / 管道关闭）—— 调用方必须退出循环
/// - [`Frame::Incomplete`]：本次没拿到完整帧（半包，或头里没有
///   `Content-Length`）—— 调用方需要继续读
///
/// 历史上这两种非帧结果都返回 `Ok(None)`，读取循环只能 `yield_now()`
/// 原地重试；EOF 时那就是一个吃满一个核的忙等。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    Frame(String),
    Eof,
    Incomplete,
}

/// 读取单个 LSP 帧。结果语义见 [`Frame`]。
pub fn read_frame<R: BufRead>(reader: &mut R) -> Result<Frame, LspError> {
    let mut announced: Option<usize> = None;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).map_err(LspError::Io)?;
        if read == 0 {
            return Ok(Frame::Eof);
        }
        let cleaned = line.trim_end_matches(&['\r', '\n'][..]);
        if cleaned.is_empty() {
            break;
        }
        if let Some(len) = content_length(cleaned) {
            announced = Some(len);
        }
    }
    let len = match announced {
        Some(n) => n,
        // 头读完了却没声明 Content-Length：输出不合规。交给调用方继续读，
        // 不能当成流结束。
        None => return Ok(Frame::Incomplete),
    };
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).map_err(LspError::Io)?;
    Ok(Frame::Frame(
        String::from_utf8(buf).map_err(LspError::Utf8)?,
    ))
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
        assert_eq!(
            read_frame(&mut cursor).unwrap(),
            Frame::Frame(original.into())
        );
    }

    #[test]
    fn reports_eof_when_stream_is_exhausted() {
        // 回归护栏：EOF 必须与「半包」区分开。历史上两者都返回 Ok(None)，
        // 读取循环因此在 server 退出后永久自旋（吃满一个核）。
        let mut bytes: Vec<u8> = Vec::new();
        write_frame(&mut bytes, "x").unwrap();
        let mut cursor = Cursor::new(bytes);
        assert_eq!(read_frame(&mut cursor).unwrap(), Frame::Frame("x".into()));
        assert_eq!(read_frame(&mut cursor).unwrap(), Frame::Eof);
    }

    #[test]
    fn reports_eof_when_the_stream_ends_mid_frame() {
        // 头部声明了长度但流在帧结束前断掉：read_exact 会报 UnexpectedEof，
        // 若头部本身就断了则直接走到 read == 0。两种都不是「还有半包可读」，
        // 读取循环必须退出而不是原地重试。
        let mut bytes: Vec<u8> = Vec::new();
        write_frame(&mut bytes, "abcdef").unwrap();
        let truncated = &bytes[..bytes.len() - 3];
        let mut cursor = Cursor::new(truncated);
        assert!(matches!(
            read_frame(&mut cursor),
            Ok(Frame::Eof) | Err(LspError::Io(_))
        ));
    }

    #[test]
    fn reports_eof_on_immediately_closed_stream() {
        let mut cursor = Cursor::new(Vec::new());
        assert_eq!(read_frame(&mut cursor).unwrap(), Frame::Eof);
    }

    #[test]
    fn reports_incomplete_when_headers_carry_no_content_length() {
        let mut cursor = Cursor::new(b"X-Nonsense: 1\r\n\r\n".to_vec());
        assert_eq!(read_frame(&mut cursor).unwrap(), Frame::Incomplete);
    }

    #[test]
    fn handles_multiple_frames_in_sequence() {
        let mut bytes: Vec<u8> = Vec::new();
        write_frame(&mut bytes, "first").unwrap();
        write_frame(&mut bytes, "second").unwrap();
        let mut cursor = Cursor::new(bytes);
        assert_eq!(
            read_frame(&mut cursor).unwrap(),
            Frame::Frame("first".into())
        );
        assert_eq!(
            read_frame(&mut cursor).unwrap(),
            Frame::Frame("second".into())
        );
    }

    #[test]
    fn rejects_invalid_content_length() {
        assert_eq!(content_length("Content-Length: 42"), Some(42));
        assert_eq!(content_length("Garbage: 42"), None);
    }
}
