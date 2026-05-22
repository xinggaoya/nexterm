use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{
    mpsc::{self, Receiver, RecvTimeoutError},
    Mutex,
};
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::modules::workspace::{
    normalize_host_path, resolve_path, WorkspaceEnv, WorkspaceRegistry,
};

const WORKSPACE_FS_CHANGED_EVENT: &str = "nexterm://workspace-fs-changed";
const FS_EVENT_BATCH_DELAY_MS: u64 = 200;

#[derive(Default)]
pub struct FsWatcherState {
    active: Mutex<Option<ActiveWatcher>>,
}

struct ActiveWatcher {
    _watcher: RecommendedWatcher,
    _batch_thread: std::thread::JoinHandle<()>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFsChangedEvent {
    root_path: String,
    paths: Vec<String>,
    git_related: bool,
}

#[tauri::command]
pub fn fs_watch_workspace(
    root_path: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    state: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let local_root = normalize_host_path(
        std::fs::canonicalize(resolve_path(&root_path, &workspace)).map_err(|e| e.to_string())?,
    );
    if !local_root.is_dir() {
        return Err(format!(
            "workspace is not a directory: {}",
            local_root.display()
        ));
    }
    if !registry.is_authorized(&local_root) {
        return Err(format!(
            "workspace is outside the authorized roots: {}",
            local_root.display()
        ));
    }

    let event_root = normalize_frontend_path(&root_path);
    let callback_root = event_root.clone();
    let callback_local_root = local_root.clone();
    let (event_tx, event_rx) = mpsc::channel();
    let batch_app = app.clone();
    let batch_thread = std::thread::spawn(move || run_event_batcher(batch_app, event_rx));
    let callback_event_tx = event_tx.clone();
    let mut watcher = notify::recommended_watcher(move |result| match result {
        Ok(event) => {
            if let Some(event) =
                workspace_fs_event_from_notify(&callback_root, &callback_local_root, event)
            {
                if callback_event_tx.send(event).is_err() {
                    log::debug!("workspace watcher batch receiver closed");
                }
            }
        }
        Err(error) => log::debug!("workspace watcher event failed: {error}"),
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&local_root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let mut active = state.active.lock().expect("fs watcher state poisoned");
    *active = Some(ActiveWatcher {
        _watcher: watcher,
        _batch_thread: batch_thread,
    });
    log::info!("watching workspace: {}", local_root.display());
    Ok(())
}

#[tauri::command]
pub fn fs_unwatch_workspace(state: State<'_, FsWatcherState>) -> Result<(), String> {
    let mut active = state.active.lock().expect("fs watcher state poisoned");
    *active = None;
    Ok(())
}

#[derive(Default)]
struct WorkspaceFsEventBatch {
    root_path: Option<String>,
    paths: BTreeSet<String>,
    git_related: bool,
}

impl WorkspaceFsEventBatch {
    fn add(&mut self, event: WorkspaceFsChangedEvent) {
        if self.root_path.is_none() {
            self.root_path = Some(event.root_path);
        }
        self.paths.extend(event.paths);
        self.git_related |= event.git_related;
    }

    fn is_empty(&self) -> bool {
        self.root_path.is_none() && self.paths.is_empty() && !self.git_related
    }

    fn into_event(self) -> Option<WorkspaceFsChangedEvent> {
        let root_path = self.root_path?;
        if self.paths.is_empty() {
            return None;
        }
        Some(WorkspaceFsChangedEvent {
            root_path,
            paths: self.paths.into_iter().collect(),
            git_related: self.git_related,
        })
    }
}

fn run_event_batcher(app: AppHandle, event_rx: Receiver<WorkspaceFsChangedEvent>) {
    let mut batch = WorkspaceFsEventBatch::default();
    loop {
        if batch.is_empty() {
            match event_rx.recv() {
                Ok(event) => batch.add(event),
                Err(_) => break,
            }
            continue;
        }

        match event_rx.recv_timeout(Duration::from_millis(FS_EVENT_BATCH_DELAY_MS)) {
            Ok(event) => batch.add(event),
            Err(RecvTimeoutError::Timeout) => flush_workspace_batch(&app, &mut batch),
            Err(RecvTimeoutError::Disconnected) => {
                flush_workspace_batch(&app, &mut batch);
                break;
            }
        }
    }
}

fn flush_workspace_batch(app: &AppHandle, batch: &mut WorkspaceFsEventBatch) {
    if let Some(event) = std::mem::take(batch).into_event() {
        emit_workspace_fs_event(app, event);
    }
}

fn emit_workspace_fs_event(app: &AppHandle, event: WorkspaceFsChangedEvent) {
    let _ = app.emit(WORKSPACE_FS_CHANGED_EVENT, event);
}

fn workspace_fs_event_from_notify(
    root_path: &str,
    local_root: &Path,
    event: Event,
) -> Option<WorkspaceFsChangedEvent> {
    if matches!(event.kind, EventKind::Access(_)) {
        return None;
    }
    let mut paths = Vec::new();
    let mut git_related = false;
    for path in event.paths {
        let normalized = normalize_host_path(path);
        if is_git_related_path(local_root, &normalized) {
            git_related = true;
        }
        paths.push(frontend_path_for_event(root_path, local_root, &normalized));
    }
    if paths.is_empty() {
        paths.push(root_path.to_string());
    }
    paths.sort();
    paths.dedup();
    Some(WorkspaceFsChangedEvent {
        root_path: root_path.to_string(),
        paths,
        git_related,
    })
}

fn normalize_frontend_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized == "/" {
        normalized
    } else {
        normalized.trim_end_matches('/').to_string()
    }
}

fn frontend_path_for_event(root_path: &str, local_root: &Path, path: &Path) -> String {
    let root = normalize_frontend_path(root_path);
    let Ok(relative) = path.strip_prefix(local_root) else {
        return path.to_string_lossy().replace('\\', "/");
    };
    let rel = relative.to_string_lossy().replace('\\', "/");
    if rel.is_empty() {
        root
    } else if root == "/" {
        format!("/{rel}")
    } else {
        format!("{root}/{rel}")
    }
}

fn is_git_related_path(local_root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(local_root).unwrap_or(path);
    relative
        .components()
        .any(|component| component.as_os_str() == std::ffi::OsStr::new(".git"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn maps_local_event_paths_to_frontend_paths() {
        let root = PathBuf::from("/tmp/repo");
        let path = root.join("src").join("main.rs");
        assert_eq!(
            frontend_path_for_event("/tmp/repo", &root, &path),
            "/tmp/repo/src/main.rs"
        );
    }

    #[test]
    fn detects_git_related_paths() {
        let root = PathBuf::from("/tmp/repo");
        assert!(is_git_related_path(&root, &root.join(".git").join("index")));
        assert!(!is_git_related_path(
            &root,
            &root.join("src").join("main.rs")
        ));
    }

    #[test]
    fn batches_workspace_events_with_deduped_paths_and_git_flag() {
        let mut batch = WorkspaceFsEventBatch::default();
        batch.add(WorkspaceFsChangedEvent {
            root_path: "/tmp/repo".to_string(),
            paths: vec![
                "/tmp/repo/src/b.rs".to_string(),
                "/tmp/repo/src/a.rs".to_string(),
            ],
            git_related: false,
        });
        batch.add(WorkspaceFsChangedEvent {
            root_path: "/tmp/repo".to_string(),
            paths: vec![
                "/tmp/repo/src/a.rs".to_string(),
                "/tmp/repo/.git/index".to_string(),
            ],
            git_related: true,
        });

        let event = batch.into_event().expect("batch should contain paths");

        assert_eq!(event.root_path, "/tmp/repo");
        assert_eq!(
            event.paths,
            vec![
                "/tmp/repo/.git/index",
                "/tmp/repo/src/a.rs",
                "/tmp/repo/src/b.rs",
            ]
        );
        assert!(event.git_related);
    }

    #[test]
    fn empty_workspace_event_batch_does_not_emit() {
        let batch = WorkspaceFsEventBatch::default();

        assert!(batch.into_event().is_none());
    }
}
