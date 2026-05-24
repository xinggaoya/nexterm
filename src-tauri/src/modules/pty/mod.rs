mod da_filter;
mod io;
#[cfg(windows)]
mod job;
mod session;
pub(crate) mod shell_init;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};
use std::thread;

use serde::Serialize;
use tauri::ipc::{Channel, Response};

use crate::modules::lock::{mutex_lock, rwlock_write};
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
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
    // Starts at 1 so freshly-handed-out ids are never 0, which the frontend
    // sometimes treats as "unset". Increments monotonically; never reused.
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
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace).map_err(|e| {
        log::warn!("pty_open: cwd rejected: {e}");
        e
    })?;
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
    rwlock_write(&state.sessions, "pty sessions")?.insert(id, session);
    log::info!("pty opened id={id} cols={cols} rows={rows}");
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: tauri::State<PtyState>, id: u32, data: String) -> Result<(), String> {
    state.write_session(id, &data).inspect_err(|e| {
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
    state.resize_session(id, cols, rows).inspect_err(|e| {
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
        .read_transcript(id, since_offset, max_bytes)
        .inspect_err(|_| {
            log::warn!("pty_read_transcript: unknown id={id}");
        })
}

#[tauri::command]
pub fn pty_close(state: tauri::State<PtyState>, id: u32) -> Result<(), String> {
    let session = rwlock_write(&state.sessions, "pty sessions")?.remove(&id);
    if let Some(s) = session {
        match mutex_lock(&s.killer, "pty killer") {
            Ok(mut killer) => {
                if let Err(e) = killer.kill() {
                    // Non-fatal: the child may already have exited on its own (e.g. the
                    // user ran `exit`). Log so this isn't invisible during debugging.
                    log::debug!("pty_close: kill id={id} returned {e}");
                }
            }
            Err(error) => log::warn!("pty_close: {error}"),
        }
        log::info!("pty closed id={id}");
        // Drop the Arc on a detached thread. On Windows `MasterPty`'s Drop
        // calls `ClosePseudoConsole`, which can block until conhost finishes
        // draining its output buffer. Doing it here would freeze the Tauri
        // worker thread that handled this command — and on Windows that
        // sometimes manifests as the closed pane refusing to disappear from
        // the React tree because subsequent IPC stalls behind it.
        if let Err(error) = thread::Builder::new()
            .name(format!("nexterm-pty-drop-{id}"))
            .spawn(move || {
                let t0 = std::time::Instant::now();
                drop(s);
                log::info!(
                    "pty session id={id} dropped in {}ms",
                    t0.elapsed().as_millis()
                );
            })
        {
            log::warn!("spawn pty drop thread failed for id={id}: {error}");
        }
    } else {
        log::debug!("pty_close: unknown id={id}");
    }
    Ok(())
}
