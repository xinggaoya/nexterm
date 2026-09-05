//! serve 主循环:逐行读请求,交给 worker 线程执行,响应经互斥锁写回。
//!
//! 关键约定:stdin EOF 即退出。宿主杀掉 wsl.exe 时管道关闭,agent 随之
//! 退场,不会在发行版里残留孤儿进程 —— 这是依赖 wsl.exe 传输而不自建
//! 守护进程的核心安全设计。

use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::handlers;
use crate::protocol::{Request, Response};

/// 单个请求 worker 线程里发生 panic 时,把 panic 转成 error 响应而不是
/// 静默丢请求(客户端只能等超时)。
fn catch_dispatch(request: &Request) -> Response {
    let request_for_panic = request.clone();
    let closure_request = request.clone();
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        handlers::handle(&closure_request)
    })) {
        Ok(response) => response,
        Err(panic) => {
            let detail = panic
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic".into());
            Response::err(request_for_panic.id, format!("agent panicked: {detail}"))
        }
    }
}

fn write_response<W: Write>(writer: &Arc<Mutex<W>>, response: &Response) -> bool {
    let line = response.to_line();
    let Ok(mut writer) = writer.lock() else {
        return false;
    };
    // 写失败(EPIPE 等)说明宿主已断开;返回 false 让调用方停止工作。
    writer.write_all(line.as_bytes()).is_ok() && writer.flush().is_ok()
}

/// 消费 `input` 里的请求直到 EOF,逐条分发给 worker 线程。
/// 返回表示 stdin 已读完且所有在途请求都已写回。
pub fn serve<R: BufRead, W: Write + Send + 'static>(
    mut input: R,
    output: W,
) -> Result<(), String> {
    let writer = Arc::new(Mutex::new(output));
    let inflight = Arc::new(AtomicUsize::new(0));
    let mut workers = Vec::new();

    loop {
        let mut line = String::new();
        let read = input.read_line(&mut line).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(request) = serde_json::from_str::<Request>(trimmed) else {
            // 无法解析(拿不到 id)只能丢弃;stderr 供人诊断,写失败忽略。
            let _ = writeln!(std::io::stderr(), "nexterm-agent: dropping unparseable request");
            continue;
        };

        let writer = Arc::clone(&writer);
        let inflight = Arc::clone(&inflight);
        inflight.fetch_add(1, Ordering::AcqRel);
        let id = request.id;
        let handle = thread::Builder::new()
            .name(format!("nexterm-agent-req-{id}"))
            .spawn(move || {
                let response = catch_dispatch(&request);
                write_response(&writer, &response);
                inflight.fetch_sub(1, Ordering::AcqRel);
            })
            .map_err(|error| format!("spawn worker: {error}"))?;
        workers.push(handle);
    }

    // stdin 已 EOF;等在途请求写回后再退出。宿主要硬杀直接 kill 进程即可。
    for handle in workers {
        let _ = handle.join();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::mpsc;
    use std::time::Duration;

    /// 线程安全的内存 sink,用于断言 agent 写出的响应行。
    #[derive(Clone)]
    struct SharedSink {
        buffer: Arc<Mutex<Vec<u8>>>,
        notify: mpsc::Sender<()>,
    }

    impl SharedSink {
        fn new() -> (Self, mpsc::Receiver<()>) {
            let (tx, rx) = mpsc::channel();
            (
                Self {
                    buffer: Arc::new(Mutex::new(Vec::new())),
                    notify: tx,
                },
                rx,
            )
        }

        fn text(&self) -> String {
            String::from_utf8(self.buffer.lock().unwrap().clone()).expect("utf8")
        }
    }

    impl Write for SharedSink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.buffer.lock().unwrap().extend_from_slice(buf);
            let _ = self.notify.send(());
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn serve_answers_ping_then_exits_on_eof() {
        let input = Cursor::new(
            b"{\"id\":1,\"method\":\"ping\"}\n{\"id\":2,\"method\":\"fs.stat\",\"params\":{\"path\":\"/definitely/not/here\"}}\n",
        );
        let (sink, notify) = SharedSink::new();
        serve(input, sink.clone()).expect("serve ok");

        // 在途 worker 可能在 serve 返回后极短窗口内才写完,轮询直到齐。
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let text = sink.text();
            if text.contains("\"id\":1") && text.contains("\"id\":2") {
                assert!(text.contains("\"ok\":true"), "ping should succeed: {text}");
                assert!(
                    text.contains("\"ok\":false") && text.contains("\"id\":2"),
                    "missing stat should fail: {text}"
                );
                break;
            }
            assert!(std::time::Instant::now() < deadline, "timed out waiting: {}", sink.text());
            let _ = notify.recv_timeout(Duration::from_millis(50));
        }
    }

    #[test]
    fn serve_skips_blank_and_unparseable_lines() {
        let input = Cursor::new(b"\nnot-json\n{\"id\":5,\"method\":\"ping\"}\n");
        let (sink, notify) = SharedSink::new();
        serve(input, sink.clone()).expect("serve ok");
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !sink.text().contains("\"id\":5") {
            assert!(std::time::Instant::now() < deadline, "timed out");
            let _ = notify.recv_timeout(Duration::from_millis(50));
        }
        assert!(sink.text().contains("\"ok\":true"));
    }
}
