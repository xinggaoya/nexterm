mod events;
mod local;
mod polling;
mod wsl;

use std::path::PathBuf;
use std::sync::{mpsc, Mutex};

use tauri::{AppHandle, State};

use crate::modules::lock::mutex_lock;
use crate::modules::workspace::{
    normalize_host_path, resolve_path, WorkspaceEnv, WorkspaceRegistry,
};

use self::events::{normalize_frontend_path, run_event_batcher, WorkspaceFsChangedEvent};

#[cfg(test)]
use self::events::{
    frontend_path_for_event, is_git_related_path, workspace_fs_event_from_notify,
    WorkspaceFsEventBatch, MAX_BATCH_EVENT_PATHS,
};
#[cfg(test)]
use self::wsl::{workspace_fs_event_from_wsl_json_line, HelperFailureTracker};

#[derive(Default)]
pub struct FsWatcherState {
    active: Mutex<Option<ActiveWatcher>>,
}

struct ActiveWatcher {
    key: String,
    source: Option<ActiveRefreshSource>,
    event_tx: Option<mpsc::Sender<WorkspaceFsChangedEvent>>,
    batch_thread: Option<std::thread::JoinHandle<()>>,
}

#[allow(dead_code)]
enum ActiveRefreshSource {
    Local(local::LocalRefreshSource),
    Wsl(wsl::WslRefreshSource),
    Polling(polling::PollingRefreshSource),
}

impl Drop for ActiveWatcher {
    fn drop(&mut self) {
        self.source.take();
        self.event_tx.take();
        if let Some(thread) = self.batch_thread.take() {
            let _ = thread.join();
        }
    }
}

#[derive(Clone)]
struct WorkspaceRefreshContext {
    key: String,
    root_path: String,
    workspace: WorkspaceEnv,
    local_root: Option<PathBuf>,
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
    let context = build_refresh_context(&root_path, workspace, &registry)?;

    {
        let active = mutex_lock(&state.active, "fs watcher state")?;
        if active
            .as_ref()
            .is_some_and(|watcher| watcher.key == context.key)
        {
            return Ok(());
        }
    }

    let (event_tx, event_rx) = mpsc::channel();
    let batch_app = app.clone();
    let batch_thread = std::thread::Builder::new()
        .name("nexterm-fs-event-batcher".into())
        .spawn(move || run_event_batcher(batch_app, event_rx))
        .map_err(|e| format!("spawn workspace event batcher: {e}"))?;
    let source = start_refresh_source(&context, event_tx.clone());

    let mut active = mutex_lock(&state.active, "fs watcher state")?;
    *active = Some(ActiveWatcher {
        key: context.key,
        source: Some(source),
        event_tx: Some(event_tx),
        batch_thread: Some(batch_thread),
    });
    log::info!("watching workspace refresh source: {}", context.root_path);
    Ok(())
}

#[tauri::command]
pub fn fs_unwatch_workspace(state: State<'_, FsWatcherState>) -> Result<(), String> {
    let mut active = mutex_lock(&state.active, "fs watcher state")?;
    *active = None;
    Ok(())
}

fn build_refresh_context(
    root_path: &str,
    workspace: WorkspaceEnv,
    registry: &WorkspaceRegistry,
) -> Result<WorkspaceRefreshContext, String> {
    let root_path = normalize_frontend_path(root_path);
    let key = workspace_watch_key(&root_path, &workspace);

    if workspace.is_wsl() {
        ensure_wsl_workspace_authorized(&root_path, &workspace, registry)?;
        return Ok(WorkspaceRefreshContext {
            key,
            root_path,
            workspace,
            local_root: None,
        });
    }

    let local_root = canonical_authorized_dir(&root_path, &workspace, registry)?;
    Ok(WorkspaceRefreshContext {
        key,
        root_path,
        workspace,
        local_root: Some(local_root),
    })
}

fn start_refresh_source(
    context: &WorkspaceRefreshContext,
    event_tx: mpsc::Sender<WorkspaceFsChangedEvent>,
) -> ActiveRefreshSource {
    match &context.workspace {
        WorkspaceEnv::Local => {
            let Some(local_root) = context.local_root.clone() else {
                log::warn!("local workspace has no canonical host root; using polling");
                return ActiveRefreshSource::Polling(polling::start_polling_refresh(
                    context.root_path.clone(),
                    event_tx,
                    false,
                ));
            };
            match local::start_local_watcher(
                context.root_path.clone(),
                local_root,
                event_tx.clone(),
            ) {
                Ok(source) => ActiveRefreshSource::Local(source),
                Err(error) => {
                    log::warn!("local workspace watcher unavailable; using polling: {error}");
                    ActiveRefreshSource::Polling(polling::start_polling_refresh(
                        context.root_path.clone(),
                        event_tx,
                        false,
                    ))
                }
            }
        }
        WorkspaceEnv::Wsl { distro } => {
            match wsl::start_wsl_helper(distro, context.root_path.clone(), event_tx.clone()) {
                Ok(source) => ActiveRefreshSource::Wsl(source),
                Err(error) => {
                    log::warn!("WSL workspace watcher unavailable; using polling: {error}");
                    ActiveRefreshSource::Polling(polling::start_polling_refresh(
                        context.root_path.clone(),
                        event_tx,
                        true,
                    ))
                }
            }
        }
    }
}

