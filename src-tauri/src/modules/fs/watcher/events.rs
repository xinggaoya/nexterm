use std::collections::BTreeSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{Event, EventKind};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const WORKSPACE_FS_CHANGED_EVENT: &str = "nexterm://workspace-fs-changed";
const FS_EVENT_BATCH_DELAY_MS: u64 = 200;
const FS_EVENT_MAX_BATCH_AGE_MS: u64 = 1_000;
// Tuned down from 1s. The file explorer now drops any silent refresh into
// a full rebuild when the directory's membership changes, so debouncing
// duplicate batches for a full second made rapid file creation feel broken.
// The throttle still only fires when the *path set* repeats verbatim (see
// `WorkspaceFsEmissionThrottle::delay_for`), so genuine new workstreams
// (edits, checkouts, etc.) flow straight through.
const FS_EVENT_REPEATED_SIGNATURE_MIN_INTERVAL_MS: u64 = 250;
pub(super) const MAX_BATCH_EVENT_PATHS: usize = 128;

/// Coarse-grained file-system change kind. The frontend uses this to skip
/// no-op rebuilds on a pure content modify, but it is intentionally lossy:
/// several notify event kinds (e.g. Any/Other) collapse to `modify` so the
/// frontend never has to model the full notify::EventKind taxonomy.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FsChangeKind {
    Create,
    Modify,
    Delete,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceFsChangedEvent {
    pub(super) root_path: String,
    pub(super) paths: Vec<String>,
    pub(super) git_related: bool,
    /// Per-path change kind aligned positionally with `paths`. Missing on
    /// root-refresh batches (paths is empty) and on legacy emitters that
    /// haven't been taught the new field — frontend should treat a missing
    /// `kinds` as `modify` for backwards compatibility.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub(super) kinds: Vec<FsChangeKind>,
}

/// Per-path granular file-change notification. Always emitted *before* the
/// batched `WorkspaceFsChangedEvent` for the same notify event, so the
/// per-path 事件类型已废弃:所有 FS 变更都进 batcher 通道(200ms 聚合),
/// 切回时由前端调 `fs_force_flush_workspace` 强制立即 emit。原先用来
/// 绕开 batcher 立刻发到前端的 `WorkspaceFileChangedEvent` 已删除,
/// 引用方迁到聚合 `WorkspaceFsChangedEvent`(自带 `kinds` 字段,粒度
/// 足够 explorer 区分 create/delete/modify)。

#[derive(Default)]
pub(super) struct WorkspaceFsEventBatch {
    root_path: Option<String>,
    paths: BTreeSet<String>,
    /// Pair of (path, kind) so the aggregated event can re-emit per-path
    /// kinds. Stored separately from `paths` to keep the dedup path cheap
    /// and to drop duplicate kinds for the same path.
    path_kinds: BTreeSet<(String, FsChangeKind)>,
    git_related: bool,
    root_refresh: bool,
}

impl WorkspaceFsEventBatch {
    pub(super) fn add(&mut self, event: WorkspaceFsChangedEvent) {
        if self.root_path.is_none() {
            self.root_path = Some(event.root_path);
        }
        self.git_related |= event.git_related;
        if event.paths.is_empty() {
            self.root_refresh = true;
            self.paths.clear();
            self.path_kinds.clear();
            return;
        }
        if self.root_refresh {
            return;
        }
        for (path, kind) in event.paths.into_iter().zip(event.kinds) {
            self.path_kinds.insert((path.clone(), kind));
        }
        self.paths.extend(self.path_kinds.iter().map(|(p, _)| p.clone()));
        if self.paths.len() > MAX_BATCH_EVENT_PATHS {
            self.root_refresh = true;
            self.paths.clear();
            self.path_kinds.clear();
        }
    }

    fn is_empty(&self) -> bool {
        self.root_path.is_none() && self.paths.is_empty() && !self.git_related && !self.root_refresh
    }

