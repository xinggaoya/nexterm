#[cfg(windows)]
use std::io::{BufRead, BufReader};
use std::sync::mpsc;
#[cfg(windows)]
use std::sync::{Arc, Mutex};
#[cfg(windows)]
use std::time::Duration;

#[cfg(any(test, windows))]
use serde::Deserialize;

#[cfg(any(test, windows))]
use super::events::normalize_frontend_path;
use super::events::WorkspaceFsChangedEvent;
#[cfg(windows)]
use crate::modules::lock::mutex_lock;

#[cfg(windows)]
const HELPER_FAILURE_LIMIT: usize = 3;
#[cfg(windows)]
const HELPER_RESTART_DELAY: Duration = Duration::from_millis(500);
#[cfg(windows)]
const HELPER_POLLING_INTERVAL: Duration = Duration::from_secs(5);

pub(super) struct WslRefreshSource {
    stop_tx: Option<mpsc::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
    #[cfg(windows)]
    current_child: Arc<Mutex<Option<std::process::Child>>>,
}

impl Drop for WslRefreshSource {
    fn drop(&mut self) {
        if let Some(stop_tx) = self.stop_tx.take() {
            let _ = stop_tx.send(());
        }
        #[cfg(windows)]
        if let Ok(mut child) = self.current_child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
            }
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub(super) fn start_wsl_helper(
    distro: &str,
    root_path: String,
    has_git_repo: bool,
    event_tx: mpsc::Sender<WorkspaceFsChangedEvent>,
) -> Result<WslRefreshSource, String> {
    #[cfg(not(windows))]
    {
        let _ = distro;
        let _ = root_path;
        let _ = has_git_repo;
        let _ = event_tx;
        Err("WSL helper is only available on Windows".into())
    }

    #[cfg(windows)]
    {
        crate::modules::workspace::validate_wsl_distro_name(distro)?;
        // watcher 已并入 nexterm-agent(watch 子命令),安装/拉起复用 agent 通道。
        let helper_path = crate::modules::agent::install::ensure_agent_installed(distro)?;
        let (stop_tx, stop_rx) = mpsc::channel();
        let current_child = Arc::new(Mutex::new(None));
        let supervisor_child = Arc::clone(&current_child);
        let distro = distro.to_string();
        let thread = std::thread::spawn(move || {
            run_helper_supervisor(
                distro,
                helper_path,
                root_path,
                has_git_repo,
                event_tx,
                stop_rx,
                supervisor_child,
            );
        });
        Ok(WslRefreshSource {
            stop_tx: Some(stop_tx),
            thread: Some(thread),
            current_child,
        })
    }
}

#[cfg(any(test, windows))]
#[derive(Deserialize)]
struct WslHelperJsonEvent {
    #[serde(default)]
    paths: Vec<String>,
    #[serde(default, alias = "git_related")]
    git_related: bool,
    /// agent watch 模式提供逐路径类型;缺省(旧 helper 协议)保守按 Modify。
    #[serde(default)]
    kinds: Vec<String>,
}

#[cfg(any(test, windows))]
fn parse_kind(raw: &str) -> Option<super::events::FsChangeKind> {
    match raw {
        "create" => Some(super::events::FsChangeKind::Create),
        "remove" | "delete" => Some(super::events::FsChangeKind::Delete),
        "modify" => Some(super::events::FsChangeKind::Modify),
        _ => None,
    }
}

#[cfg(any(test, windows))]
pub(super) fn workspace_fs_event_from_wsl_json_line(
    root_path: &str,
    has_git_repo: bool,
    line: &str,
) -> Result<Option<WorkspaceFsChangedEvent>, serde_json::Error> {
    let line = line.trim();
    if line.is_empty() {
        return Ok(None);
    }
    let helper_event: WslHelperJsonEvent = serde_json::from_str(line)?;
    let mut paths: Vec<String> = helper_event
        .paths
        .into_iter()
        .map(|path| normalize_frontend_path(&path))
        .collect();
    paths.sort();
    paths.dedup();
    let git_related = has_git_repo
        || helper_event.git_related
        || paths.iter().any(|path| is_wsl_git_path(path));
    // The WSL helper binary doesn't currently report per-path kinds, so
    // we conservatively emit `Modify`. The file explorer already upgrades
    // silent refreshes to a full rebuild when the directory's membership
    // actually changes, so this default can't mask a real create/delete.
    let fallback_kind = super::events::FsChangeKind::Modify;
    let kinds: Vec<super::events::FsChangeKind> = if helper_event.kinds.len() == paths.len() {
        helper_event
            .kinds
            .iter()
            .map(|raw| parse_kind(raw).unwrap_or(fallback_kind))
            .collect()
    } else {
        vec![fallback_kind; paths.len()]
    };
    Ok(Some(WorkspaceFsChangedEvent {
        root_path: normalize_frontend_path(root_path),
        paths,
        git_related,
        kinds,
    }))
}

#[cfg(any(test, windows))]
fn is_wsl_git_path(path: &str) -> bool {
    path.split('/').any(|part| part == ".git")
}

#[cfg(any(test, windows))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct HelperFailureStatus {
    failures: usize,
    fallback_after: usize,
}

