//! russh 连接层:建立连接、TOFU 主机密钥校验、密码/私钥认证、exec 辅助。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKeyBase64};

use super::bounded::BoundedBuffer;
use super::known_hosts::{self, HostKeyVerdict};
use super::profiles::{SshAuthMethod, SshProfile};

/// 连接保活:每 15s 一个 keepalive,连续 3 次无响应判死。
/// 网络中断的显式化对终端体验至关重要 —— 宁可报错也不留"假活"会话。
fn client_config() -> Arc<client::Config> {
    Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(15)),
        keepalive_max: 3,
        inactivity_timeout: None,
        preferred: preferred_algorithms(),
        ..Default::default()
    })
}

/// 显式拒绝 SHA-1 家族的 RSA 主机密钥算法。
///
/// 依赖树里的 `rsa 0.10.0-rc.18` 命中 RUSTSEC-2023-0071（Marvin Attack：
/// 通过计时侧信道恢复密钥），且**上游没有修复版本**。能被该问题影响的只有
/// `ssh-rsa`（SHA-1）这一族：`rsa-sha2-256` / `rsa-sha2-512` 走的是不同的
/// 签名构造，不在受影响范围内。
///
/// russh 的 `Preferred::DEFAULT` 里仍然包含 `Algorithm::Rsa { hash: None }`
/// （即 `ssh-rsa`），所以这里逐条过滤掉它。这是「关掉有漏洞的那一个」的
/// 常规做法，而不是等一个不会到来的上游修复。
fn preferred_algorithms() -> russh::Preferred {
    let default = russh::Preferred::DEFAULT;
    // `Rsa { hash: None }` == ssh-rsa (SHA-1)：Marvin Attack 的受影响面。
    let key: Vec<russh::keys::Algorithm> = default
        .key
        .iter()
        .filter(|algo| !matches!(algo, russh::keys::Algorithm::Rsa { hash: None }))
        .cloned()
        .collect();
    russh::Preferred {
        kex: default.kex,
        key: key.into(),
        host_key_certificates: default.host_key_certificates,
        cipher: default.cipher,
        mac: default.mac,
        compression: default.compression,
    }
}

#[cfg(test)]
mod algorithm_tests {
    use super::*;
    use russh::keys::{Algorithm, HashAlg};

    #[test]
    fn drops_sha1_rsa_host_key_algorithms() {
        // Marvin Attack (RUSTSEC-2023-0071) 只影响 ssh-rsa；rsa-sha2-* 必须保留。
        let key = preferred_algorithms().key;
        assert!(
            !key.contains(&Algorithm::Rsa { hash: None }),
            "ssh-rsa (SHA-1) must not be advertised"
        );
        assert!(key.contains(&Algorithm::Rsa {
            hash: Some(HashAlg::Sha256)
        }));
        assert!(key.contains(&Algorithm::Rsa {
            hash: Some(HashAlg::Sha512)
        }));
    }

    #[test]
    fn keeps_the_non_rsa_algorithms() {
        let key = preferred_algorithms().key;
        assert!(key.contains(&Algorithm::Ed25519));
        assert!(key
            .iter()
            .any(|algo| matches!(algo, Algorithm::Ecdsa { .. })));
    }
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
                (
                    "certificate".to_string(),
                    format!("{cert:?}").chars().take(64).collect(),
                )
            }
        };
        match known_hosts::verify(
            &self.known_hosts_path,
            &self.host_key_id,
            &key_type,
            &key_base64,
        ) {
            HostKeyVerdict::Match => Ok(true),
            HostKeyVerdict::New => {
                known_hosts::record(
                    &self.known_hosts_path,
                    &self.host_key_id,
                    &key_type,
                    &key_base64,
                )
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
    let mut handle = match client::connect(
        client_config(),
        (profile.host.as_str(), profile.port),
        handler,
    )
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
    .map_err(|error| {
        format!(
            "ssh auth for {}@{}: {error}",
            profile.username, profile.host
        )
    })?;

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
    /// 输出是否被 MAX_CHANNEL_OUTPUT_BYTES 截断。调用方据此提示用户，
    /// 而不是把「只拿到一半的结果」当成完整结果继续用。
    pub truncated: bool,
}

/// 在远端执行一条命令并收齐输出。用于探针(home 目录、agent 安装等)。
/// 错误按类别标记(通道失败/超时),供连接池参与驱逐决策;文案不变。
pub(crate) async fn exec_simple(
    handle: &mut Handle<ClientHandler>,
    command: &str,
    timeout: Duration,
) -> Result<ExecOutput, super::remote::RemoteError> {
    use super::remote::RemoteError;
    use russh::ChannelMsg;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| RemoteError::channel(format!("open exec channel: {error}")))?;
    channel
        .exec(true, command)
        .await
        .map_err(|error| RemoteError::channel(format!("exec {command}: {error}")))?;

    // 远端输出是不可信输入，必须有上限：裸 extend 让一个异常远端可以
    // 用几百 MB 数据把主进程 OOM 掉。
    let mut stdout = BoundedBuffer::with_prealloc(16 * 1024);
    let mut stderr = BoundedBuffer::with_prealloc(4 * 1024);
    let mut exit_code = None;
    let deadline = tokio::time::Duration::from_secs_f64(timeout.as_secs_f64());
    loop {
        match tokio::time::timeout(deadline, channel.wait()).await {
            Ok(Some(ChannelMsg::Data { ref data })) => stdout.push(data),
            Ok(Some(ChannelMsg::ExtendedData { ref data, .. })) => stderr.push(data),
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
    let truncated = stdout.truncated() || stderr.truncated();
    let stdout = stdout.into_bytes();
    let stderr = stderr.into_bytes();
    Ok(ExecOutput {
        exit_code,
        stdout,
        stderr,
        truncated,
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
