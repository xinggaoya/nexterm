use std::path::PathBuf;
use std::sync::mpsc;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::AppHandle;

use super::events::{workspace_fs_event_from_notify, WorkspaceFsChangedEvent};

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
    let _ = app; // 显式不需要 — per-path 直接 emit 已废弃,所有事件进 batcher。
    let callback_root = root_path;
    let callback_local_root = local_root.clone();
    let mut watcher = notify::recommended_watcher(move |result| match result {
        Ok(event) => {
            let Some(batch_event) = workspace_fs_event_from_notify(
                &callback_root,
                &callback_local_root,
                has_git_repo,
                event,
            ) else {
                return;
            };
            // 全部进 batcher,不再 per-path 直接 emit(原逻辑会导致
            // pnpm install 等大批量写时每文件一个 IPC,叠加 200ms
            // 聚合 batch 等于双倍事件 + 双倍 FileExplorer refresh)。
            // 切回时由前端调 fs_force_flush_workspace 强制 batcher
            // 立即 emit 累积 batch,避免"切回画面卡住等 200ms"。
            if event_tx.send(batch_event).is_err() {
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
