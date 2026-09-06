pub(crate) mod events;
mod local;
mod polling;
mod wsl;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use tauri::{AppHandle, State};

use crate::modules::lock::mutex_lock;
use crate::modules::workspace::{
    normalize_host_path, resolve_path, WorkspaceEnv, WorkspaceRegistry,
};

use self::events::{normalize_frontend_path, run_event_batcher, FsChangeKind, WorkspaceFsChangedEvent};

#[cfg(test)]
use self::events::{
    frontend_path_for_event, is_git_related_path, workspace_fs_event_from_notify,
    WorkspaceFsEventBatch, MAX_BATCH_EVENT_PATHS,
};
#[cfg(test)]
use self::wsl::{workspace_fs_event_from_wsl_json_line, HelperFailureTracker};

/// Multi-workspace FS watcher state.
///
/// Each open workspace registers its own `ActiveWatcher` keyed by
/// `workspace_watch_key` (scope+root), so multiple workspaces — including
/// mixed local + WSL — can be watched concurrently. This replaced the old
/// single-slot `Option<ActiveWatcher>` that could only track one workspace at
/// a time.
///
/// 内部为 `Arc`:克隆廉价,异步命令壳可以把克隆体安全地 move 进
/// `spawn_blocking` 闭包,而 `State` 借用本身无法跨越 `'static` 边界。
#[derive(Clone, Default)]
pub struct FsWatcherState {
    watchers: Arc<Mutex<HashMap<String, ActiveWatcher>>>,
}

struct ActiveWatcher {
    root_path: String,
    source: Option<ActiveRefreshSource>,
    event_tx: Option<mpsc::Sender<WorkspaceFsChangedEvent>>,
    /// Frontend 在切回 / 卸载时设 true,batcher 循环检测到后立即把
    /// 当前累积 batch 同步 emit,避免"切回时画面卡住等 200ms 窗口"
    /// 的视觉故障。
    flush_request: Arc<AtomicBool>,
    batch_thread: Option<std::thread::JoinHandle<()>>,
}

/// 刷新源的持有容器:各变体在自身 Drop 时停止各自的 watch 线程/handle,
/// 枚举值本身从不被读取 —— 存进 `ActiveWatcher` 就是为了把生命周期绑定
/// 到 watcher 上(`fs_unwatch_workspace` 移除条目时 Drop 链触发停机)。
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
    has_git_repo: bool,
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
    crate::modules::workspace::reject_ssh_unsupported(&workspace, "fs watcher")?;
    let context = build_refresh_context(&root_path, workspace, &registry)?;

    {
        let watchers = mutex_lock(&state.watchers, "fs watcher state")?;
        if watchers.contains_key(&context.key) {
            return Ok(());
        }
    }

    let (event_tx, event_rx) = mpsc::channel();
    let flush_request = Arc::new(AtomicBool::new(false));
    let batch_app = app.clone();
    let batch_flush_request = flush_request.clone();
    let batch_thread = std::thread::Builder::new()
        .name("nexterm-fs-event-batcher".into())
        .spawn(move || run_event_batcher(batch_app, event_rx, batch_flush_request))
        .map_err(|e| format!("spawn workspace event batcher: {e}"))?;
    let source = start_refresh_source(&app, &context, event_tx.clone());

    let mut watchers = mutex_lock(&state.watchers, "fs watcher state")?;
    watchers.insert(
        context.key.clone(),
        ActiveWatcher {
            root_path: context.root_path.clone(),
            source: Some(source),
            event_tx: Some(event_tx),
            flush_request,
            batch_thread: Some(batch_thread),
        },
    );
    log::info!("watching workspace refresh source: {}", context.root_path);
    Ok(())
}

/// Stop watching a specific workspace (identified by root_path + workspace
/// env). Only the matching watcher is dropped; other workspaces keep running.
#[tauri::command]
pub fn fs_unwatch_workspace(
    root_path: String,
    workspace: Option<WorkspaceEnv>,
    state: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    crate::modules::workspace::reject_ssh_unsupported(&workspace, "fs watcher")?;
    let root_path = normalize_frontend_path(&root_path);
    let key = workspace_watch_key(&root_path, &workspace);
    let mut watchers = mutex_lock(&state.watchers, "fs watcher state")?;
    watchers.remove(&key);
    Ok(())
}

