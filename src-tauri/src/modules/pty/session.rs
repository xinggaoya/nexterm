use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtySize};
use tauri::ipc::{Channel, Response};
use tempfile::{Builder as TempFileBuilder, NamedTempFile};

use super::da_filter::DaFilter;
use super::shell_init;
use crate::modules::lock::{condvar_wait_timeout, mutex_lock};
use crate::modules::workspace::WorkspaceEnv;

// Flusher coalesces a short window after first-byte arrival so we send chunks,
// not single bytes. MAX_IDLE is only a safety net for missed signals.
// 6ms (vs 4ms) trades a hair of latency for fewer channel frames during
// sustained bursts (npm install logs, `cat` of large files), which keeps the
// frontend event loop from being preempted by Tauri-channel wakes.
const FLUSH_COALESCE: Duration = Duration::from_millis(6);
const FLUSH_MAX_IDLE: Duration = Duration::from_millis(50);
const READ_BUF: usize = 16 * 1024;
// Cap on buffered-but-not-yet-flushed bytes. On overflow we discard only the
// live channel backlog; the transcript below remains complete and lets the
// frontend fill the offset gap without corrupting xterm state. Widened to
// 6 MiB so a long burst combined with a WebView GC pause does not trigger
// a live drop before the flusher wakes up.
const MAX_PENDING: usize = 6 * 1024 * 1024;
const MAX_TRANSCRIPT_READ: usize = 4 * 1024 * 1024;
pub struct TranscriptRead {
    pub start_offset: u64,
    pub next_offset: u64,
    pub total_offset: u64,
    pub data: Vec<u8>,
}

pub(crate) struct Transcript {
    file: Mutex<NamedTempFile>,
    path: PathBuf,
    offset: AtomicU64,
}

impl Transcript {
    fn new() -> Result<Self, String> {
        let file = TempFileBuilder::new()
            .prefix("nexterm-pty-")
            .suffix(".log")
            .tempfile()
            .map_err(|e| format!("create pty transcript: {e}"))?;
        Ok(Self {
            path: file.path().to_path_buf(),
            file: Mutex::new(file),
            offset: AtomicU64::new(0),
        })
    }

    fn append(&self, bytes: &[u8]) -> Result<u64, String> {
        let start = self.offset.load(Ordering::Acquire);
        {
            let mut file = mutex_lock(&self.file, "pty transcript")?;
            file.as_file_mut()
                .write_all(bytes)
                .map_err(|e| format!("write pty transcript: {e}"))?;
        }
        self.offset.fetch_add(bytes.len() as u64, Ordering::AcqRel);
        Ok(start)
    }

    pub(crate) fn read_from(
        &self,
        since_offset: u64,
        max_bytes: usize,
    ) -> Result<TranscriptRead, String> {
        let total_offset = self.offset.load(Ordering::Acquire);
        let start_offset = since_offset.min(total_offset);
        let remaining = (total_offset - start_offset) as usize;
        let cap = max_bytes.clamp(1, MAX_TRANSCRIPT_READ).min(remaining);
        let data = read_file_range(&self.path, start_offset, cap)?;
        let next_offset = start_offset + data.len() as u64;
        Ok(TranscriptRead {
            start_offset,
            next_offset,
            total_offset,
            data,
        })
    }
}

fn read_file_range(path: &Path, start_offset: u64, max_bytes: usize) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|e| format!("open pty transcript: {e}"))?;
    file.seek(SeekFrom::Start(start_offset))
        .map_err(|e| format!("seek pty transcript: {e}"))?;
    let mut data = Vec::with_capacity(max_bytes);
    file.take(max_bytes as u64)
        .read_to_end(&mut data)
        .map_err(|e| format!("read pty transcript: {e}"))?;
    Ok(data)
}

struct PendingOutput {
    start_offset: Option<u64>,
    bytes: Vec<u8>,
}

impl PendingOutput {
    fn new() -> Self {
        Self {
            start_offset: None,
            bytes: Vec::with_capacity(READ_BUF),
        }
    }

    fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    fn clear(&mut self) {
        self.start_offset = None;
        self.bytes.clear();
    }

    fn push(&mut self, start_offset: u64, bytes: &[u8]) {
        if self.bytes.is_empty() {
            self.start_offset = Some(start_offset);
        }
        self.bytes.extend_from_slice(bytes);
    }

    fn take_frame(&mut self) -> Option<Vec<u8>> {
        if self.bytes.is_empty() {
            return None;
        }
        let start = self.start_offset.take().unwrap_or(0);
        let bytes = std::mem::take(&mut self.bytes);
        let mut frame = Vec::with_capacity(8 + bytes.len());
        frame.extend_from_slice(&start.to_le_bytes());
        frame.extend_from_slice(&bytes);
        Some(frame)
    }
}

