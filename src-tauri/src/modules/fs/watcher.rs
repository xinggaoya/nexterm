use std::path::Path;
use std::sync::Mutex;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::modules::workspace::{
    normalize_host_path, resolve_path, WorkspaceEnv, WorkspaceRegistry,
};

const WORKSPACE_FS_CHANGED_EVENT: &str = "nexterm://workspace-fs-changed";

#[derive(Default)]
pub struct FsWatcherState {
    active: Mutex<Option<ActiveWatcher>>,
}

struct ActiveWatcher {
    _watcher: RecommendedWatcher,
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
    let callback_app = app.clone();
    let mut watcher = notify::recommended_watcher(move |result| match result {
        Ok(event) => emit_fs_event(&callback_app, &callback_root, &callback_local_root, event),
        Err(error) => log::debug!("workspace watcher event failed: {error}"),
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&local_root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let mut active = state.active.lock().expect("fs watcher state poisoned");
    *active = Some(ActiveWatcher { _watcher: watcher });
    log::info!("watching workspace: {}", local_root.display());
    Ok(())
}

#[tauri::command]
pub fn fs_unwatch_workspace(state: State<'_, FsWatcherState>) -> Result<(), String> {
    let mut active = state.active.lock().expect("fs watcher state poisoned");
    *active = None;
    Ok(())
}

fn emit_fs_event(app: &AppHandle, root_path: &str, local_root: &Path, event: Event) {
    if matches!(event.kind, EventKind::Access(_)) {
        return;
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
    let _ = app.emit(
        WORKSPACE_FS_CHANGED_EVENT,
        WorkspaceFsChangedEvent {
            root_path: root_path.to_string(),
            paths,
            git_related,
        },
    );
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
}
