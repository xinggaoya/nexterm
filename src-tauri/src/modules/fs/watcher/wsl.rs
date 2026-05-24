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
#[cfg(any(test, windows))]
const HELPER_VERSION: &str = env!("CARGO_PKG_VERSION");

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
    event_tx: mpsc::Sender<WorkspaceFsChangedEvent>,
) -> Result<WslRefreshSource, String> {
    #[cfg(not(windows))]
    {
        let _ = distro;
        let _ = root_path;
        let _ = event_tx;
        Err("WSL helper is only available on Windows".into())
    }

    #[cfg(windows)]
    {
        crate::modules::workspace::validate_wsl_distro_name(distro)?;
        let helper_path = install_wsl_helper(distro)?;
        let (stop_tx, stop_rx) = mpsc::channel();
        let current_child = Arc::new(Mutex::new(None));
        let supervisor_child = Arc::clone(&current_child);
        let distro = distro.to_string();
        let thread = std::thread::spawn(move || {
            run_helper_supervisor(
                distro,
                helper_path,
                root_path,
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
}

#[cfg(any(test, windows))]
pub(super) fn workspace_fs_event_from_wsl_json_line(
    root_path: &str,
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
    let git_related = helper_event.git_related || paths.iter().any(|path| is_wsl_git_path(path));
    Ok(Some(WorkspaceFsChangedEvent {
        root_path: normalize_frontend_path(root_path),
        paths,
        git_related,
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
fn run_helper_once(
    distro: &str,
    helper_path: &str,
    root_path: &str,
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
            Ok(line) => match workspace_fs_event_from_wsl_json_line(root_path, &line) {
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

#[cfg(windows)]
fn install_wsl_helper(distro: &str) -> Result<String, String> {
    let arch = supported_helper_arch()?;
    let bytes = helper_asset_bytes()?;
    let home = crate::modules::workspace::wsl_home(distro.to_string())?;
    let path = helper_install_path(&home, arch);
    write_helper_bytes(distro, &path, &bytes)?;
    Ok(path)
}

#[cfg(windows)]
fn supported_helper_arch() -> Result<&'static str, String> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("x86_64"),
        other => Err(format!(
            "WSL watcher helper is not bundled for host architecture {other}"
        )),
    }
}

#[cfg(windows)]
fn helper_asset_bytes() -> Result<Vec<u8>, String> {
    #[cfg(nexterm_wsl_watcher_helper_asset)]
    {
        return Ok(include_bytes!(env!("NEXTERM_WSL_WATCHER_HELPER_ASSET")).to_vec());
    }

    #[cfg(not(nexterm_wsl_watcher_helper_asset))]
    {
        runtime_helper_asset_bytes()
    }
}

#[cfg(all(windows, not(nexterm_wsl_watcher_helper_asset)))]
fn runtime_helper_asset_bytes() -> Result<Vec<u8>, String> {
    let path = std::env::var("NEXTERM_WSL_WATCHER_HELPER")
        .map_err(|_| "bundled WSL watcher helper asset is not configured".to_string())?;
    std::fs::read(&path)
        .map_err(|error| format!("failed to read WSL watcher helper asset {}: {error}", path))
}

#[cfg(windows)]
fn write_helper_bytes(distro: &str, target_path: &str, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut command = Command::new("wsl.exe");
    command
        .arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg("sh")
        .arg("-c")
        .arg("mkdir -p \"$(dirname \"$1\")\" && cat > \"$1\" && chmod 755 \"$1\"")
        .arg("sh")
        .arg(target_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::modules::process::suppress_command_window(&mut command);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "failed to open WSL helper installer stdin".to_string())?;
        stdin.write_all(bytes).map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(
            crate::modules::workspace::decode_command_output(&output.stderr)
                .trim()
                .to_string(),
        )
    }
}

#[cfg(any(test, windows))]
fn helper_install_path(home: &str, arch: &str) -> String {
    format!(
        "{}/.cache/nexterm/watcher/nexterm-wsl-watcher-{}-{}",
        home.trim_end_matches('/'),
        HELPER_VERSION,
        arch
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_install_path_uses_wsl_user_cache() {
        assert_eq!(
            helper_install_path("/home/dev/", "x86_64"),
            format!(
                "/home/dev/.cache/nexterm/watcher/nexterm-wsl-watcher-{}-x86_64",
                HELPER_VERSION
            )
        );
    }

    #[test]
    fn parser_marks_git_paths_even_without_explicit_flag() {
        let event = workspace_fs_event_from_wsl_json_line(
            "/home/dev/repo",
            r#"{"paths":["/home/dev/repo/.git/HEAD"]}"#,
        )
        .expect("valid json")
        .expect("event");

        assert!(event.git_related);
    }
}
