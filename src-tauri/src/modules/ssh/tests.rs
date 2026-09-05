//! SSH 模块的 loopback 集成测试:用 russh server 起一个 127.0.0.1 的
//! 真 SSH 服务端,覆盖「连接 → TOFU 记录 → 密码认证 → exec → PTY 终端
//! 读写」全链路。这是 Phase 1 传输层的最终验证,不 mock 任何一层。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::server::{Auth, Handler as ServerHandler, Session};
use russh::ChannelId;
use serde_json::json;

use super::client;
use crate::modules::pty::TerminalSession;
use super::profiles::SshProfile;
use super::terminal;

const USER: &str = "dev";
const PASSWORD: &str = "secret-password";

fn temp_known_hosts(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "nexterm-ssh-loopback-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir.join("ssh-known-hosts.json")
}

fn profile(port: u16) -> SshProfile {
    SshProfile {
        id: "test-profile".into(),
        name: "loopback".into(),
        host: "127.0.0.1".into(),
        port,
        username: USER.into(),
        auth_method: super::profiles::SshAuthMethod::Password,
        created_at: 0,
    }
}

/// 回环 SSH 服务端:密码认证;exec 回显 `exec:<cmd>`,shell 回显输入。
struct LoopbackServer;

impl ServerHandler for LoopbackServer {
    type Error = russh::Error;

    async fn channel_open_session(
        &mut self,
        _channel: russh::Channel<russh::server::Msg>,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == USER && password == PASSWORD {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _term: &str,
        _col_width: u32,
        _row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(russh::Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        session.data(channel, b"shell-ready".to_vec())?;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        session.data(channel, format!("exec:{}", String::from_utf8_lossy(data)))?;
        session.eof(channel)?;
        session.close(channel)?;
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session
            .data(channel, format!("echo:{}", String::from_utf8_lossy(data)))?;
        Ok(())
    }
}

/// 测试专用静态 ed25519 主机密钥(仅用于本 loopback 测试,无保密价值)。
const TEST_HOST_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDmiWj2x7SrELcJN/2CMeHso9WG90Bz5nLjnrpbYakA4gAAAJgzyR7+M8ke
/gAAAAtzc2gtZWQyNTUxOQAAACDmiWj2x7SrELcJN/2CMeHso9WG90Bz5nLjnrpbYakA4g
AAAEBzganAS+fJHoR71yj1+J21cQMqQLAToSqKHIAdCyIgTeaJaPbHtKsQtwk3/YIx4eyj
1Yb3QHPmcuOeulthqQDiAAAAEjEwMzIyQHhpbmdnYW8tbWluaQECAw==
-----END OPENSSH PRIVATE KEY-----";

async fn spawn_server() -> (u16, PathBuf) {
    let mut config = russh::server::Config::default();
    config.keys.push(
        russh::keys::decode_secret_key(TEST_HOST_KEY, None).expect("parse test host key"),
    );
    config.auth_rejection_time = Duration::from_millis(50);
    let config = Arc::new(config);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        loop {
            let (socket, _) = match listener.accept().await {
                Ok(pair) => pair,
                Err(_) => break,
            };
            let config = Arc::clone(&config);
            tokio::spawn(async move {
                let _ = russh::server::run_stream(config, socket, LoopbackServer).await;
            });
        }
    });
    (port, temp_known_hosts("run"))
}

