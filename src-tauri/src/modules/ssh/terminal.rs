//! SSH 终端会话:一条 request_pty + shell/exec 的 SSH 通道,输出经
//! Tauri Channel 流回前端 —— 与本地 ConPTY 会话完全相同的 IPC 形状,
//! 因此前端 sessions.ts 的读写/resize/关闭逻辑零改动。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::Msg;
use russh::{ChannelMsg, ChannelWriteHalf};
use russh::Disconnect;
use tauri::ipc::Channel;

use super::client::{self, SshConnection};
use super::profiles::SshProfile;
use crate::modules::pty::TerminalSession;

/// 单次 exec 探针的默认超时。
const PROBE_TIMEOUT: Duration = Duration::from_secs(20);

pub struct SshTerminalSession {
    writer: Mutex<Option<ChannelWriteHalf<Msg>>>,
    /// 持有连接直到会话关闭:Handle 被 drop 等价于断开 SSH。
    connection: Mutex<Option<SshConnection>>,
    closed: AtomicBool,
}

impl TerminalSession for SshTerminalSession {
    fn write(&self, data: &str) -> Result<(), String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("ssh session is closed".into());
        }
        let writer = self
            .writer
            .lock()
            .map_err(|error| format!("ssh writer lock poisoned: {error}"))?;
        let Some(writer) = writer.as_ref() else {
            return Err("ssh session is closed".into());
        };
        tauri::async_runtime::block_on(async {
            writer
                .data_bytes(data.as_bytes().to_vec())
                .await
                .map_err(|error| format!("ssh write: {error}"))
        })
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let writer = self
            .writer
            .lock()
            .map_err(|error| format!("ssh writer lock poisoned: {error}"))?;
        let Some(writer) = writer.as_ref() else {
            return Ok(());
        };
        tauri::async_runtime::block_on(async {
            writer
                .window_change(cols as u32, rows as u32, 0, 0)
                .await
                .map_err(|error| format!("ssh resize: {error}"))
        })
    }

    fn kill(&self) -> Result<(), String> {
        self.shutdown();
        Ok(())
    }
}

impl SshTerminalSession {
    /// 关闭通道并断开 SSH 连接。先 drop writer(通道关闭),再显式
    /// disconnect,保证服务端 shell 收到 SIGHUP。
    fn shutdown(&self) {
        self.closed.store(true, Ordering::Release);
        if let Ok(mut writer) = self.writer.lock() {
            if let Some(writer) = writer.take() {
                tauri::async_runtime::block_on(async {
                    let _ = writer.close().await;
                });
            }
        }
        if let Ok(mut connection) = self.connection.lock() {
            if let Some(connection) = connection.take() {
                tauri::async_runtime::block_on(async {
                    let _ = connection
                        .handle
                        .disconnect(Disconnect::ByApplication, "", "")
                        .await;
                });
            }
        }
    }
}

impl Drop for SshTerminalSession {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// 单引号 shell 引用,防远端 cwd 注入。
pub fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[allow(clippy::too_many_arguments)]
pub async fn open(
    profile: SshProfile,
    secret: Option<&str>,
    known_hosts_path: std::path::PathBuf,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<String>,
    on_exit: Channel<i32>,
) -> Result<Arc<SshTerminalSession>, String> {
    let connection = client::connect(&profile, secret, known_hosts_path).await?;
    let channel = connection
        .handle
        .channel_open_session()
        .await
        .map_err(|error| format!("open ssh channel: {error}"))?;
    channel
        .request_pty(true, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
        .await
        .map_err(|error| format!("request pty: {error}"))?;
    match cwd.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(cwd) => {
            // request_shell 无法指定启动目录;用 exec 包一层 cd。失败退回
            // 登录 shell 语义:`cd 失败时 exec $SHELL -l` 仍在(home)。
            let command = format!(
                "cd {} 2>/dev/null; exec $SHELL -l",
                shell_single_quote(cwd)
            );
            channel
                .exec(true, command)
                .await
                .map_err(|error| format!("start ssh shell at {cwd}: {error}"))?;
        }
        None => {
            channel
                .request_shell(true)
                .await
                .map_err(|error| format!("request shell: {error}"))?;
        }
    }

    let (mut reader, writer) = channel.split();
    let session = Arc::new(SshTerminalSession {
        writer: Mutex::new(Some(writer)),
        connection: Mutex::new(Some(connection)),
        closed: AtomicBool::new(false),
    });

    // 输出泵:SSH 通道 → 前端 Channel,退出码语义与本地 PTY 对齐。
    let pump_session = Arc::clone(&session);
    tauri::async_runtime::spawn(async move {
        loop {
            match reader.wait().await {
                Some(ChannelMsg::Data { ref data }) => {
                    if on_data.send(String::from_utf8_lossy(data).into_owned()).is_err() {
                        break;
                    }
                }
                Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                    // stderr 并入主流:ConPTY 本来就不区分,行为对齐。
                    if on_data.send(String::from_utf8_lossy(data).into_owned()).is_err() {
                        break;
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    let _ = on_exit.send(exit_status as i32);
                    break;
                }
                Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            }
        }
        pump_session.shutdown();
    });

    Ok(session)
}

/// 连接探针:解析远端 HOME(工作区根默认值)与登录 shell。
pub async fn probe(
    profile: SshProfile,
    secret: Option<&str>,
    known_hosts_path: std::path::PathBuf,
) -> Result<SshProbeResult, String> {
    let mut connection = client::connect(&profile, secret, known_hosts_path).await?;
    let home = probe_command(&mut connection.handle, "printf %s \"$HOME\"").await?;
    if home.is_empty() {
        return Err("could not resolve remote home directory".into());
    }
    let shell = probe_command(
        &mut connection.handle,
        "command -v getent >/dev/null 2>&1 && getent passwd \"$(id -u)\" | cut -d: -f7 || printf %s \"$SHELL\"",
    )
    .await
    .unwrap_or_default();
    Ok(SshProbeResult {
        home,
        shell: shell.trim().to_string(),
    })
}

async fn probe_command(
    handle: &mut russh::client::Handle<super::client::ClientHandler>,
    command: &str,
) -> Result<String, String> {
    let output = client::exec_simple(handle, command, PROBE_TIMEOUT).await?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProbeResult {
    pub home: String,
    pub shell: String,
}

#[cfg(test)]
mod tests {
    use super::shell_single_quote;

    #[test]
    fn quotes_simple_path() {
        assert_eq!(shell_single_quote("/home/dev"), "'/home/dev'");
    }

    #[test]
    fn quotes_embedded_single_quotes() {
        assert_eq!(shell_single_quote("my'dir"), r#"'my'\''dir'"#);
    }

    #[test]
    fn quoting_neutralizes_command_injection() {
        let hostile = "/tmp/x'; rm -rf /; echo '";
        let quoted = shell_single_quote(hostile);
        // 每个内嵌单引号都被转义为 '\'';shell 不会再把注入段当语法解析。
        assert_eq!(quoted, "'/tmp/x'\\''; rm -rf /; echo '\\'''");
    }
}
