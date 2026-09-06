//! russh 连接层:建立连接、TOFU 主机密钥校验、密码/私钥认证、exec 辅助。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKeyBase64};

use super::known_hosts::{self, HostKeyVerdict};
use super::profiles::{SshAuthMethod, SshProfile};

/// 连接保活:每 15s 一个 keepalive,连续 3 次无响应判死。
/// 网络中断的显式化对终端体验至关重要 —— 宁可报错也不留"假活"会话。
fn client_config() -> Arc<client::Config> {
    Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(15)),
        keepalive_max: 3,
        inactivity_timeout: None,
        ..Default::default()
    })
}

pub(crate) struct ClientHandler {
    known_hosts_path: PathBuf,
    host_key_id: String,
    /// check_server_key 拒绝时置位并记录已存指纹 —— connect 侧据此把
    /// russh 的通用断开错误翻译成带稳定前缀的 "host key changed"。
    host_key_rejected: Arc<Mutex<Option<String>>>,
}

impl ClientHandler {
    /// 返回 Ok(false) 会被 russh 直接断开;错误信息在这里组织。
    fn host_key_error(stored_public_key: &str) -> String {
        format!(
            "{HOST_KEY_CHANGED_PREFIX}host key changed since last connection \
             (stored: {}). If the server was rebuilt, remove the host entry \
             and reconnect",
            &stored_public_key[..stored_public_key.len().min(24)]
        )
    }
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let (key_type, key_base64) = match server_public_key {
            russh::keys::PublicKeyOrCertificate::PublicKey { key, .. } => {
                (key.algorithm().to_string(), key.public_key_base64())
            }
            russh::keys::PublicKeyOrCertificate::Certificate(cert) => {
                // OpenSSH certificate:Phase 1 以其编码摘要当作指纹记录。
                ("certificate".to_string(), format!("{cert:?}").chars().take(64).collect())
            }
        };
        match known_hosts::verify(&self.known_hosts_path, &self.host_key_id, &key_type, &key_base64)
        {
            HostKeyVerdict::Match => Ok(true),
            HostKeyVerdict::New => {
                known_hosts::record(&self.known_hosts_path, &self.host_key_id, &key_type, &key_base64)
                    .map_err(|error| {
                        log::error!("failed to persist known host {}: {error}", self.host_key_id);
                        russh::Error::UnknownKey
                    })?;
                log::info!("recorded new host key for {}", self.host_key_id);
                Ok(true)
            }
            HostKeyVerdict::Changed { stored_public_key } => {
                log::warn!(
                    "host key mismatch for {} (was {}...)",
                    self.host_key_id,
                    &stored_public_key[..stored_public_key.len().min(24)]
                );
                if let Ok(mut rejected) = self.host_key_rejected.lock() {
                    *rejected = Some(Self::host_key_error(&stored_public_key));
                }
                Err(russh::Error::UnknownKey)
            }
        }
    }
}

pub(crate) struct SshConnection {
    pub handle: Handle<ClientHandler>,
    /// 连接所属档案 id;探针成功后据此把连接存入连接池。
    pub profile_id: String,
}

/// 主机密钥不匹配的稳定错误前缀,前端可据此引导用户处理。
pub const HOST_KEY_CHANGED_PREFIX: &str = "SshHostKeyChanged: ";

pub(crate) async fn connect(
    profile: &SshProfile,
    secret: Option<&str>,
    known_hosts_path: PathBuf,
) -> Result<SshConnection, String> {
    let host_key_rejected: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        known_hosts_path,
        host_key_id: profile.host_key(),
        host_key_rejected: Arc::clone(&host_key_rejected),
    };
    let mut handle = match client::connect(client_config(), (profile.host.as_str(), profile.port), handler)
        .await
    {
        Ok(handle) => handle,
        Err(error) => {
            // check_server_key 拒绝时 russh 以 UnknownMessage 断开;若共享
            // 标志被置位,翻译成带稳定前缀的 host key changed 错误。
            if let Ok(rejected) = host_key_rejected.lock() {
                if let Some(message) = rejected.as_ref() {
                    return Err(message.clone());
                }
            }
            return Err(format!("connect to {}: {error}", profile.host_key()));
        }
    };

    let auth_result = match &profile.auth_method {
        SshAuthMethod::Password => {
            let password = secret
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "password authentication requires a password".to_string())?;
            handle
                .authenticate_password(&profile.username, password)
                .await
        }
        SshAuthMethod::Key { key_path } => {
            // secret 在 key 认证语境下是私钥 passphrase(可为空)。
            let passphrase = secret.filter(|value| !value.is_empty());
            let key = load_secret_key(key_path, passphrase)
                .map_err(|error| format!("load key {key_path}: {error}"))?;
            handle
                .authenticate_publickey(
                    &profile.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), None),
                )
                .await
        }
    }
    .map_err(|error| format!("ssh auth for {}@{}: {error}", profile.username, profile.host))?;

    if !auth_result.success() {
        return Err(format!(
            "authentication failed for {}@{}",
            profile.username, profile.host
        ));
    }

    Ok(SshConnection {
        handle,
        profile_id: profile.id.clone(),
    })
}

pub struct ExecOutput {
    pub exit_code: Option<u32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// 在远端执行一条命令并收齐输出。用于探针(home 目录、agent 安装等)。
/// 错误按类别标记(通道失败/超时),供连接池参与驱逐决策;文案不变。
pub(crate) async fn exec_simple(
    handle: &mut Handle<ClientHandler>,
    command: &str,
    timeout: Duration,
) -> Result<ExecOutput, super::remote::RemoteError> {
    use russh::ChannelMsg;
    use super::remote::RemoteError;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| RemoteError::channel(format!("open exec channel: {error}")))?;
    channel
        .exec(true, command)
        .await
        .map_err(|error| RemoteError::channel(format!("exec {command}: {error}")))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_code = None;
    let deadline = tokio::time::Duration::from_secs_f64(timeout.as_secs_f64());
    loop {
        match tokio::time::timeout(deadline, channel.wait()).await {
            Ok(Some(ChannelMsg::Data { ref data })) => stdout.extend_from_slice(data),
            Ok(Some(ChannelMsg::ExtendedData { ref data, .. })) => stderr.extend_from_slice(data),
            Ok(Some(ChannelMsg::ExitStatus { exit_status })) => exit_code = Some(exit_status),
            Ok(Some(ChannelMsg::Close)) | Ok(None) => break,
            Ok(Some(_)) => {}
            Err(_) => {
                return Err(RemoteError::timeout(format!(
                    "exec {command}: timed out after {timeout:?}"
                )));
            }
        }
    }
    Ok(ExecOutput {
        exit_code,
        stdout,
        stderr,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_key_error_keeps_tofu_prefix() {
        let msg = ClientHandler::host_key_error("AAAA");
        assert!(msg.starts_with(HOST_KEY_CHANGED_PREFIX));
        assert!(msg.contains("host key changed since last connection"));
    }

    #[test]
    fn host_key_error_truncates_stored_key() {
        let long = "a".repeat(64);
        let msg = ClientHandler::host_key_error(&long);
        // 只回显前 24 个字符，避免错误信息过长。
        assert!(msg.contains(&"a".repeat(24)));
        assert!(!msg.contains(&"a".repeat(25)));
    }
}
