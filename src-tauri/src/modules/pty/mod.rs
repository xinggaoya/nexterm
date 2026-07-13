mod io;
#[cfg(windows)]
mod job;
mod session;
pub(crate) mod shell_init;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use tauri::ipc::Channel;

use crate::modules::lock::{mutex_lock, rwlock_read, rwlock_write};
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
use session::Session;

pub struct PtyState {
    sessions: RwLock<HashMap<u32, Arc<Session>>>,
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

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pty_open(
    state: tauri::State<'_, PtyState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    on_data: Channel<String>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace).map_err(|e| {
        log::warn!("pty_open: cwd rejected: {e}");
        e
    })?;
    let session = tauri::async_runtime::spawn_blocking(move || {
        session::spawn(cols, rows, cwd, workspace, on_data, on_exit)
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
        match mutex_lock(&s.killer, "pty killer") {
            Ok(mut killer) => {
                if let Err(e) = killer.kill() {
                    log::debug!("pty_kill id={id}: kill returned {e}");
                }
            }
            Err(error) => log::warn!("pty_kill id={id}: {error}"),
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
        match mutex_lock(&s.killer, "pty killer") {
            Ok(mut killer) => {
                if let Err(e) = killer.kill() {
                    log::debug!("pty_close: kill id={id} returned {e}");
                }
            }
            Err(error) => log::warn!("pty_close: {error}"),
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