#[cfg(any(test, windows))]
impl HelperFailureStatus {
    pub(super) fn should_fallback(self) -> bool {
        self.failures >= self.fallback_after
    }
}

#[cfg(any(test, windows))]
#[derive(Debug, Clone)]
pub(super) struct HelperFailureTracker {
    failures: usize,
    fallback_after: usize,
}

#[cfg(any(test, windows))]
impl HelperFailureTracker {
    pub(super) fn new(fallback_after: usize) -> Self {
        Self {
            failures: 0,
            fallback_after: fallback_after.max(1),
        }
    }

    pub(super) fn record_failure(&mut self) -> HelperFailureStatus {
        self.failures = self.failures.saturating_add(1);
        HelperFailureStatus {
            failures: self.failures,
            fallback_after: self.fallback_after,
        }
    }

    #[cfg(windows)]
    fn reset(&mut self) {
        self.failures = 0;
    }
}

#[cfg(windows)]
fn run_helper_supervisor(
    distro: String,
    helper_path: String,
    root_path: String,
    has_git_repo: bool,
    event_tx: mpsc::Sender<WorkspaceFsChangedEvent>,
    stop_rx: mpsc::Receiver<()>,
    current_child: Arc<Mutex<Option<std::process::Child>>>,
) {
    let mut failures = HelperFailureTracker::new(HELPER_FAILURE_LIMIT);
    loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }

        match run_helper_once(
            &distro,
            &helper_path,
            &root_path,
            has_git_repo,
            &event_tx,
            &stop_rx,
            &current_child,
            &mut failures,
        ) {
            HelperRunResult::Stopped => break,
            HelperRunResult::Exited => {
                let status = failures.record_failure();
                if status.should_fallback() {
                    log::warn!(
                        "WSL watcher helper failed {} times; switching to polling",
                        status.failures
                    );
                    run_fallback_polling(root_path.clone(), event_tx.clone(), stop_rx);
                    break;
                }
                if stop_rx.recv_timeout(HELPER_RESTART_DELAY).is_ok() {
                    break;
                }
            }
        }
    }
}

#[cfg(windows)]
enum HelperRunResult {
    Exited,
    Stopped,
}

#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn run_helper_once(
    distro: &str,
    helper_path: &str,
    root_path: &str,
    has_git_repo: bool,
    event_tx: &mpsc::Sender<WorkspaceFsChangedEvent>,
    stop_rx: &mpsc::Receiver<()>,
    current_child: &Arc<Mutex<Option<std::process::Child>>>,
    failures: &mut HelperFailureTracker,
) -> HelperRunResult {
    use std::process::{Command, Stdio};

    let mut command = Command::new("wsl.exe");
    command
        .arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg(helper_path)
        .arg("watch")
        .arg("--root")
        .arg(root_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::modules::process::suppress_command_window(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            log::warn!("failed to start WSL watcher helper: {error}");
            return HelperRunResult::Exited;
        }
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return HelperRunResult::Exited;
    };

    {
        match mutex_lock(current_child, "WSL watcher child") {
            Ok(mut active) => *active = Some(child),
            Err(error) => {
                log::error!("{error}");
                let _ = child.kill();
                return HelperRunResult::Exited;
            }
        }
    }

    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        if stop_rx.try_recv().is_ok() {
            kill_current_child(current_child);
            clear_current_child(current_child);
            return HelperRunResult::Stopped;
        }
        match line {
            Ok(line) => match workspace_fs_event_from_wsl_json_line(root_path, has_git_repo, &line) {
                Ok(Some(event)) => {
                    failures.reset();
                    if event_tx.send(event).is_err() {
                        kill_current_child(current_child);
                        clear_current_child(current_child);
                        return HelperRunResult::Stopped;
                    }
                }
                Ok(None) => {}
                Err(error) => log::debug!("invalid WSL watcher helper event: {error}"),
            },
            Err(error) => {
                log::debug!("failed reading WSL watcher helper stdout: {error}");
                break;
            }
        }
    }

    wait_current_child(current_child);
    HelperRunResult::Exited
}

