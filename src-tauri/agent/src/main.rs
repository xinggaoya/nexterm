//! `nexterm-agent` 入口:无参数或 `serve` 进入 JSON-lines 服务循环。

fn main() {
    match std::env::args().nth(1).as_deref() {
        None | Some("serve") => {
            let stdin = std::io::stdin();
            // StdoutLock 不保证 Send,直接传 Stdout(内部逐调用加锁)。
            let stdout = std::io::stdout();
            if let Err(error) = nexterm_agent::server::serve(stdin.lock(), stdout) {
                // 写 stderr 失败(宿主已断开)也无需再处理,直接退出。
                let _ = std::io::Write::write_all(
                    &mut std::io::stderr().lock(),
                    format!("nexterm-agent: {error}\n").as_bytes(),
                );
                std::process::exit(1);
            }
        }
        Some("once") => {
            // 单次模式:从 stdin 读一条请求,写回一条响应即退出。
            // 用于无持久通道的传输(如 SSH 逐通道 exec),连接成本由
            // 传输层承担。
            use std::io::BufRead;
            let mut line = String::new();
            let stdin = std::io::stdin();
            match stdin.lock().read_line(&mut line) {
                Ok(0) => std::process::exit(2),
                Ok(_) => {}
                Err(_) => std::process::exit(2),
            }
            let response = match serde_json::from_str::<nexterm_agent::protocol::Request>(
                line.trim(),
            ) {
                Ok(request) => nexterm_agent::handlers::handle(&request),
                Err(error) => {
                    nexterm_agent::protocol::Response::err(0, format!("bad request: {error}"))
                }
            };
            let stdout = std::io::stdout();
            let mut lock = stdout.lock();
            use std::io::Write;
            let _ = lock.write_all(response.to_line().as_bytes());
            let _ = lock.flush();
        }
        Some("watch") => {
            if let Err(error) = nexterm_agent::watch::run_watch() {
                let _ = std::io::Write::write_all(
                    &mut std::io::stderr().lock(),
                    format!("nexterm-agent: {error}\n").as_bytes(),
                );
                std::process::exit(1);
            }
        }
        Some("--version") => {
            println!("nexterm-agent {}", env!("CARGO_PKG_VERSION"));
        }
        Some(other) => {
            let _ = std::io::Write::write_all(
                &mut std::io::stderr().lock(),
                format!("usage: nexterm-agent [serve|once|watch|--version], got: {other}\n").as_bytes(),
            );
            std::process::exit(2);
        }
    }
}
