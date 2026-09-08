use std::io::Read;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtySize};
use tauri::ipc::Channel;

use super::shell_init;
use crate::modules::workspace::WorkspaceEnv;

const READ_BUF: usize = 16 * 1024;
// PTY 端不做 batching —— 每读完一块直接 channel.send。前端
// sessions.ts 的 rAF 批处理把同一帧内的 onData 合并成一次 term.write,
// 避免每块触发一次 reflow;PTY 端做时间窗累积会带来"首次 read 拿到
// 第一字节后 PTY 假死,pending 永远不 flush,前端 watchdog 误判"
// 的回归(实际已触发),撤掉是唯一安全选择。

pub struct Session {
    #[cfg(windows)]
    _job: Option<super::job::PtyJob>,
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    done: Arc<AtomicBool>,
}

impl super::TerminalSession for Session {
    fn write(&self, data: &str) -> Result<(), String> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|error| format!("pty writer poisoned: {error}"))?;
        writer
            .write_all(data.as_bytes())
            .map_err(|error| error.to_string())
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self
            .master
            .lock()
            .map_err(|error| format!("pty master poisoned: {error}"))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())
    }

    fn kill(&self) -> Result<(), String> {
        let mut killer = self
            .killer
            .lock()
            .map_err(|error| format!("pty killer poisoned: {error}"))?;
        killer.kill().map_err(|error| error.to_string())
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.done.store(true, Ordering::Release);
        if let Ok(mut k) = self.killer.lock() {
            let _ = k.kill();
        }
    }
}

pub fn spawn(
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    shell_id: Option<String>,
    workspace: WorkspaceEnv,
    on_data: Channel<String>,
    on_exit: Channel<i32>,
) -> Result<(Arc<Session>, PtySize), String> {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    let cmd = shell_init::build_command(cwd, shell_id.as_deref(), workspace)?;
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

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

    let done = Arc::new(AtomicBool::new(false));
    let session = Arc::new(Session {
        #[cfg(windows)]
        _job: job,
        killer: Mutex::new(killer),
        writer: writer.clone(),
        master: Mutex::new(pair.master),
        done: done.clone(),
    });

    let on_data_reader = on_data.clone();
    let done_reader = done.clone();
    // reader → waiter 同步信号:reader 退出前 flush 完,send(()) 让
    // waiter 知道可以安全发 on_exit。如果不这样做,waiter 只能 sleep
    // 1ms 猜,reader 卡在 read() 时 done 标志变更不能被立即看到,
    // on_exit 可能先到前端 → 残余输出被前端误判为 PTY 死后数据。
    let (ready_tx, ready_rx) = mpsc::channel::<()>();
    let ready_tx_for_reader = ready_tx.clone();
    thread::Builder::new()
        .name("nexterm-pty-reader".into())
        .spawn(move || {
            let mut buf = [0u8; READ_BUF];
            // 直接每块 send,不做时间窗累积:
            // - 避免"首次 read 拿到第一字节后 PTY 假死,pending 永远
            //   缓存,前端 watchdog 误判"的回归
            // - 实际 batching 收益小,16KB 块本身在 channel IPC 上
            //   已经被 Tauri 内部序列化合并一次
            // - 前端 sessions.ts 的 rAF 批处理负责合并同一帧内的
            //   多个 onData,避免每块触发一次 xterm reflow
            loop {
                if done_reader.load(Ordering::Acquire) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // PTY EOF:退出循环,残余字节不存在(已 send 每块)
                        break;
                    }
                    Ok(n) => {
                        // 直接 send,失败时退出循环(channel 已关闭,
                        // 通常 webview dispose 或 pty_close 触发)
                        if on_data_reader
                            .send(String::from_utf8_lossy(&buf[..n]).into_owned())
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(e) => {
                        if e.kind() == std::io::ErrorKind::Interrupted {
                            // 信号打断(EINTR 等):重试
                            continue;
                        }
                        // 真错误或 WouldBlock:退出循环
                        // (portable_pty 是 blocking read,理论上不会
                        // 返回 WouldBlock;若发生按错误处理)
                        log::debug!("pty reader ended: {e}");
                        break;
                    }
                }
            }
            // 通知 waiter:reader 已退出,waiter 可以安全发 on_exit。
            // channel 关闭(我们的 sender drop)时 waiter 端的
            // recv_timeout 立即返回 Err,不会卡住 waiter。
            let _ = ready_tx_for_reader.send(());
        })
        .map_err(|e| format!("spawn pty reader thread: {e}"))?;

    thread::Builder::new()
        .name("nexterm-pty-waiter".into())
        .spawn(move || {
            let code = match child.wait() {
                Ok(status) => status.exit_code() as i32,
                Err(e) => {
                    log::warn!("pty child wait failed: {e}");
                    -1
                }
            };
            // 显式置 done,reader 下一轮 read 之前会看到并 break。
            // 关键:waiter 不能立即发 on_exit,因为 reader 可能还阻塞
            // 在 read() 内核调用上,master 关闭后 read 才会返回。waiter
            // 这边用 ready_rx 同步信号等 reader 真正退出后再发 on_exit,
            // 上限 200ms 防 reader 死锁。200ms 内 reader 必然完成当前
            // read() 返回(PTY 关闭后 read 立即返 Err 或 0),覆盖到
            // done → break → send ready。
            done.store(true, Ordering::Release);
            let _ = ready_rx.recv_timeout(Duration::from_millis(200));
            if let Err(e) = on_exit.send(code) {
                log::debug!("pty exit send failed (channel closed): {e}");
            }
        })
        .map_err(|e| format!("spawn pty waiter thread: {e}"))?;

    // on_data 的 reader 克隆已随读取线程持有;此处直接丢弃原始
    // Channel,与原先的空转清理线程等效(该线程只负责 drop)。
    drop(on_data);

    Ok((session, size))
}

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