pub struct Session {
    // Field drop order is intentional. Rust drops fields top-to-bottom:
    //   1. `_job` — on Windows, closing the Job HANDLE fires
    //      KILL_ON_JOB_CLOSE, terminating the pwsh tree before the master
    //      pipe drops. Without this, ClosePseudoConsole in `master`'s Drop
    //      can block waiting for conhost to drain pending output, freezing
    //      the Tauri worker thread that triggered the close.
    //   2. `killer` — best-effort kill (redundant on Windows once Job
    //      closed, but harmless and required on Unix where there is no Job).
    //   3. `writer` — closes the input side of the master pipe.
    //   4. `master` — last; ClosePseudoConsole on Windows. By now the child
    //      is dead and conhost has nothing left to drain.
    #[cfg(windows)]
    _job: Option<super::job::PtyJob>,
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub(crate) transcript: Arc<Transcript>,
}

impl Drop for Session {
    fn drop(&mut self) {
        // If the session Arc is dropped without an explicit pty_close (e.g.
        // frontend disconnected, window crashed, dev HMR), the reader/flusher
        // threads would otherwise stay alive forever holding the child. Kill
        // the child here so the reader hits EOF and the threads unwind.
        if let Ok(mut k) = self.killer.lock() {
            let _ = k.kill();
        }
    }
}
// Windows ConPTY has a documented race when two `CreatePseudoConsole` calls
// interleave. Unix openpty/fork is fine in parallel.
#[cfg(windows)]
static SPAWN_LOCK: Mutex<()> = Mutex::new(());

struct ChildKillGuard {
    killer: Option<Box<dyn ChildKiller + Send + Sync>>,
}

impl ChildKillGuard {
    fn new(killer: Box<dyn ChildKiller + Send + Sync>) -> Self {
        Self {
            killer: Some(killer),
        }
    }

    fn disarm(&mut self) {
        self.killer = None;
    }
}

impl Drop for ChildKillGuard {
    fn drop(&mut self) {
        if let Some(mut k) = self.killer.take() {
            let _ = k.kill();
        }
    }
}