#[tokio::test(flavor = "multi_thread")]
async fn connect_exec_roundtrip_and_tofu_record() {
    let (port, known_hosts) = spawn_server().await;

    // 首连:TOFU 记录主机密钥并放行;exec 命令拿到服务端回显。
    let mut connection = client::connect(&profile(port), Some(PASSWORD), known_hosts.clone())
        .await
        .expect("connect");
    let output = client::exec_simple(&mut connection.handle, "echo hi", Duration::from_secs(10))
        .await
        .expect("exec");
    assert_eq!(output.stdout, b"exec:echo hi");
    drop(connection);

    // TOFU 已记录,二连直接放行。
    let connection = client::connect(&profile(port), Some(PASSWORD), known_hosts.clone())
        .await
        .expect("reconnect");
    drop(connection);

    let entries = super::known_hosts::list(&known_hosts);
    assert_eq!(entries.len(), 1, "exactly one host entry recorded");
    assert_eq!(entries[0].host, format!("127.0.0.1:{port}"));
    let _ = std::fs::remove_dir_all(known_hosts.parent().expect("parent"));
}

#[tokio::test(flavor = "multi_thread")]
async fn wrong_password_fails_cleanly() {
    let (port, known_hosts) = spawn_server().await;
    let outcome = client::connect(&profile(port), Some("wrong"), known_hosts).await;
    let error = match outcome {
        Ok(_) => panic!("wrong password must not authenticate"),
        Err(error) => error,
    };
    assert!(error.contains("authentication failed"), "got: {error}");
}

#[tokio::test(flavor = "multi_thread")]
async fn terminal_open_write_and_echo() {
    let (port, known_hosts) = spawn_server().await;

    let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let received_for_channel = Arc::clone(&received);
    let on_data = tauri::ipc::Channel::new(move |message| {
        use tauri::ipc::InvokeResponseBody;
        let text = match message {
            InvokeResponseBody::Json(text) => text,
            InvokeResponseBody::Raw(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        };
        received_for_channel.lock().unwrap().push(text);
        Ok(())
    });
    let (on_exit_tx, _on_exit_rx) = std::sync::mpsc::channel::<i32>();
    let on_exit = tauri::ipc::Channel::<i32>::new(move |_| {
        let _ = on_exit_tx.clone().send(0);
        Ok(())
    });

    let session = terminal::open(
        profile(port),
        Some(PASSWORD),
        known_hosts.clone(),
        None,
        80,
        24,
        on_data,
        on_exit,
    )
    .await
    .expect("terminal open");

    // tauri::async_runtime::block_on 不能发生在任何 tokio worker 线程里,
    // 写与杀都挪到普通线程执行。
    let writer_session = Arc::clone(&session);
    std::thread::spawn(move || writer_session.write("ping").expect("ssh write"))
        .join()
        .expect("writer thread");

    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        let got = received.lock().unwrap().join("");
        if got.contains("shell-ready") && got.contains("echo:ping") {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for echo, got: {got}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }

    let killer_session = Arc::clone(&session);
    std::thread::spawn(move || killer_session.kill().expect("kill"))
        .join()
        .expect("killer thread");
}

#[test]
fn probe_result_serializes_camel_case() {
    let result = terminal::SshProbeResult {
        home: "/home/dev".into(),
        shell: "/bin/zsh".into(),
    };
    let value = serde_json::to_value(&result).expect("serialize");
    assert_eq!(value["home"], "/home/dev");
    assert_eq!(value["shell"], "/bin/zsh");
}

#[test]
fn profile_json_matches_frontend_shape() {
    let profile = profile(2222);
    let value = serde_json::to_value(&profile).expect("serialize");
    assert_eq!(value["id"], "test-profile");
    assert_eq!(value["host"], "127.0.0.1");
    assert_eq!(value["port"], 2222);
    assert_eq!(value["username"], USER);
    assert_eq!(value["authMethod"]["kind"], "password");
    // 反序列化(命令参数方向)同样按 camelCase。
    let parsed: SshProfile = serde_json::from_value(json!({
        "id": "p1",
        "name": "n",
        "host": "h",
        "port": 22,
        "username": "u",
        "authMethod": { "kind": "key", "keyPath": "/k" },
        "createdAt": 5
    }))
    .expect("parse");
    assert_eq!(parsed.auth_method, super::profiles::SshAuthMethod::Key { key_path: "/k".into() });
    assert_eq!(parsed.created_at, 5);
}
