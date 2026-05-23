use std::sync::mpsc;
use std::time::Duration;

use super::events::WorkspaceFsChangedEvent;

const FALLBACK_REFRESH_INTERVAL: Duration = Duration::from_secs(5);

pub(super) struct PollingRefreshSource {
    stop_tx: Option<mpsc::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for PollingRefreshSource {
    fn drop(&mut self) {
        if let Some(stop_tx) = self.stop_tx.take() {
            let _ = stop_tx.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub(super) fn start_polling_refresh(
    root_path: String,
    event_tx: mpsc::Sender<WorkspaceFsChangedEvent>,
    git_related: bool,
) -> PollingRefreshSource {
    let (stop_tx, stop_rx) = mpsc::channel();
    let thread = std::thread::spawn(move || loop {
        match stop_rx.recv_timeout(FALLBACK_REFRESH_INTERVAL) {
            Ok(_) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let event = WorkspaceFsChangedEvent {
                    root_path: root_path.clone(),
                    paths: Vec::new(),
                    git_related,
                };
                if event_tx.send(event).is_err() {
                    break;
                }
            }
        }
    });

    PollingRefreshSource {
        stop_tx: Some(stop_tx),
        thread: Some(thread),
    }
}
