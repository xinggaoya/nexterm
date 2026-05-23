use std::collections::BTreeSet;
use std::path::Path;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use notify::{Event, EventKind};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const WORKSPACE_FS_CHANGED_EVENT: &str = "nexterm://workspace-fs-changed";
const FS_EVENT_BATCH_DELAY_MS: u64 = 200;
const FS_EVENT_MAX_BATCH_AGE_MS: u64 = 1_000;
const FS_EVENT_REPEATED_SIGNATURE_MIN_INTERVAL_MS: u64 = 1_000;
pub(super) const MAX_BATCH_EVENT_PATHS: usize = 128;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceFsChangedEvent {
    pub(super) root_path: String,
    pub(super) paths: Vec<String>,
    pub(super) git_related: bool,
}

#[derive(Default)]
pub(super) struct WorkspaceFsEventBatch {
    root_path: Option<String>,
    paths: BTreeSet<String>,
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
            return;
        }
        if self.root_refresh {
            return;
        }
        self.paths.extend(event.paths);
        if self.paths.len() > MAX_BATCH_EVENT_PATHS {
            self.root_refresh = true;
            self.paths.clear();
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
            });
        }
        if self.paths.is_empty() {
            return None;
        }
        Some(WorkspaceFsChangedEvent {
            root_path,
            paths: self.paths.into_iter().collect(),
            git_related: self.git_related,
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
        (elapsed < self.min_repeated_interval).then_some(self.min_repeated_interval - elapsed)
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

pub(super) fn run_event_batcher(app: AppHandle, event_rx: Receiver<WorkspaceFsChangedEvent>) {
    let mut batch = WorkspaceFsEventBatch::default();
    let mut batch_started_at: Option<Instant> = None;
    let mut throttle = WorkspaceFsEmissionThrottle::default();
    loop {
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
    let _ = app.emit(WORKSPACE_FS_CHANGED_EVENT, event);
}

pub(super) fn workspace_fs_event_from_notify(
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
        let normalized = crate::modules::workspace::normalize_host_path(path);
        if is_git_related_path(local_root, &normalized) {
            git_related = true;
        }
        paths.push(frontend_path_for_event(root_path, local_root, &normalized));
    }
    paths.sort();
    paths.dedup();
    Some(WorkspaceFsChangedEvent {
        root_path: root_path.to_string(),
        paths,
        git_related,
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
        });
        batch
    }

    #[test]
    fn repeated_single_path_batches_are_throttled_without_path_specific_rules() {
        let mut throttle = WorkspaceFsEmissionThrottle::new(Duration::from_millis(1_000));
        let now = Instant::now();
        let batch = batch_with_paths(&["/tmp/repo/logs/app.log"]);

        assert_eq!(throttle.delay_for(now, &batch), None);
        throttle.record_emit(now, &batch);

        assert_eq!(
            throttle.delay_for(now + Duration::from_millis(250), &batch),
            Some(Duration::from_millis(750))
        );
        assert_eq!(
            throttle.delay_for(now + Duration::from_millis(1_000), &batch),
            None
        );
    }

    #[test]
    fn different_path_batches_are_not_throttled_by_previous_log_writes() {
        let mut throttle = WorkspaceFsEmissionThrottle::new(Duration::from_millis(1_000));
        let now = Instant::now();
        let log_batch = batch_with_paths(&["/tmp/repo/logs/app.log"]);
        let source_batch = batch_with_paths(&["/tmp/repo/src/main.rs"]);

        throttle.record_emit(now, &log_batch);

        assert_eq!(
            throttle.delay_for(now + Duration::from_millis(250), &source_batch),
            None
        );
    }

    #[test]
    fn repeated_root_refresh_batches_are_throttled() {
        let mut throttle = WorkspaceFsEmissionThrottle::new(Duration::from_millis(1_000));
        let now = Instant::now();
        let mut root_batch = WorkspaceFsEventBatch::default();
        root_batch.add(WorkspaceFsChangedEvent {
            root_path: "/tmp/repo".to_string(),
            paths: Vec::new(),
            git_related: true,
        });

        throttle.record_emit(now, &root_batch);

        assert_eq!(
            throttle.delay_for(now + Duration::from_millis(250), &root_batch),
            Some(Duration::from_millis(750))
        );
    }
}
