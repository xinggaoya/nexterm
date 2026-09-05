//! 与单个发行版内 agent 进程的连接:spawn、按 id 路由响应、超时与关闭。
//!
//! 生命周期:reader 线程持有 `Arc<AgentConnection>`,因此关闭必须显式走
//! `shutdown()`(先关 stdin 触发 agent 的 EOF 自杀,再 kill wsl.exe),
//! 不能只依赖 Drop —— 否则 reader 的 Arc 会阻止清理。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde_json::Value;

use super::protocol::{build_request_line, parse_line, Incoming, ParsedLine};

pub(crate) struct AgentConnection {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>,
    next_id: AtomicU64,
    alive: AtomicBool,
}

impl AgentConnection {
    /// 安装并拉起 agent,ping 探活成功才返回连接。
    pub(crate) fn spawn(distro: &str) -> Result<Arc<Self>, String> {
        let agent_path = super::install::ensure_agent_installed(distro)?;
        let mut command = Command::new("wsl.exe");
        command
            .arg("-d")
            .arg(distro)
            .arg("--exec")
            .arg(&agent_path)
            .arg("serve")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::modules::process::suppress_command_window(&mut command);

        let mut child = command
            .spawn()
            .map_err(|error| format!("spawn wsl agent: {error}"))?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let connection = Arc::new(Self {
            child: Mutex::new(Some(child)),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
        });

        if let Some(stderr) = stderr {
            std::thread::Builder::new()
                .name("nexterm-agent-stderr".into())
                .spawn(move || drain_stderr(stderr))
                .map_err(|error| format!("spawn agent stderr thread: {error}"))?;
        }
        let Some(stdout) = stdout else {
            connection.shutdown();
            return Err("agent process has no stdout".into());
        };
        {
            let reader_conn = Arc::clone(&connection);
            std::thread::Builder::new()
                .name("nexterm-agent-reader".into())
                .spawn(move || read_responses(reader_conn, stdout))
                .map_err(|error| format!("spawn agent reader thread: {error}"))?;
        }

        // ping 兼做探活:WSL 冷启动可能要几秒,超时给足。
        let params = Value::Null;
        connection
            .request("ping", params, PING_TIMEOUT)
            .inspect_err(|_| connection.shutdown())?;
        Ok(connection)
    }

    pub(crate) fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }

    /// 单次请求-响应。任何超时/写失败都会让连接自我关闭:此时的通道
    /// 状态已不可信(可能有 worker 仍在跑),必须整体重来。
    pub(crate) fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        if !self.is_alive() {
            return Err("agent connection is closed".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::AcqRel);
        let (tx, rx) = mpsc::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, tx);
        }

        let write_result = match self.stdin.lock() {
            Ok(mut guard) => match guard.as_mut() {
                Some(stdin) => stdin
                    .write_all(build_request_line(id, method, &params).as_bytes())
                    .and_then(|_| stdin.flush())
                    .map_err(|error| format!("agent write failed: {error}")),
                None => Err("agent stdin is closed".into()),
            },
            Err(error) => Err(format!("agent stdin lock poisoned: {error}")),
        };
        if let Err(error) = write_result {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            return Err(error);
        }

        match rx.recv_timeout(timeout) {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(error)) => Err(error),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // 响应超时:通道里可能有乱序/卡死的 worker,连连接一起关掉,
                // 由 manager 下次重建。
                self.shutdown();
                Err("agent request timed out; connection closed".into())
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err("agent response channel closed".into())
            }
        }
    }

    /// 关闭连接:先 drop stdin(agent 约定 stdin EOF 即退出,这是清理
    /// Linux 侧进程的主路径),再 kill wsl.exe 并收割,最后放弃所有在途请求。
    pub(crate) fn shutdown(&self) {
        self.alive.store(false, Ordering::Release);
        if let Ok(mut guard) = self.stdin.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }
}

/// Drop 兜底:正常路径由 manager 显式 shutdown;这里覆盖 reader 线程
/// 已退出且 manager 忘记清理的边角情况。
impl Drop for AgentConnection {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Release);
        if let Ok(mut guard) = self.stdin.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

const PING_TIMEOUT: Duration = Duration::from_secs(15);

fn read_responses(connection: Arc<AgentConnection>, stdout: std::process::ChildStdout) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        match parse_line(&line) {
            ParsedLine::Response(Incoming {
                id,
                ok,
                result,
                error,
            }) => {
                let outcome = if ok {
                    result.ok_or_else(|| "agent response missing result".to_string())
                } else {
                    Err(error.unwrap_or_else(|| "unknown agent error".to_string()))
                };
                if let Ok(mut pending) = connection.pending.lock() {
                    if let Some(sender) = pending.remove(&id) {
                        let _ = sender.send(outcome);
                    }
                }
            }
            ParsedLine::Event(event) => {
                log::debug!("agent event (unused for now): {event}");
            }
            ParsedLine::Ignored => {
                log::debug!("agent sent an unparseable line: {line}");
            }
        }
    }
    // stdout EOF:agent 进程已退出(stdin 被关、崩溃或被杀)。
    connection.alive.store(false, Ordering::Release);
    if let Ok(mut pending) = connection.pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err("agent exited before responding".into()));
        }
    }
}

fn drain_stderr(stderr: std::process::ChildStderr) {
    // stderr 仅用于诊断;限量读,避免异常 agent 刷屏拖住线程。
    let mut reader = BufReader::new(stderr);
    let mut line = String::new();
    let mut logged = 0usize;
    while logged < 50 {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                log::debug!("agent stderr: {}", line.trim_end());
                logged += 1;
            }
        }
    }
}
