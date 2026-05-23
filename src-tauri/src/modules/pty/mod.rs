mod da_filter;
#[cfg(windows)]
mod job;
mod remote;
mod session;
pub(crate) mod shell_init;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};
use std::thread;

use serde::Serialize;
use tauri::ipc::{Channel, Response};

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
pub use remote::PtyRemoteSession;
use session::Session;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyTranscriptRead {
    pub start_offset: u64,
    pub next_offset: u64,
    pub total_offset: u64,
    pub data_base64: String,
}

pub struct PtyState {
    sessions: RwLock<HashMap<u32, Arc<Session>>>,
    remote_sessions: RwLock<HashMap<u32, PtyRemoteSession>>,
    // Starts at 1 so freshly-handed-out ids are never 0, which the frontend
    // sometimes treats as "unset". Increments monotonically; never reused.
    next_id: AtomicU32,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            remote_sessions: RwLock::new(HashMap::new()),
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
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace).map_err(|e| {
        log::warn!("pty_open: cwd rejected: {e}");
        e
    })?;
    let remote_cwd = cwd.clone();
    let session = tauri::async_runtime::spawn_blocking(move || {
        session::spawn(cols, rows, cwd, workspace, on_data, on_exit).map(|(s, _)| s)
    })
    .await
    .map_err(|e| {
        log::error!("pty_open join failed: {e}");
        e.to_string()
    })?
    .map_err(|e| {
        log::error!("pty_open failed: {e}");
        e
    })?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.write().unwrap().insert(id, session);
    state.register_remote_session(id, remote_cwd, cols, rows);
    log::info!("pty opened id={id} cols={cols} rows={rows}");
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: tauri::State<PtyState>, id: u32, data: String) -> Result<(), String> {
    state.write_remote_session(id, &data).inspect_err(|e| {
        // EPIPE is expected if the child already exited.
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
    state
        .resize_remote_session(id, cols, rows)
        .inspect_err(|e| {
            log::warn!("pty_resize id={id} failed: {e}");
        })
}

#[tauri::command]
pub fn pty_read_transcript(
    state: tauri::State<PtyState>,
    id: u32,
    since_offset: u64,
    max_bytes: usize,
) -> Result<PtyTranscriptRead, String> {
    state
        .read_remote_transcript(id, since_offset, max_bytes)
        .inspect_err(|_| {
            log::warn!("pty_read_transcript: unknown id={id}");
        })
}

#[tauri::command]
pub fn pty_update_metadata(
    state: tauri::State<PtyState>,
    id: u32,
    title: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    state.update_remote_session_metadata(id, title, cwd)
}

#[tauri::command]
pub fn pty_close(state: tauri::State<PtyState>, id: u32) -> Result<(), String> {
    let session = state.sessions.write().unwrap().remove(&id);
    state.unregister_remote_session(id);
    if let Some(s) = session {
        if let Err(e) = s.killer.lock().unwrap().kill() {
            // Non-fatal: the child may already have exited on its own (e.g. the
            // user ran `exit`). Log so this isn't invisible during debugging.
            log::debug!("pty_close: kill id={id} returned {e}");
        }
        log::info!("pty closed id={id}");
        // Drop the Arc on a detached thread. On Windows `MasterPty`'s Drop
        // calls `ClosePseudoConsole`, which can block until conhost finishes
        // draining its output buffer. Doing it here would freeze the Tauri
        // worker thread that handled this command — and on Windows that
        // sometimes manifests as the closed pane refusing to disappear from
        // the React tree because subsequent IPC stalls behind it.
        thread::Builder::new()
            .name(format!("nexterm-pty-drop-{id}"))
            .spawn(move || {
                let t0 = std::time::Instant::now();
                drop(s);
                log::info!(
                    "pty session id={id} dropped in {}ms",
                    t0.elapsed().as_millis()
                );
            })
            .expect("spawn pty drop thread");
    } else {
        log::debug!("pty_close: unknown id={id}");
    }
    Ok(())
}