fn canonical_authorized_dir(
    root_path: &str,
    workspace: &WorkspaceEnv,
    registry: &WorkspaceRegistry,
) -> Result<PathBuf, String> {
    let local_root = normalize_host_path(
        std::fs::canonicalize(resolve_path(root_path, workspace)).map_err(|e| e.to_string())?,
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
    Ok(local_root)
}

fn ensure_wsl_workspace_authorized(
    root_path: &str,
    workspace: &WorkspaceEnv,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    let resolved = resolve_path(root_path, workspace);
    if registry.is_authorized(&resolved) {
        return Ok(());
    }

    match std::fs::canonicalize(&resolved) {
        Ok(path) => {
            let canonical = normalize_host_path(path);
            if registry.is_authorized(&canonical) {
                Ok(())
            } else {
                Err(format!(
                    "workspace is outside the authorized roots: {}",
                    canonical.display()
                ))
            }
        }
        Err(_) => Err(format!(
            "workspace is outside the authorized roots: {}",
            resolved.display()
        )),
    }
}

fn workspace_watch_key(root_path: &str, workspace: &WorkspaceEnv) -> String {
    let root = normalize_frontend_path(root_path);
    match workspace {
        WorkspaceEnv::Local => format!("local:{root}"),
        WorkspaceEnv::Wsl { distro } => format!("wsl:{distro}:{root}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::{Event, EventKind};
    use std::path::Path;

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

    #[test]
    fn large_workspace_event_batch_downgrades_to_root_refresh() {
        let mut batch = WorkspaceFsEventBatch::default();
        batch.add(WorkspaceFsChangedEvent {
            root_path: "/tmp/repo".to_string(),
            paths: (0..=MAX_BATCH_EVENT_PATHS)
                .map(|idx| format!("/tmp/repo/generated/{idx}.ts"))
                .collect(),
            git_related: false,
        });

        let event = batch.into_event().expect("root refresh should emit");

        assert_eq!(event.root_path, "/tmp/repo");
        assert!(event.paths.is_empty());
        assert!(!event.git_related);
    }

    #[test]
    fn notify_events_without_paths_become_root_refreshes() {
        let event = workspace_fs_event_from_notify(
            "/tmp/repo",
            Path::new("/tmp/repo"),
            Event::new(EventKind::Modify(notify::event::ModifyKind::Any)),
        )
        .expect("notify event should become a workspace event");

        assert_eq!(event.root_path, "/tmp/repo");
        assert!(event.paths.is_empty());
    }

    #[test]
    fn parses_wsl_helper_jsonl_into_workspace_events() {
        let event = workspace_fs_event_from_wsl_json_line(
            "/home/dev/repo",
            r#"{"paths":["/home/dev/repo/src/main.rs","/home/dev/repo/.git/index"],"gitRelated":true}"#,
        )
        .expect("valid helper json")
        .expect("helper event should contain paths");

        assert_eq!(event.root_path, "/home/dev/repo");
        assert_eq!(
            event.paths,
            vec![
                "/home/dev/repo/.git/index".to_string(),
                "/home/dev/repo/src/main.rs".to_string(),
            ]
        );
        assert!(event.git_related);
    }

    #[test]
    fn helper_failure_tracker_requests_polling_after_repeated_failures() {
        let mut tracker = HelperFailureTracker::new(3);

        assert!(!tracker.record_failure().should_fallback());
        assert!(!tracker.record_failure().should_fallback());
        assert!(tracker.record_failure().should_fallback());
    }

    #[test]
    fn workspace_watch_key_separates_local_and_wsl_roots() {
        assert_eq!(
            workspace_watch_key("/tmp/repo/", &WorkspaceEnv::Local),
            "local:/tmp/repo"
        );
        assert_eq!(
            workspace_watch_key(
                "/tmp/repo",
                &WorkspaceEnv::Wsl {
                    distro: "Ubuntu".to_string()
                }
            ),
            "wsl:Ubuntu:/tmp/repo"
        );
    }
}
