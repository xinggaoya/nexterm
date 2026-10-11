use std::path::PathBuf;
use std::sync::mpsc;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::AppHandle;

use super::super::exclude::should_prune_dir_path;
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
    // 按目录逐个注册，而不是对 root 一把 `RecursiveMode::Recursive`。
    //
    // 这一步不是优化而是**可用性前提**：
    // - Linux 上 `fs.inotify.max_user_watches` 默认 8192，一个带 node_modules
    //   的工作区轻松超过，`Recursive` 直接 watch 失败；
    // - macOS 的 FSEvents 在 `pnpm install` / `cargo build` 期间事件洪水会
    //   打满回调线程，把整条 FS 刷新链路堵住。
    //
    // `notify` 的 Config 没有 exclude 能力，所以只能自己枚举：root 本身
    // 非递归 watch（新增顶层目录仍能被发现），它的每个非排除子目录递归 watch。
    // 排除规则与文件树、搜索共用 `super::super::exclude`，否则会出现
    // 「树里没有但 watcher 一直在报」这类不一致。
    let mut failed = Vec::new();
    watcher
        .watch(&local_root, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    for child in std::fs::read_dir(&local_root)
        .map_err(|e| format!("read_dir({}): {e}", local_root.display()))?
        .flatten()
    {
        let path = child.path();
        if !path.is_dir() || should_prune_dir_path(&path) {
            continue;
        }
        // 单个子目录失败（权限、并发删除）不该让整个工作区 watch 失败 ——
        // 记下来继续，最终用 warn 汇总。
        if watcher.watch(&path, RecursiveMode::Recursive).is_err() {
            failed.push(path.display().to_string());
        }
    }
    if !failed.is_empty() {
        log::warn!(
            "workspace watcher skipped {} excluded/unreadable directories under {}: {}",
            failed.len(),
            local_root.display(),
            failed.join(", ")
        );
    }

    log::info!("watching local workspace: {}", local_root.display());
    Ok(LocalRefreshSource { _watcher: watcher })
}