#[cfg(windows)]
fn run_fallback_polling(
    root_path: String,
    event_tx: mpsc::Sender<WorkspaceFsChangedEvent>,
    stop_rx: mpsc::Receiver<()>,
) {
    loop {
        match stop_rx.recv_timeout(HELPER_POLLING_INTERVAL) {
            Ok(_) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let event = WorkspaceFsChangedEvent {
                    root_path: root_path.clone(),
                    paths: Vec::new(),
                    git_related: true,
                    kinds: Vec::new(),
                };
                if event_tx.send(event).is_err() {
                    break;
                }
            }
        }
    }
}

#[cfg(windows)]
fn kill_current_child(current_child: &Arc<Mutex<Option<std::process::Child>>>) {
    if let Ok(mut child) = current_child.lock() {
        if let Some(child) = child.as_mut() {
            let _ = child.kill();
        }
    }
}

#[cfg(windows)]
fn wait_current_child(current_child: &Arc<Mutex<Option<std::process::Child>>>) {
    let mut child = match mutex_lock(current_child, "WSL watcher child") {
        Ok(child) => child,
        Err(error) => {
            log::error!("{error}");
            return;
        }
    };
    if let Some(child) = child.as_mut() {
        let _ = child.wait();
    }
    *child = None;
}

#[cfg(windows)]
fn clear_current_child(current_child: &Arc<Mutex<Option<std::process::Child>>>) {
    match mutex_lock(current_child, "WSL watcher child") {
        Ok(mut child) => *child = None,
        Err(error) => log::error!("{error}"),
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_marks_git_paths_even_without_explicit_flag() {
        let event = workspace_fs_event_from_wsl_json_line(
            "/home/dev/repo",
            false,
            r#"{"paths":["/home/dev/repo/.git/HEAD"]}"#,
        )
        .expect("valid json")
        .expect("event");

        assert!(event.git_related);
    }

    #[test]
    fn parser_maps_agent_kinds_per_path() {
        let event = workspace_fs_event_from_wsl_json_line(
            "/home/dev/repo",
            false,
            r#"{"paths":["/home/dev/repo/a","/home/dev/repo/b"],"kinds":["create","remove"]}"#,
        )
        .expect("valid json")
        .expect("event");
        assert_eq!(event.kinds.len(), 2);
        assert!(matches!(event.kinds[0], super::super::events::FsChangeKind::Create));
        assert!(matches!(event.kinds[1], super::super::events::FsChangeKind::Delete));
    }

    #[test]
    fn parser_defaults_to_modify_without_kinds() {
        let event = workspace_fs_event_from_wsl_json_line(
            "/home/dev/repo",
            false,
            r#"{"paths":["/x"]}"#,
        )
        .expect("valid json")
        .expect("event");
        assert!(matches!(event.kinds[0], super::super::events::FsChangeKind::Modify));
    }

    #[test]
    fn parser_marks_source_paths_git_related_when_watcher_owns_a_repo() {
        let event = workspace_fs_event_from_wsl_json_line(
            "/home/dev/repo",
            true,
            r#"{"paths":["/home/dev/repo/src/main.rs"]}"#,
        )
        .expect("valid json")
        .expect("event");

        assert!(event.git_related, "source changes in a git repo must trigger git refresh");
    }
}