pub fn spawn(
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<(Arc<Session>, PtySize), String> {
    #[cfg(windows)]
    let _spawn_guard = mutex_lock(&SPAWN_LOCK, "pty spawn")?;

    let pty_system = native_pty_system();
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    let cmd = shell_init::build_command(cwd, workspace)?;
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    // Kill the child if any of the pipe setup below fails so the spawned shell
    // can't outlive an aborted pty_open.
    let mut guard = ChildKillGuard::new(child.clone_killer());
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(
        pair.master.take_writer().map_err(|e| e.to_string())?,
    ));
    guard.disarm();

    #[cfg(windows)]
    let job = match child.process_id() {
        Some(pid) => match super::job::PtyJob::create_for(pid) {
            Ok(j) => Some(j),
            Err(e) => {
                log::warn!("pty job-object setup failed for pid={pid}: {e}");
                None
            }
        },
        None => None,
    };

    let session = Arc::new(Session {
        #[cfg(windows)]
        _job: job,
        killer: Mutex::new(killer),
        writer: writer.clone(),
        master: Mutex::new(pair.master),
        transcript: Arc::new(Transcript::new()?),
    });

    let pending: Arc<(Mutex<PendingOutput>, Condvar)> =
        Arc::new((Mutex::new(PendingOutput::new()), Condvar::new()));
    let done = Arc::new(AtomicBool::new(false));
    let spawn_at = Instant::now();

    let pending_r = pending.clone();
    let transcript_r = session.transcript.clone();
    let writer_for_da = writer.clone();
    let reader_thread = thread::Builder::new()
        .name("nexterm-pty-reader".into())
        .spawn(move || {
            let mut buf = [0u8; READ_BUF];
            let mut filtered: Vec<u8> = Vec::with_capacity(READ_BUF);
            let mut da_filter = DaFilter::new();
            let mut dropped_bytes: u64 = 0;
            let mut logged_first = false;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if !logged_first {
                            logged_first = true;
                            log::debug!("pty first byte after {}ms", spawn_at.elapsed().as_millis());
                        }
                        filtered.clear();
                        da_filter.process(&buf[..n], &mut filtered, |reply| {
                            if let Ok(mut w) = writer_for_da.lock() {
                                let _ = w.write_all(reply);
                            }
                        });
                        if filtered.is_empty() {
                            continue;
                        }
                        let transcript_start = match transcript_r.append(&filtered) {
                            Ok(offset) => offset,
                            Err(e) => {
                                log::error!("{e}");
                                transcript_r.offset.load(Ordering::Acquire)
                            }
                        };
                        let (lock, cv) = &*pending_r;
                        let mut g = match mutex_lock(lock, "pty pending output") {
                            Ok(guard) => guard,
                            Err(error) => {
                                log::error!("{error}");
                                break;
                            }
                        };
                        if g.bytes.len() + filtered.len() > MAX_PENDING {
                            dropped_bytes += g.bytes.len() as u64;
                            g.clear();
                        }
                        g.push(transcript_start, &filtered);
                        cv.notify_one();
                    }
                    Err(e) => {
                        log::debug!("pty reader ended: {e}");
                        break;
                    }
                }
            }
            pending_r.1.notify_one();
            if dropped_bytes > 0 {
                log::warn!(
                    "pty live backpressure: skipped {dropped_bytes} buffered bytes; transcript remains complete (cap {MAX_PENDING})"
                );
            }
        })
        .map_err(|e| format!("spawn pty reader thread: {e}"))?;

    let on_data_flush = on_data.clone();
    let pending_f = pending.clone();
    let done_f = done.clone();
    if let Err(error) = thread::Builder::new()
        .name("nexterm-pty-flusher".into())
        .spawn(move || {
            let (lock, cv) = &*pending_f;
            loop {
                {
                    let mut g = match mutex_lock(lock, "pty pending output") {
                        Ok(guard) => guard,
                        Err(error) => {
                            log::error!("{error}");
                            return;
                        }
                    };
                    while g.is_empty() {
                        if done_f.load(Ordering::Acquire) {
                            return;
                        }
                        match condvar_wait_timeout(cv, g, FLUSH_MAX_IDLE, "pty pending output") {
                            Ok((next, _)) => g = next,
                            Err(error) => {
                                log::error!("{error}");
                                return;
                            }
                        }
                    }
                }
                // Coalesce a short window so a burst flushes as one chunk.
                // Skip the sleep when the buffer is already large to avoid
                // adding latency to high-throughput streams. The threshold
                // was raised from 32 KiB to 48 KiB so that mid-burst
                // wakeups do not interrupt the wider FLUSH_COALESCE window.
                let pending_len = {
                    match mutex_lock(lock, "pty pending output") {
                        Ok(g) => g.bytes.len(),
                        Err(error) => {
                            log::error!("{error}");
                            break;
                        }
                    }
                };
                if pending_len < 48 * 1024 {
                    thread::sleep(FLUSH_COALESCE);
                }
                let frame = match mutex_lock(lock, "pty pending output") {
                    Ok(mut guard) => guard.take_frame(),
                    Err(error) => {
                        log::error!("{error}");
                        break;
                    }
                };
                let Some(frame) = frame else {
                    continue;
                };
                if let Err(e) = on_data_flush.send(Response::new(frame)) {
                    log::debug!("pty flusher exiting, channel closed: {e}");
                    break;
                }
            }
        })
    {
        if let Ok(mut killer) = mutex_lock(&session.killer, "pty killer") {
            let _ = killer.kill();
        }
        return Err(format!("spawn pty flusher thread: {error}"));
    }

    let on_data_exit = on_data;
    let pending_e = pending;
    let done_e = done;
    if let Err(error) = thread::Builder::new()
        .name("nexterm-pty-waiter".into())
        .spawn(move || {
            let code = match child.wait() {
                Ok(status) => status.exit_code() as i32,
                Err(e) => {
                    log::warn!("pty child wait failed: {e}");
                    -1
                }
            };
            // Wait for the reader to hit EOF before taking a final snapshot of
            // `pending`, so the last line of output never races the Exit event.
            #[cfg(windows)]
            {
                let deadline = Instant::now() + Duration::from_millis(50);
                while Instant::now() < deadline && !reader_thread.is_finished() {
                    thread::sleep(Duration::from_millis(5));
                }
            }
            #[cfg(not(windows))]
            if let Err(e) = reader_thread.join() {
                log::error!("pty reader thread panicked: {e:?}");
            }
            let (lock, cv) = &*pending_e;
            let tail = match mutex_lock(lock, "pty pending output") {
                Ok(mut guard) => guard.take_frame(),
                Err(error) => {
                    log::error!("{error}");
                    None
                }
            };
            if let Some(tail) = tail {
                if let Err(e) = on_data_exit.send(Response::new(tail)) {
                    log::debug!("pty final-data send failed (channel closed): {e}");
                }
            }
            done_e.store(true, Ordering::Release);
            cv.notify_all();
            if let Err(e) = on_exit.send(code) {
                log::debug!("pty exit send failed (channel closed): {e}");
            }
        })
    {
        return Err(format!("spawn pty waiter thread: {error}"));
    }

    Ok((session, size))
}
