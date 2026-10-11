use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;

pub mod commands;
pub mod errors;
pub mod framing;
pub mod mock;
pub mod servers;
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
    /// 会话用 `Arc` 存放：`write` 要做一次阻塞的子进程 stdin 写，如果只在
    /// map 里存裸值，就必须在持有 registry 全局锁的情况下写 —— server 不读
    /// stdin 时管道写满，整个 registry（list/stop/start）一起卡住。
    sessions: Mutex<HashMap<SessionId, Arc<LspSession>>>,
    next_id: AtomicU32,
}

/// 内部 mock 用的保留 language，用于集成测试起一个假的 LSP server。
const MOCK_LANGUAGE: &str = "__mock-lsp__";

impl LspRegistry {
    /// 由 language 解析出可执行的 server 命令。
    ///
    /// **命令只能来自 [`servers`] 白名单。** 前端不能传任意 `command`，
    /// 否则 `lsp_start` 就成了一个「以宿主权限执行任意程序」的接口。
    pub fn resolve_spec(&self, language: &str, cwd: Option<&Path>) -> Option<LspServerSpec> {
        if language == MOCK_LANGUAGE || language == "__mock__" {
            let command = std::env::current_exe().ok()?.to_string_lossy().into_owned();
            return Some(LspServerSpec {
                id: MOCK_LANGUAGE.to_string(),
                language: language.to_string(),
                command,
                args: vec!["--mock-lsp".into()],
                cwd: cwd.map(|p| p.to_string_lossy().into_owned()),
            });
        }
        let cwd = cwd.map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
        servers::resolve_for_language(language, &cwd)
    }

    pub fn spawn(
        &self,
        language: &str,
        cwd: Option<&Path>,
        channel: Channel<LspMessage>,
    ) -> Result<SessionId, LspError> {
        let spec = self.resolve_spec(language, cwd).ok_or_else(|| {
            LspError::Spawned(format!("no language server registered for '{language}'"))
        })?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let session = LspSession::spawn(id, &spec, channel)?;
        let session = Arc::new(session);
        crate::modules::lock::mutex_lock(&self.sessions, "lsp registry")
            .map_err(|_| LspError::Poisoned)?
            .insert(id, session);
        Ok(id)
    }

    pub fn write(&self, id: SessionId, msg: String) -> Result<(), LspError> {
        // 先在锁内 clone 出 Arc，随即放锁，再做阻塞写。
        let session = {
            let guard = crate::modules::lock::mutex_lock(&self.sessions, "lsp registry")
                .map_err(|_| LspError::Poisoned)?;
            Arc::clone(guard.get(&id).ok_or(LspError::UnknownSession(id))?)
        };
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

    /// 终止并清空全部会话。切换工作区 / 应用退出时用得到。
    pub fn kill_all(&self) -> usize {
        let drained: Vec<Arc<LspSession>> = {
            let Ok(mut guard) = crate::modules::lock::mutex_lock(&self.sessions, "lsp registry")
            else {
                return 0;
            };
            guard.drain().map(|(_, s)| s).collect()
        };
        let count = drained.len();
        for session in drained {
            let _ = session.kill();
        }
        count
    }

    pub fn list(&self) -> Vec<LspSessionInfo> {
        let guard = match crate::modules::lock::mutex_lock(&self.sessions, "lsp registry") {
            Ok(g) => g,
            Err(e) => {
                log::warn!("{e}");
                return Vec::new();
            }
        };
        guard
            .iter()
            .map(|(id, session)| LspSessionInfo {
                id: *id,
                language: session.language.clone(),
                spec_id: session.spec_id.clone(),
            })
            .collect()
    }

    pub fn resolve_command(&self, language: &str) -> Option<LspResolvedCommand> {
        let spec = self.resolve_spec(language, None)?;
        Some(LspResolvedCommand {
            command: spec.command,
            args: spec.args,
        })
    }
}

impl Drop for LspRegistry {
    fn drop(&mut self) {
        self.kill_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;

    fn dummy_session(id: SessionId) -> Arc<LspSession> {
        // 用当前测试可执行文件起一个「立刻退出」的子进程占位：kill_all 的
        // 语义是「清空表并确保子进程不在了」，与它是否真有实际工作无关。
        let mut command = std::process::Command::new(std::env::current_exe().expect("current exe"));
        command
            .arg("--nexterm-test-dummy-flag")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = command.spawn().expect("spawn dummy");
        Arc::new(LspSession::for_test(id, child))
    }

    #[test]
    fn unknown_language_resolves_to_none() {
        let registry = LspRegistry::default();
        assert!(registry
            .resolve_spec("definitely-not-a-language", None)
            .is_none());
        assert!(registry
            .resolve_command("definitely-not-a-language")
            .is_none());
    }

    #[test]
    fn known_language_resolves_without_ipc_supplied_command() {
        // 语言 → 命令的映射必须完全在后端完成；这里不要求机器上真的装了
        // server（spec 解析只看白名单表），但要求映射存在或有明确失败原因。
        let registry = LspRegistry::default();
        let spec = registry.resolve_spec("rust", Some(Path::new(".")));
        if let Some(spec) = spec {
            assert_eq!(spec.language, "rust");
            assert!(!spec.command.is_empty());
        }
    }

    #[test]
    fn kill_all_drains_every_session() {
        let registry = LspRegistry::default();
        {
            let mut guard =
                crate::modules::lock::mutex_lock(&registry.sessions, "test").expect("lock");
            guard.insert(1, dummy_session(1));
            guard.insert(2, dummy_session(2));
        }
        assert_eq!(registry.list().len(), 2);
        assert_eq!(registry.kill_all(), 2);
        assert!(registry.list().is_empty());
    }

    #[test]
    fn write_to_unknown_session_errors() {
        let registry = LspRegistry::default();
        assert!(matches!(
            registry.write(42, "{}".into()),
            Err(LspError::UnknownSession(42))
        ));
        assert!(matches!(
            registry.kill(42),
            Err(LspError::UnknownSession(42))
        ));
    }
}