    pub(super) fn into_event(self) -> Option<WorkspaceFsChangedEvent> {
        let root_path = self.root_path?;
        if self.root_refresh {
            return Some(WorkspaceFsChangedEvent {
                root_path,
                paths: Vec::new(),
                git_related: self.git_related,
                kinds: Vec::new(),
            });
        }
        if self.paths.is_empty() {
            return None;
        }
        // Re-zip the surviving path+kind pairs so `kinds` stays positionally
        // aligned with `paths`. A path with multiple kind observations
        // collapses to the strongest (Create > Delete > Modify) since
        // membership-changing kinds must win for the frontend to rebuild.
        let mut pairs: Vec<(String, FsChangeKind)> = self
            .path_kinds
            .into_iter()
            .filter(|(p, _)| self.paths.contains(p))
            .collect();
        pairs.sort_by(|a, b| a.0.cmp(&b.0));
        let mut paths = Vec::with_capacity(pairs.len());
        let mut kinds = Vec::with_capacity(pairs.len());
        for (path, kind) in pairs {
            paths.push(path);
            kinds.push(kind);
        }
        Some(WorkspaceFsChangedEvent {
            root_path,
            paths,
            git_related: self.git_related,
            kinds,
        })
    }

    fn signature(&self) -> WorkspaceFsEventSignature {
        if self.root_refresh {
            return WorkspaceFsEventSignature {
                paths: Vec::new(),
                root_refresh: true,
            };
        }
        WorkspaceFsEventSignature {
            paths: self.paths.iter().cloned().collect(),
            root_refresh: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct WorkspaceFsEventSignature {
    paths: Vec<String>,
    root_refresh: bool,
}

struct WorkspaceFsEmissionThrottle {
    last_signature: Option<WorkspaceFsEventSignature>,
    last_emitted_at: Option<Instant>,
    min_repeated_interval: Duration,
}

impl WorkspaceFsEmissionThrottle {
    fn new(min_repeated_interval: Duration) -> Self {
        Self {
            last_signature: None,
            last_emitted_at: None,
            min_repeated_interval,
        }
    }

    fn delay_for(&self, now: Instant, batch: &WorkspaceFsEventBatch) -> Option<Duration> {
        let last_signature = self.last_signature.as_ref()?;
        if *last_signature != batch.signature() {
            return None;
        }
        let elapsed = now.saturating_duration_since(self.last_emitted_at?);
        if elapsed < self.min_repeated_interval {
            Some(self.min_repeated_interval - elapsed)
        } else {
            None
        }
    }

    fn record_emit(&mut self, now: Instant, batch: &WorkspaceFsEventBatch) {
        self.last_signature = Some(batch.signature());
        self.last_emitted_at = Some(now);
    }
}

impl Default for WorkspaceFsEmissionThrottle {
    fn default() -> Self {
        Self::new(Duration::from_millis(
            FS_EVENT_REPEATED_SIGNATURE_MIN_INTERVAL_MS,
        ))
    }
}

pub(super) fn run_event_batcher(
    app: AppHandle,
    event_rx: Receiver<WorkspaceFsChangedEvent>,
    flush_request: Arc<AtomicBool>,
) {
    let mut batch = WorkspaceFsEventBatch::default();
    let mut batch_started_at: Option<Instant> = None;
    let mut throttle = WorkspaceFsEmissionThrottle::default();
    loop {
        // 检查外部 force_flush 请求:workspace 切回/卸载时调用,要求
        // batcher 立即把当前累积 batch 同步 emit。否则用户切回可见
        // workspace 时 explorer / 源码控制要等满 200ms 窗口才看到
        // 切走期间的变更,看起来"切回画面卡住"。
        if flush_request.swap(false, Ordering::AcqRel) && !batch.is_empty() {
            flush_workspace_batch(&app, &mut batch, &mut throttle);
            batch_started_at = None;
        }

        if batch.is_empty() {
            match event_rx.recv() {
                Ok(event) => {
                    batch_started_at = Some(Instant::now());
                    batch.add(event);
                }
                Err(_) => break,
            }
            continue;
        }

        if batch_age_elapsed(batch_started_at) {
            flush_workspace_batch(&app, &mut batch, &mut throttle);
            batch_started_at = None;
            continue;
        }

        let timeout = next_batch_timeout(batch_started_at);
        match event_rx.recv_timeout(timeout) {
            Ok(event) => batch.add(event),
            Err(RecvTimeoutError::Timeout) => {
                if let Some(delay) = throttle.delay_for(Instant::now(), &batch) {
                    match event_rx.recv_timeout(delay) {
                        Ok(event) => batch.add(event),
                        Err(RecvTimeoutError::Timeout) => {
                            flush_workspace_batch(&app, &mut batch, &mut throttle);
                            batch_started_at = None;
                        }
                        Err(RecvTimeoutError::Disconnected) => {
                            flush_workspace_batch(&app, &mut batch, &mut throttle);
                            break;
                        }
                    }
                } else {
                    flush_workspace_batch(&app, &mut batch, &mut throttle);
                    batch_started_at = None;
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                flush_workspace_batch(&app, &mut batch, &mut throttle);
                break;
            }
        }
    }
    // 退出前最后一次 flush(可能还有未到窗口的累积)——channel 关闭时
    // 也就是 workspace 被卸载,需要把最后一段变更 emit 出去避免丢失。
    if !batch.is_empty() {
        flush_workspace_batch(&app, &mut batch, &mut throttle);
    }
}

fn batch_age_elapsed(batch_started_at: Option<Instant>) -> bool {
    batch_started_at
        .map(|started| started.elapsed() >= Duration::from_millis(FS_EVENT_MAX_BATCH_AGE_MS))
        .unwrap_or(false)
}

fn next_batch_timeout(batch_started_at: Option<Instant>) -> Duration {
    let batch_delay = Duration::from_millis(FS_EVENT_BATCH_DELAY_MS);
    let max_age = Duration::from_millis(FS_EVENT_MAX_BATCH_AGE_MS);
    let Some(started) = batch_started_at else {
        return batch_delay;
    };
    let remaining_age = max_age.saturating_sub(started.elapsed());
    batch_delay.min(remaining_age)
}

fn flush_workspace_batch(
    app: &AppHandle,
    batch: &mut WorkspaceFsEventBatch,
    throttle: &mut WorkspaceFsEmissionThrottle,
) {
    throttle.record_emit(Instant::now(), batch);
    if let Some(event) = std::mem::take(batch).into_event() {
        emit_workspace_fs_event(app, event);
    }
}

fn emit_workspace_fs_event(app: &AppHandle, event: WorkspaceFsChangedEvent) {
    if let Err(error) = app.emit(WORKSPACE_FS_CHANGED_EVENT, event) {
        // webview 端 dispose / 卸载后 emit 失败,这里 log 出来便于排障
        // (原本 let _ = 静默吞掉,曾掩盖过 AppHandle 在卸载流程中被
        // 释放前 batcher 仍持有引用 emit 的情况)。
        log::debug!("workspace-fs-changed emit failed: {error}");
    }
}

pub(super) fn notify_event_kind(event: &Event) -> FsChangeKind {
    match &event.kind {
        EventKind::Create(_) => FsChangeKind::Create,
        EventKind::Remove(_) => FsChangeKind::Delete,
        EventKind::Modify(_)
        | EventKind::Any
        | EventKind::Other
        | EventKind::Access(_) => FsChangeKind::Modify,
    }
}

pub(super) fn workspace_fs_event_from_notify(
    root_path: &str,
    local_root: &Path,
    has_git_repo: bool,
    event: Event,
) -> Option<WorkspaceFsChangedEvent> {
    if matches!(event.kind, EventKind::Access(_)) {
        return None;
    }
    let mut paths = Vec::new();
    let mut kinds = Vec::new();
    let mut git_related = has_git_repo;
    let kind = notify_event_kind(&event);
    for path in event.paths {
        let normalized = crate::modules::workspace::normalize_host_path(path);
        if is_git_related_path(local_root, &normalized) {
            git_related = true;
        }
        let frontend_path = frontend_path_for_event(root_path, local_root, &normalized);
        paths.push(frontend_path);
        kinds.push(kind);
    }
    // Parallel zipped vectors must agree in length — pairing them
    // through `(paths, kinds).into_iter()` keeps any future length
    // refactor honest.
    let mut zipped: Vec<(String, FsChangeKind)> = paths.into_iter().zip(kinds).collect();
    zipped.sort_by(|a, b| a.0.cmp(&b.0));
    let (sorted_paths, sorted_kinds): (Vec<String>, Vec<FsChangeKind>) =
        zipped.into_iter().unzip();
    Some(WorkspaceFsChangedEvent {
        root_path: root_path.to_string(),
        paths: sorted_paths,
        git_related,
        kinds: sorted_kinds,
    })
}

pub(super) fn normalize_frontend_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized == "/" {
        normalized
    } else {
        normalized.trim_end_matches('/').to_string()
    }
}

pub(super) fn frontend_path_for_event(root_path: &str, local_root: &Path, path: &Path) -> String {
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

pub(super) fn is_git_related_path(local_root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(local_root).unwrap_or(path);
    relative
        .components()
        .any(|component| component.as_os_str() == std::ffi::OsStr::new(".git"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch_with_paths(paths: &[&str]) -> WorkspaceFsEventBatch {
        let mut batch = WorkspaceFsEventBatch::default();
        batch.add(WorkspaceFsChangedEvent {
            root_path: "/tmp/repo".to_string(),
            paths: paths.iter().map(|path| (*path).to_string()).collect(),
            git_related: false,
            kinds: vec![FsChangeKind::Modify; paths.len()],
        });
        batch
    }

    #[test]
    fn repeated_single_path_batches_are_throttled_without_path_specific_rules() {
        let mut throttle = WorkspaceFsEmissionThrottle::new(Duration::from_millis(250));
        let now = Instant::now();
        let batch = batch_with_paths(&["/tmp/repo/logs/app.log"]);

        assert_eq!(throttle.delay_for(now, &batch), None);
        throttle.record_emit(now, &batch);

        assert_eq!(
            throttle.delay_for(now + Duration::from_millis(100), &batch),
            Some(Duration::from_millis(150))
        );
        assert_eq!(
            throttle.delay_for(now + Duration::from_millis(250), &batch),
            None
        );
    }

    #[test]
    fn different_path_batches_are_not_throttled_by_previous_log_writes() {
        let mut throttle = WorkspaceFsEmissionThrottle::new(Duration::from_millis(250));
        let now = Instant::now();
        let log_batch = batch_with_paths(&["/tmp/repo/logs/app.log"]);
        let source_batch = batch_with_paths(&["/tmp/repo/src/main.rs"]);

        throttle.record_emit(now, &log_batch);

        assert_eq!(
            throttle.delay_for(now + Duration::from_millis(100), &source_batch),
            None
        );
    }

    #[test]
    fn repeated_root_refresh_batches_are_throttled() {
        let mut throttle = WorkspaceFsEmissionThrottle::new(Duration::from_millis(250));
        let now = Instant::now();
        let mut root_batch = WorkspaceFsEventBatch::default();
        root_batch.add(WorkspaceFsChangedEvent {
            root_path: "/tmp/repo".to_string(),
            paths: Vec::new(),
            git_related: true,
            kinds: Vec::new(),
        });

        throttle.record_emit(now, &root_batch);

        assert_eq!(
            throttle.delay_for(now + Duration::from_millis(100), &root_batch),
            Some(Duration::from_millis(150))
        );
    }

    #[test]
    fn expired_repeated_batches_do_not_underflow_delay() {
        let mut throttle = WorkspaceFsEmissionThrottle::new(Duration::from_millis(250));
        let now = Instant::now();
        let batch = batch_with_paths(&["/tmp/repo/.git/index"]);

        throttle.record_emit(now, &batch);

        assert_eq!(
            throttle.delay_for(now + Duration::from_millis(500), &batch),
            None
        );
    }
}