/// 强制让 batcher 立即把当前累积 batch emit 到 webview。
///
/// 调用场景：
/// - workspace 从 v-show 隐藏切回可见:切走期间 batcher 200ms 窗口
///   内的累积事件,切回时不能继续等 200ms,否则 explorer / 源码控制
///   看起来"切回来画面不动,等几十 ms 才补出"——这是用户报告的
///   "切回字段内容清空,只有新内容出现才会有内容"类问题的根源。
/// - workspace 即将被卸载:最后一段 FS 变更不能丢。
///
/// 实现是 `AtomicBool` 翻转,batcher 主循环每轮检查并 flush 一次。
/// 即使 batcher 当时正在 `recv_timeout` 阻塞,最长 200ms 后也会自然
/// flush(原窗口过期),所以这是 best-effort 加速,不是唯一兜底。
#[tauri::command]
pub fn fs_force_flush_workspace(
    root_path: String,
    workspace: Option<WorkspaceEnv>,
    state: State<'_, FsWatcherState>,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    crate::modules::workspace::reject_ssh_unsupported(&workspace, "fs watcher")?;
    let root_path = normalize_frontend_path(&root_path);
    let key = workspace_watch_key(&root_path, &workspace);
    let watchers = mutex_lock(&state.watchers, "fs watcher state")?;
    if let Some(watcher) = watchers.get(&key) {
        watcher.flush_request.store(true, Ordering::Release);
    }
    Ok(())
}

/// Emit a workspace-fs-changed event through the active watcher's batcher
/// channel. Used by app-internal fs commands (`fs_write_file`,
/// `fs_create_file`, `fs_rename`, `fs_delete`, etc.) so the file explorer
/// and source-control panel update immediately without depending on the
/// OS-level `notify` round-trip. Falls back to a no-op if no watcher is
/// active for the given root.
///
/// `kinds` is a parallel vector to `paths`; when omitted, callers that
/// don't care about per-path kind default every entry to `Modify`.
pub(crate) fn emit_workspace_fs_changed_with_kinds(
    state: &FsWatcherState,
    root_path: &str,
    paths: Vec<String>,
    git_related: bool,
    kinds: Option<Vec<FsChangeKind>>,
) {
    let watchers = match mutex_lock(&state.watchers, "fs watcher state") {
        Ok(watchers) => watchers,
        Err(error) => {
            log::warn!("{error}");
            return;
        }
    };
    let normalized = normalize_frontend_path(root_path);
    let mut sorted_paths = paths;
    sorted_paths.sort();
    sorted_paths.dedup();
    let kinds = match kinds {
        Some(k) => k,
        None => vec![FsChangeKind::Modify; sorted_paths.len()],
    };
    let event = WorkspaceFsChangedEvent {
        root_path: normalized.clone(),
        paths: sorted_paths,
        git_related,
        kinds,
    };
    // Forward to every watcher whose root matches. In the multi-workspace
    // model a single fs mutate (e.g. `fs_write_file`) may need to notify
    // multiple watchers if the same root is open under different envs.
    let mut delivered = false;
    for watcher in watchers.values() {
        if normalize_frontend_path(&watcher.root_path) != normalized {
            continue;
        }
        if let Some(event_tx) = watcher.event_tx.as_ref() {
            if event_tx.send(event.clone()).is_err() {
                log::debug!(
                    "workspace refresh batch receiver closed during proactive emit"
                );
            }
            delivered = true;
        }
    }
    if !delivered {
        // 该 root 当前没有打开的 watcher(例如工作区未在前台打开):
        // 属正常情形,降为 debug 日志便于排查"改了文件但面板没刷新"。
        log::debug!("no active workspace watcher for {normalized}; proactive emit skipped");
    }
}

fn build_refresh_context(
    root_path: &str,
    workspace: WorkspaceEnv,
    registry: &WorkspaceRegistry,
) -> Result<WorkspaceRefreshContext, String> {
    let root_path = normalize_frontend_path(root_path);
    let key = workspace_watch_key(&root_path, &workspace);
    let has_git_repo = detect_git_repo(registry, &root_path, &workspace);

    if workspace.is_wsl() {
        ensure_wsl_workspace_authorized(&root_path, &workspace, registry)?;
        return Ok(WorkspaceRefreshContext {
            key,
            root_path,
            workspace,
            local_root: None,
            has_git_repo,
        });
    }

    let local_root = canonical_authorized_dir(&root_path, &workspace, registry)?;
    Ok(WorkspaceRefreshContext {
        key,
        root_path,
        workspace,
        local_root: Some(local_root),
        has_git_repo,
    })
}

/// Probe whether the workspace root is inside a git repository. Best-effort:
/// if `git` isn't on PATH or the repo can't be resolved for any reason we
/// fall back to `false` so the watcher still works in non-git directories.
/// Detected once at watcher-startup time; the answer is then plumbed into
/// every emitted `WorkspaceFsChangedEvent` so the source-control panel
/// refreshes even when the file change is not under `.git/...`.
fn detect_git_repo(
    registry: &WorkspaceRegistry,
    root_path: &str,
    workspace: &WorkspaceEnv,
) -> bool {
    match crate::modules::git::operations::resolve_repo(registry, root_path, workspace) {
        Ok(Some(_)) => true,
        Ok(None) => false,
        Err(error) => {
            log::debug!("git repo probe failed for {root_path}: {error}");
            false
        }
    }
}

