use std::io::{BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use shared_child::SharedChild;
use tauri::ipc::Channel;

use super::errors::LspError;
use super::framing::{read_frame, write_frame, Frame};

pub type SessionId = u32;

/// 后端内部使用的 server 描述。
///
/// **它不再来自 IPC。** 前端只传 `language`，具体可执行文件由
/// [`super::servers::resolve_for_language`] 在后端解析 —— 允许 webview
/// 自由指定 `command` 等于给了一个任意进程创建接口。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspServerSpec {
    pub id: String,
    pub language: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LspMessage {
    Frame { payload: String },
    ParseError { message: String },
    Stderr { message: String },
    Exit { code: Option<i32> },
}

pub struct LspSession {
    pub id: SessionId,
    pub language: String,
    pub spec_id: String,
    /// `SharedChild` 而不是 `Mutex<Child>`：退出线程要 `wait()`，`kill()`
    /// 要在它运行期间拿到同一个子进程。用 `Mutex<Child>` 时这两者互斥 ——
    /// 只要 server 还活着，`kill()` 就永远拿不到锁，`lsp_stop` 挂死。
    child: Arc<SharedChild>,
    stdin: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl LspSession {
    pub fn spawn(
        id: SessionId,
        spec: &LspServerSpec,
        channel: Channel<LspMessage>,
    ) -> Result<Self, LspError> {
        let mut command = Command::new(&spec.command);
        command.args(&spec.args);
        if let Some(cwd) = &spec.cwd {
            command.current_dir(cwd);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::modules::process::suppress_command_window(&mut command);

        let mut std_child = command
            .spawn()
            .map_err(|e| LspError::Spawned(format!("{}: {e}", spec.command)))?;

        let stdin: Box<dyn Write + Send> = Box::new(
            std_child
                .stdin
                .take()
                .ok_or_else(|| LspError::Spawned("stdin missing".into()))?,
        );
        let stdout = std_child
            .stdout
            .take()
            .ok_or_else(|| LspError::Spawned("stdout missing".into()))?;
        let stderr = std_child
            .stderr
            .take()
            .ok_or_else(|| LspError::Spawned("stderr missing".into()))?;

        let stdin = Arc::new(Mutex::new(stdin));
        let child = Arc::new(
            SharedChild::new(std_child)
                .map_err(|e| LspError::Spawned(format!("watch child: {e}")))?,
        );

        let channel_reader = channel.clone();
        thread::Builder::new()
            .name(format!("nexterm-lsp-stdout-{id}"))
            .spawn(move || {
                let mut reader = BufReader::new(stdout);
                loop {
                    match read_frame(&mut reader) {
                        Ok(Frame::Frame(payload)) => {
                            let _ = channel_reader.send(LspMessage::Frame { payload });
                        }
                        // 流结束 = server 退出或管道关闭。必须退出循环；历史上的
                        // `yield_now()` 在这里是吃满一个核的忙等。
                        Ok(Frame::Eof) => return,
                        // 半包 / 头部不合规：继续读。`read_line` 会阻塞直到有数据
                        // 或 EOF，不存在忙等。
                        Ok(Frame::Incomplete) => continue,
                        Err(e) => {
                            let _ = channel_reader.send(LspMessage::ParseError {
                                message: e.to_string(),
                            });
                            return;
                        }
                    }
                }
            })
            .map_err(|e| LspError::Spawned(format!("spawn stdout thread: {e}")))?;

        let channel_stderr = channel.clone();
        thread::Builder::new()
            .name(format!("nexterm-lsp-stderr-{id}"))
            .spawn(move || {
                let mut reader = BufReader::new(stderr);
                let mut buf = [0u8; 4096];
                while let Ok(n) = reader.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let _ = channel_stderr.send(LspMessage::Stderr {
                        message: String::from_utf8_lossy(&buf[..n]).to_string(),
                    });
                }
            })
            .map_err(|e| LspError::Spawned(format!("spawn stderr thread: {e}")))?;

        let child_exit = child.clone();
        let channel_exit = channel.clone();
        thread::Builder::new()
            .name(format!("nexterm-lsp-exit-{id}"))
            .spawn(move || {
                // SharedChild 的 wait() 自带内部状态机，可以和 kill() 并发。
                let code = child_exit.wait().ok().and_then(|status| status.code());
                let _ = channel_exit.send(LspMessage::Exit { code });
            })
            .map_err(|e| LspError::Spawned(format!("spawn exit thread: {e}")))?;

        Ok(Self {
            id,
            language: spec.language.clone(),
            spec_id: spec.id.clone(),
            child,
            stdin,
        })
    }

    pub fn write_message(&self, msg: &str) -> Result<(), LspError> {
        let stdin = &mut *self.stdin.lock().map_err(|_| LspError::Poisoned)?;
        write_frame(stdin, msg)?;
        Ok(())
    }

    pub fn kill(&self) -> Result<(), LspError> {
        // server 可能早就退出了；这时 kill 返回的是「已经没有这个进程」一类的
        // 错误。调用方的意图是「确保它不在了」，所以这种失败不该向上传播。
        match self.child.kill() {
            Ok(()) => Ok(()),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::InvalidInput
                ) =>
            {
                log::debug!("lsp session {} already exited", self.id);
                Ok(())
            }
            Err(e) => Err(LspError::Io(e)),
        }
    }
}

#[cfg(test)]
impl LspSession {
    /// 构造一个只用于单元测试的会话：接管一个已启动的子进程，stdin 接到
    /// sink。`kill_all` / `write` 的注册表语义可以用它验证，不需要真的跑
    /// 一个 LSP server。
    pub(crate) fn for_test(id: SessionId, child: std::process::Child) -> Self {
        Self {
            id,
            language: "rust".into(),
            spec_id: "rust".into(),
            child: Arc::new(SharedChild::new(child).expect("wrap test child in SharedChild")),
            stdin: Arc::new(Mutex::new(Box::new(std::io::sink()))),
        }
    }
}
