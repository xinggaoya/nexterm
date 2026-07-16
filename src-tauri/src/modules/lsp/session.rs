use std::io::{BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use super::errors::LspError;
use super::framing::{read_frame, write_frame};

pub type SessionId = u32;

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
    child: Arc<Mutex<Child>>,
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

        let mut child = command
            .spawn()
            .map_err(|e| LspError::Spawned(format!("{}: {e}", spec.command)))?;

        let stdin: Box<dyn Write + Send> = Box::new(
            child
                .stdin
                .take()
                .ok_or_else(|| LspError::Spawned("stdin missing".into()))?,
        );
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| LspError::Spawned("stdout missing".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| LspError::Spawned("stderr missing".into()))?;

        let stdin = Arc::new(Mutex::new(stdin));
        let child = Arc::new(Mutex::new(child));

        let channel_reader = channel.clone();
        thread::Builder::new()
            .name(format!("nexterm-lsp-stdout-{id}"))
            .spawn(move || {
                let mut reader = BufReader::new(stdout);
                loop {
                    match read_frame(&mut reader) {
                        Ok(Some(frame)) => {
                            let _ = channel_reader
                                .send(LspMessage::Frame { payload: frame });
                        }
                        Ok(None) => {
                            thread::yield_now();
                        }
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
                let code = match crate::modules::lock::mutex_lock(&child_exit, "lsp child") {
                    Ok(mut c) => c.wait().ok().and_then(|s| s.code()),
                    Err(_) => None,
                };
                let _ = channel_exit.send(LspMessage::Exit { code });
            })
            .map_err(|e| LspError::Spawned(format!("spawn exit thread: {e}")))?;

        Ok(Self { id, child, stdin })
    }

    pub fn write_message(&self, msg: &str) -> Result<(), LspError> {
        let stdin = &mut *self.stdin.lock().map_err(|_| LspError::Poisoned)?;
        write_frame(stdin, msg)?;
        Ok(())
    }

    pub fn kill(&self) -> Result<(), LspError> {
        let child = &mut *self.child.lock().map_err(|_| LspError::Poisoned)?;
        child.kill().map_err(LspError::Io)?;
        Ok(())
    }
}
