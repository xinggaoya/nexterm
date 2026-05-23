use std::path::PathBuf;
use std::sync::mpsc;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use super::events::{workspace_fs_event_from_notify, WorkspaceFsChangedEvent};

pub(super) struct LocalRefreshSource {
    _watcher: RecommendedWatcher,
}

pub(super) fn start_local_watcher(
    root_path: String,
    local_root: PathBuf,
    event_tx: mpsc::Sender<WorkspaceFsChangedEvent>,
) -> Result<LocalRefreshSource, String> {
    let callback_root = root_path;
    let callback_local_root = local_root.clone();
    let mut watcher = notify::recommended_watcher(move |result| match result {
        Ok(event) => {
            if let Some(event) =
                workspace_fs_event_from_notify(&callback_root, &callback_local_root, event)
            {
                if event_tx.send(event).is_err() {
                    log::debug!("workspace refresh batch receiver closed");
                }
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
