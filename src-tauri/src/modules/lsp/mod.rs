use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::ipc::Channel;

pub mod commands;
pub mod errors;
pub mod framing;
pub mod mock;
pub mod session;

pub use errors::LspError;
pub use session::{LspMessage, LspServerSpec, LspSession, SessionId};

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspResolvedCommand {
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspSessionInfo {
    pub id: SessionId,
    pub language: String,
    pub spec_id: String,
}

#[derive(Default)]
pub struct LspRegistry {
    sessions: Mutex<HashMap<SessionId, LspSession>>,
    next_id: AtomicU32,
}

impl LspRegistry {
    pub fn spawn(
        &self,
        spec: LspServerSpec,
        channel: Channel<LspMessage>,
    ) -> Result<SessionId, LspError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let session = LspSession::spawn(id, &spec, channel)?;
        crate::modules::lock::mutex_lock(&self.sessions, "lsp registry")
            .map_err(|_| LspError::Poisoned)?
            .insert(id, session);
        Ok(id)
    }

    pub fn write(&self, id: SessionId, msg: String) -> Result<(), LspError> {
        let guard = crate::modules::lock::mutex_lock(&self.sessions, "lsp registry")
            .map_err(|_| LspError::Poisoned)?;
        let session = guard.get(&id).ok_or(LspError::UnknownSession(id))?;
        session.write_message(&msg)
    }

    pub fn kill(&self, id: SessionId) -> Result<(), LspError> {
        let session = {
            let mut guard = crate::modules::lock::mutex_lock(&self.sessions, "lsp registry")
                .map_err(|_| LspError::Poisoned)?;
            guard.remove(&id).ok_or(LspError::UnknownSession(id))?
        };
        session.kill()
    }

    pub fn list(&self) -> Vec<LspSessionInfo> {
        let guard = match crate::modules::lock::mutex_lock(&self.sessions, "lsp registry") {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        guard
            .keys()
            .map(|id| LspSessionInfo {
                id: *id,
                language: String::new(),
                spec_id: String::new(),
            })
            .collect()
    }

    pub fn resolve_command(&self, language: &str) -> Option<LspResolvedCommand> {
        match language {
            "__mock-lsp__" | "__mock__" => Some(LspResolvedCommand {
                command: std::env::current_exe()
                    .ok()?
                    .to_string_lossy()
                    .into_owned(),
                args: vec!["--mock-lsp".into()],
            }),
            _ => {
                if let Ok(path) = which::which("rust-analyzer") {
                    return Some(LspResolvedCommand {
                        command: path.to_string_lossy().into_owned(),
                        args: Vec::new(),
                    });
                }
                None
            }
        }
    }
}

impl Drop for LspRegistry {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                let _ = session.kill();
            }
        }
    }
}
