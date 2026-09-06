use std::io::Read;
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use shared_child::SharedChild;

#[cfg(windows)]
pub(crate) fn suppress_command_window(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn suppress_command_window(_command: &mut std::process::Command) {}

/// 限流排水:把 `reader` 读到 EOF,最多保留 `max_output_bytes` 字节,
/// 超出部分继续读但丢弃,并置 `truncated`。`buf_size` 是单次 read 的
/// 缓冲区大小;`prealloc` 为输出向量预分配的字节数(调用方按预期
/// 吞吐量传入,0 表示不预分配)。git 与 shell 的一次性命令执行共用
/// 该实现,保证两侧的输出上限与截断语义一致。
pub(crate) fn drain_limited<R: Read>(
    reader: &mut R,
    max_output_bytes: usize,
    buf_size: usize,
    prealloc: usize,
) -> (Vec<u8>, bool) {
    let mut out: Vec<u8> = Vec::with_capacity(prealloc.min(max_output_bytes));
    let mut buf = vec![0u8; buf_size];
    let mut truncated = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() >= max_output_bytes {
                    truncated = true;
                    continue;
                }
                let take = (max_output_bytes - out.len()).min(n);
                out.extend_from_slice(&buf[..take]);
                if take < n {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    (out, truncated)
}

/// `wait_with_timeout` 的失败形态:`Io` 是子进程 wait 本身报错;
/// `Disconnected` 是等待线程消失(panic 等)。两种情况的呈现方式
/// 因调用域而异(git 用 `GitError::Io` / `GitError::Spawn`,shell
/// 直接返回字符串),由调用方各自映射以保持原有错误文案。
#[derive(Debug)]
pub(crate) enum WaitFailure {
    Io(std::io::Error),
    Disconnected,
}
/// 带超时的子进程等待:在独立线程里阻塞 `child.wait()`,主线程
/// `recv_timeout`;超时则 kill 并回收,返回 `(exit_code, timed_out)`。
/// git 与 shell 的一次性命令执行共用该实现,保证「超时必 kill、
/// kill 后必回收」的语义只有一份。
pub(crate) fn wait_with_timeout(
    child: &Arc<SharedChild>,
    timeout: Duration,
) -> Result<(Option<i32>, bool), WaitFailure> {
    let (tx, rx) = mpsc::channel();
    let waiter = Arc::clone(child);
    thread::spawn(move || {
        let _ = tx.send(waiter.wait());
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(status)) => Ok((status.code(), false)),
        Ok(Err(e)) => Err(WaitFailure::Io(e)),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = child.kill();
            let _ = child.wait();
            Ok((None, true))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(WaitFailure::Disconnected),
    }
}

#[cfg(test)]
mod tests {
    use super::{drain_limited, suppress_command_window, wait_with_timeout};
    use shared_child::SharedChild;
    use std::io::Cursor;
    use std::process::{Command, Stdio};
    use std::sync::Arc;
    use std::time::Duration;

    #[test]
    fn drain_limited_truncates_beyond_cap() {
        let data = vec![7u8; 100];
        let mut cursor = Cursor::new(data);
        let (out, truncated) = drain_limited(&mut cursor, 40, 16, 0);
        assert_eq!(out.len(), 40);
        assert!(truncated);
        assert!(out.iter().all(|&b| b == 7));
    }

    #[test]
    fn drain_limited_returns_all_when_under_cap() {
        let data: Vec<u8> = (0..=64u8).collect();
        let mut cursor = Cursor::new(data.clone());
        let (out, truncated) = drain_limited(&mut cursor, 1024, 16, 128);
        assert_eq!(out, data);
        assert!(!truncated);
    }

    #[test]
    fn drain_limited_zero_cap_keeps_nothing_but_reports_truncation() {
        let mut cursor = Cursor::new(vec![1u8; 32]);
        let (out, truncated) = drain_limited(&mut cursor, 0, 8, 0);
        assert!(out.is_empty());
        assert!(truncated);
    }

    /// 平台无关的长驻进程:Windows 用 `ping` 自带的按秒阻塞模拟,
    /// unix 直接用 `sleep`。
    fn long_running_command() -> Command {
        #[cfg(windows)]
        {
            let mut cmd = Command::new("ping");
            cmd.args(["-n", "30", "127.0.0.1"]);
            cmd
        }
        #[cfg(not(windows))]
        {
            let mut cmd = Command::new("sleep");
            cmd.arg("30");
            cmd
        }
    }

    #[test]
    fn wait_with_timeout_kills_child_on_deadline() {
        let mut cmd = long_running_command();
        suppress_command_window(&mut cmd);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = Arc::new(SharedChild::spawn(&mut cmd).expect("spawn long-running child"));

        let started = std::time::Instant::now();
        let (exit_code, timed_out) =
            wait_with_timeout(&child, Duration::from_millis(300)).expect("wait result");
        let elapsed = started.elapsed();

        assert!(timed_out, "child must be reported as timed out");
        assert_eq!(exit_code, None, "killed child has no exit code");
        // 远小于 30s 的进程自然寿命,说明确实在截止时间被杀掉。
        assert!(elapsed < Duration::from_secs(10), "kill took too long: {elapsed:?}");
    }
}
