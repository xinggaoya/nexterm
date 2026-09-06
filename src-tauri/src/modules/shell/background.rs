use std::io::Read;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::SystemTime;

use serde::Serialize;
use shared_child::SharedChild;

use super::ringbuffer::BoundedRingBuffer;
use crate::modules::lock::mutex_lock;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const RING_CAP: usize = 4 * 1024 * 1024;

pub struct BackgroundProc {
    pub command: String,
    pub cwd: Option<String>,
    pub started_at_ms: u64,
    pub child: Arc<SharedChild>,
    pub buffer: Mutex<BoundedRingBuffer>,
    pub exited: AtomicBool,
    pub exit_code: AtomicI32,
    pub exit_unknown: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundLogResponse {
    pub bytes: String,
    pub next_offset: u64,
    pub dropped: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundProcInfo {
    pub handle: u32,
    pub command: String,
    pub cwd: Option<String>,
    pub started_at_ms: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

impl BackgroundProc {
    pub fn read_logs(&self, since: u64) -> BackgroundLogResponse {
        // Use `mutex_lock` so a poisoned buffer (from an earlier panic in the
        // drain threads) surfaces as an empty response rather than crashing
        // the IPC handler. The lock is held only for the ringbuffer read.
        let (bytes, next_offset, dropped) = match mutex_lock(&self.buffer, "background buffer") {
            Ok(guard) => guard.read_from(since),
            Err(error) => {
                log::warn!("background log buffer unavailable: {error}");
                (Vec::new(), since, 0)
            }
        };
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundLogResponse {
            bytes: String::from_utf8_lossy(&bytes).into_owned(),
            next_offset,
            dropped,
            exited,
            exit_code,
        }
    }

    pub fn kill(&self) {
        let _ = self.child.kill();
    }

    pub fn info(&self, handle: u32) -> BackgroundProcInfo {
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundProcInfo {
            handle,
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            started_at_ms: self.started_at_ms,
            exited,
            exit_code,
        }
    }
}

impl Drop for BackgroundProc {
    fn drop(&mut self) {
        self.kill();
    }
}

pub fn spawn(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
) -> Result<Arc<BackgroundProc>, String> {
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err("empty command".into());
    }
    if let Some(ref dir) = cwd {
        if !resolve_path(dir, &workspace).is_dir() {
            return Err(format!("cwd is not a directory: {dir}"));
        }
    }

    let mut cmd = super::build_oneshot_command(&trimmed, &workspace, cwd.as_deref())?;
    if let (WorkspaceEnv::Local, Some(ref dir)) = (&workspace, &cwd) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let shared = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?);
    let kill_on_fail = || {
        let _ = shared.kill();
    };
    let stdout_pipe = shared.take_stdout().ok_or_else(|| {
        kill_on_fail();
        "no stdout pipe".to_string()
    })?;
    let stderr_pipe = shared.take_stderr().ok_or_else(|| {
        kill_on_fail();
        "no stderr pipe".to_string()
    })?;
    let child = shared;

    let started_at_ms = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let proc = Arc::new(BackgroundProc {
        command: trimmed,
        cwd,
        started_at_ms,
        child,
        buffer: Mutex::new(BoundedRingBuffer::new(RING_CAP)),
        exited: AtomicBool::new(false),
        exit_code: AtomicI32::new(0),
        exit_unknown: AtomicBool::new(false),
    });

    {
        let proc_ref = proc.clone();
        let mut pipe = stdout_pipe;
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => match mutex_lock(&proc_ref.buffer, "background stdout buffer") {
                        Ok(mut guard) => guard.push(&buf[..n]),
                        Err(error) => {
                            log::warn!("background stdout buffer unavailable: {error}");
                            break;
                        }
                    },
                    Err(_) => break,
                }
            }
        });
    }
    {
        let proc_ref = proc.clone();
        let mut pipe = stderr_pipe;
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => match mutex_lock(&proc_ref.buffer, "background stderr buffer") {
                        Ok(mut guard) => guard.push(&buf[..n]),
                        Err(error) => {
                            log::warn!("background stderr buffer unavailable: {error}");
                            break;
                        }
                    },
                    Err(_) => break,
                }
            }
        });
    }
    {
        let proc_ref = proc.clone();
        let child_for_wait = proc.child.clone();
        thread::spawn(move || {
            match child_for_wait.wait() {
                Ok(status) => match status.code() {
                    Some(code) => proc_ref.exit_code.store(code, Ordering::Release),
                    None => proc_ref.exit_unknown.store(true, Ordering::Release),
                },
                Err(_) => proc_ref.exit_unknown.store(true, Ordering::Release),
            }
            proc_ref.exited.store(true, Ordering::Release);
        });
    }

    Ok(proc)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 起一个瞬间退出的真实子进程，仅为填充 `child` 字段
    /// （`Arc<SharedChild>` 无法脱离真实进程构造）。
    fn exited_child() -> Arc<SharedChild> {
        #[cfg(windows)]
        let mut cmd = {
            let mut c = std::process::Command::new("cmd");
            c.args(["/C", "exit", "0"]);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = std::process::Command::new("sh");
            c.arg("-c").arg("exit 0");
            c
        };
        let child = SharedChild::spawn(&mut cmd).expect("spawn exited child");
        let _ = child.wait();
        Arc::new(child)
    }

    fn sample_proc(exited: bool) -> BackgroundProc {
        let mut buffer = BoundedRingBuffer::new(RING_CAP);
        buffer.push(b"hello world");
        BackgroundProc {
            command: "demo".into(),
            cwd: Some("/repo".into()),
            started_at_ms: 42,
            child: exited_child(),
            buffer: Mutex::new(buffer),
            exited: AtomicBool::new(exited),
            exit_code: AtomicI32::new(0),
            exit_unknown: AtomicBool::new(false),
        }
    }

    #[test]
    fn read_logs_full_read_reports_offsets_and_exit_state() {
        let proc = sample_proc(true);
        let resp = proc.read_logs(0);
        assert_eq!(resp.bytes, "hello world");
        assert_eq!(resp.next_offset, 11);
        assert_eq!(resp.dropped, 0);
        assert!(resp.exited);
        assert_eq!(resp.exit_code, Some(0));
    }

    #[test]
    fn read_logs_since_reads_incrementally() {
        let proc = sample_proc(true);
        let resp = proc.read_logs(5);
        assert_eq!(resp.bytes, " world");
        assert_eq!(resp.next_offset, 11);
    }

    #[test]
    fn running_process_hides_exit_code() {
        let proc = sample_proc(false);
        let resp = proc.read_logs(0);
        assert!(!resp.exited);
        assert_eq!(resp.exit_code, None);
        let info = proc.info(7);
        assert_eq!(info.handle, 7);
        assert_eq!(info.command, "demo");
        assert_eq!(info.cwd.as_deref(), Some("/repo"));
        assert_eq!(info.exit_code, None);
    }

    #[test]
    fn info_reports_exit_code_once_exited() {
        let proc = sample_proc(true);
        let info = proc.info(1);
        assert!(info.exited);
        assert_eq!(info.exit_code, Some(0));
    }
}