fn start_refresh_source(
    app: &AppHandle,
    context: &WorkspaceRefreshContext,
    event_tx: mpsc::Sender<WorkspaceFsChangedEvent>,
) -> ActiveRefreshSource {
    let has_git_repo = context.has_git_repo;
    match &context.workspace {
        // SSH 工作区不支持 watcher:fs_watch_workspace 入口已提前拒绝,
        // 此分支不可达,仅为维持 match 穷尽性而保留。
        WorkspaceEnv::Ssh { .. } => {
            unreachable!("ssh workspace watcher is rejected by fs_watch_workspace")
        }
        WorkspaceEnv::Local => {
            let Some(local_root) = context.local_root.clone() else {
                log::warn!("local workspace has no canonical host root; using polling");
                return ActiveRefreshSource::Polling(polling::start_polling_refresh(
                    context.root_path.clone(),
                    event_tx,
                    has_git_repo,
                ));
            };
            match local::start_local_watcher(
                app.clone(),
                context.root_path.clone(),
                local_root,
                has_git_repo,
                event_tx.clone(),
            ) {
                Ok(source) => ActiveRefreshSource::Local(source),
                Err(error) => {
                    log::warn!("local workspace watcher unavailable; using polling: {error}");
                    ActiveRefreshSource::Polling(polling::start_polling_refresh(
                        context.root_path.clone(),
                        event_tx,
                        has_git_repo,
                    ))
                }
            }
        }
        WorkspaceEnv::Wsl { distro } => {
            // The WSL helper doesn't surface per-path change kinds today, so
            // it only feeds the aggregated `fsEvent` channel. The file
            // explorer still works on WSL thanks to the aggregated
            // batch's `kinds: vec![Modify]` default — see
            // `workspace_fs_event_from_wsl_json_line`.
            let _ = app;
            match wsl::start_wsl_helper(distro, context.root_path.clone(), has_git_repo, event_tx.clone()) {
                Ok(source) => ActiveRefreshSource::Wsl(source),
                Err(error) => {
                    log::warn!("WSL workspace watcher unavailable; using polling: {error}");
                    ActiveRefreshSource::Polling(polling::start_polling_refresh(
                        context.root_path.clone(),
                        event_tx,
                        has_git_repo,
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
        WorkspaceEnv::Ssh { profile_id } => format!("ssh:{profile_id}:{root}"),
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
            kinds: vec![FsChangeKind::Modify; 2],
        });
        batch.add(WorkspaceFsChangedEvent {
            root_path: "/tmp/repo".to_string(),
            paths: vec![
                "/tmp/repo/src/a.rs".to_string(),
                "/tmp/repo/.git/index".to_string(),
            ],
            git_related: true,
            kinds: vec![FsChangeKind::Modify, FsChangeKind::Modify],
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
        assert_eq!(event.kinds.len(), event.paths.len());
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
            kinds: vec![FsChangeKind::Modify; MAX_BATCH_EVENT_PATHS + 1],
        });

        let event = batch.into_event().expect("root refresh should emit");

        assert_eq!(event.root_path, "/tmp/repo");
        assert!(event.paths.is_empty());
        assert!(event.kinds.is_empty());
        assert!(!event.git_related);
    }

    #[test]
    fn notify_events_without_paths_become_root_refreshes() {
        let event = workspace_fs_event_from_notify(
            "/tmp/repo",
            Path::new("/tmp/repo"),
            false,
            Event::new(EventKind::Modify(notify::event::ModifyKind::Any)),
        )
        .expect("notify event should become a workspace event");

        assert_eq!(event.root_path, "/tmp/repo");
        assert!(event.paths.is_empty());
        assert!(event.kinds.is_empty());
    }

    #[test]
    fn non_git_paths_marked_git_related_when_workspace_is_a_repo() {
        let event = workspace_fs_event_from_notify(
            "/tmp/repo",
            Path::new("/tmp/repo"),
            true,
            Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
                .add_path(Path::new("/tmp/repo/src/main.rs").to_path_buf()),
        )
        .expect("notify event should become a workspace event");

        assert!(event.git_related, "source changes inside a git repo must trigger git status refresh");
        assert_eq!(event.paths, vec!["/tmp/repo/src/main.rs".to_string()]);
        assert_eq!(event.kinds, vec![FsChangeKind::Modify]);
    }

    #[test]
    fn notify_create_event_emits_create_kind_in_aggregated_event() {
        let event = workspace_fs_event_from_notify(
            "/tmp/repo",
            Path::new("/tmp/repo"),
            false,
            Event::new(EventKind::Create(notify::event::CreateKind::File))
                .add_path(Path::new("/tmp/repo/new.ts").to_path_buf()),
        )
        .expect("notify event should become a workspace event");

        assert_eq!(event.paths, vec!["/tmp/repo/new.ts".to_string()]);
        assert_eq!(event.kinds, vec![FsChangeKind::Create]);
    }

    #[test]
    fn parses_wsl_helper_jsonl_into_workspace_events() {
        let event = workspace_fs_event_from_wsl_json_line(
            "/home/dev/repo",
            false,
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
