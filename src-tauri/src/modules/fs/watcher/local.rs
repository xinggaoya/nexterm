use std::path::PathBuf;
use std::sync::mpsc;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::AppHandle;

use super::events::{
    emit_workspace_file_changes, workspace_fs_event_from_notify, WorkspaceFsChangedEvent,
};

pub(super) struct LocalRefreshSource {
    _watcher: RecommendedWatcher,
}

pub(super) fn start_local_watcher(
    app: AppHandle,
    root_path: String,
    local_root: PathBuf,
    has_git_repo: bool,
    event_tx: mpsc::Sender<WorkspaceFsChangedEvent>,
) -> Result<LocalRefreshSource, String> {
    let callback_root = root_path;
    let callback_local_root = local_root.clone();
    let callback_app = app;
    let mut watcher = notify::recommended_watcher(move |result| match result {
        Ok(event) => {
            let Some(broken_down) =
                workspace_fs_event_from_notify(&callback_root, &callback_local_root, has_git_repo, event)
            else {
                return;
            };
            // Per-path `fs:file-changed` events bypass the batcher so the
            // file explorer can react to membership changes immediately.
            // Failure here is logged inside `emit_workspace_file_changes`.
            emit_workspace_file_changes(&callback_app, &broken_down.file_changes);
            if event_tx.send(broken_down.batch).is_err() {
                log::debug!("workspace refresh batch receiver closed");
            }
        }
        Err(error) => log::debug!("workspace watcher event failed: {error}"),
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&local_root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    log::info!("watching local workspace: {}", local_root.display());
    Ok(LocalRefreshSource { _watcher: watcher })
}
