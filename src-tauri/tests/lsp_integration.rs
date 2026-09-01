use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};

#[test]
fn mock_lsp_responds_to_initialize() {
    let exe = env!("CARGO_BIN_EXE_nexterm");
    let mut child = Command::new(exe)
        .arg("--mock-lsp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn mock-lsp");

    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut reader = BufReader::new(stdout);

    // 1) 写一个 initialize 请求
    let request = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
    let header = format!("Content-Length: {}\r\n\r\n", request.len());
    stdin.write_all(header.as_bytes()).unwrap();
    stdin.write_all(request.as_bytes()).unwrap();
    stdin.flush().unwrap();

    // 2) 读响应帧
    let mut announced: Option<usize> = None;
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line).unwrap();
        if n == 0 {
            panic!("EOF before body");
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length: ") {
            announced = Some(value.parse().unwrap());
        }
    }
    let n = announced.expect("missing Content-Length");
    let mut buf = vec![0u8; n];
    reader.read_exact(&mut buf).unwrap();
    let body = String::from_utf8(buf).unwrap();

    assert!(body.contains("\"id\":1"), "body = {body}");
    assert!(body.contains("\"result\""), "body = {body}");

    // cleanup
    drop(stdin);
    let _ = child.wait();
}
