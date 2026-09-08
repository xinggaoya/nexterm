mod io;
#[cfg(windows)]
mod job;
mod session;
pub(crate) mod shell_init;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use tauri::ipc::Channel;

use crate::modules::lock::rwlock_read;
use crate::modules::lock::rwlock_write;
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

/// 本地 ConPTY 会话与 SSH 通道会话的统一抽象:pty_write / pty_resize /
/// pty_kill / pty_close 只面向该 trait,前端协议对传输类型无感知。
pub trait TerminalSession: Send + Sync {
    fn write(&self, data: &str) -> Result<(), String>;
    fn resize(&self, cols: u16, rows: u16) -> Result<(), String>;
    fn kill(&self) -> Result<(), String>;
}

pub struct PtyState {
    sessions: RwLock<HashMap<u32, Arc<dyn TerminalSession>>>,
    next_id: AtomicU32,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

/// 打开一个 PTY 会话。
///
/// `shell_id` 为本地终端 shell profile id（探测白名单内）；None /
/// "auto" 走历史默认顺序，WSL / SSH 环境忽略此参数。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pty_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, PtyState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    auth_secret: Option<String>,
    shell_id: Option<String>,
    workspace: Option<WorkspaceEnv>,
    on_data: Channel<String>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);

    // SSH 分流:cwd 是远端路径,不做宿主注册表校验;凭据经本次调用的
    // auth_secret 提供(前端内存缓存,不落盘)。
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let profile = crate::modules::ssh::profiles::find_profile(&app, profile_id)?;
        let known_hosts = crate::modules::ssh::known_hosts_path(&app)?;
        let session = crate::modules::ssh::terminal::open(
            profile,
            auth_secret.as_deref(),
            known_hosts,
            cwd,
            cols,
            rows,
            on_data,
            on_exit,
        )
        .await?;
        let id = state.next_id.fetch_add(1, Ordering::Relaxed);
        rwlock_write(&state.sessions, "pty sessions")?.insert(id, session);
        log::info!("ssh pty opened id={id} profile={profile_id} cols={cols} rows={rows}");
        return Ok(id);
    }

    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace).map_err(|e| {
        log::warn!("pty_open: cwd rejected: {e}");
        e
    })?;
    let session = tauri::async_runtime::spawn_blocking(move || {
        session::spawn(cols, rows, cwd, shell_id, workspace, on_data, on_exit)
    })
    .await
    .map_err(|e| {
        log::error!("pty_open join failed: {e}");
        e.to_string()
    })?
    .map_err(|e| {
        log::error!("pty_open failed: {e}");
        e
    })?
    .0;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    rwlock_write(&state.sessions, "pty sessions")?.insert(id, session);
    log::info!("pty opened id={id} cols={cols} rows={rows}");
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: tauri::State<PtyState>, id: u32, data: String) -> Result<(), String> {
    state.write_session(id, &data).inspect_err(|e| {
        log::debug!("pty_write id={id} failed: {e}");
    })
}

#[tauri::command]
pub fn pty_resize(
    state: tauri::State<PtyState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize_session(id, cols, rows).inspect_err(|e| {
        log::warn!("pty_resize id={id} failed: {e}");
    })
}

#[tauri::command]
pub fn pty_kill(state: tauri::State<PtyState>, id: u32) -> Result<(), String> {
    let session = rwlock_read(&state.sessions, "pty sessions")
        .ok()
        .and_then(|guard| guard.get(&id).cloned());
    if let Some(s) = session {
        if let Err(e) = s.kill() {
            log::debug!("pty_kill id={id}: kill returned {e}");
        }
        log::info!("pty killed id={id}");
    } else {
        log::debug!("pty_kill: unknown id={id}");
    }
    Ok(())
}

#[tauri::command]
pub fn pty_close(state: tauri::State<PtyState>, id: u32) -> Result<(), String> {
    let session = rwlock_write(&state.sessions, "pty sessions")?.remove(&id);
    if let Some(s) = session {
        if let Err(e) = s.kill() {
            log::debug!("pty_close: kill id={id} returned {e}");
        }
        log::info!("pty closed id={id}");
        std::thread::spawn(move || {
            drop(s);
        });
    } else {
        log::debug!("pty_close: unknown id={id}");
    }
    Ok(())
}
