//! SSH 模块:连接档案、known_hosts TOFU、SSH 终端与远端执行(remote)。
//!
//! 设计契约:
//! - 机密(密码/passphrase)由前端每次连接时提供,内存中转,不落盘;
//!   keychain 接入属后续优化。
//! - `WorkspaceEnv::Ssh` 支持终端与 fs/git 操作(经 nexterm-agent);
//!   watcher 与 shell 后台进程暂不支持,由 `workspace::reject_ssh_unsupported`
//!   统一拒绝并给出清晰错误。

pub mod client;
pub mod known_hosts;
pub mod remote;
pub mod profiles;
#[cfg(test)]
mod tests;
pub mod terminal;

use tauri::{AppHandle, Manager};

use self::profiles::SshProfile;

pub(crate) fn known_hosts_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve app data dir: {error}"))?;
    Ok(dir.join("ssh-known-hosts.json"))
}

#[tauri::command]
pub fn ssh_profile_list(app: AppHandle) -> Result<Vec<SshProfile>, String> {
    profiles::list_profiles(&app)
}

#[tauri::command]
pub fn ssh_profile_save(app: AppHandle, profile: SshProfile) -> Result<SshProfile, String> {
    profiles::save_profile(&app, profile)
}

#[tauri::command]
pub fn ssh_profile_delete(app: AppHandle, id: String) -> Result<(), String> {
    profiles::delete_profile(&app, &id)
}

#[tauri::command]
pub fn ssh_known_hosts_list(app: AppHandle) -> Result<Vec<known_hosts::KnownHostEntry>, String> {
    Ok(known_hosts::list(&known_hosts_path(&app)?))
}

#[tauri::command]
pub fn ssh_known_hosts_remove(app: AppHandle, host: String) -> Result<bool, String> {
    known_hosts::remove(&known_hosts_path(&app)?, &host)
}

/// 连接探针:验证凭据可用并解析远端 home 与登录 shell。探针建立的连接
/// 直接入池复用,整个流程只做一次 SSH 握手(TOFU 校验语义不变)。
/// `secret` 是密码或私钥 passphrase(取决于档案的认证方式)。
#[tauri::command]
pub async fn ssh_connect_test(
    app: AppHandle,
    profile: SshProfile,
    secret: Option<String>,
) -> Result<terminal::SshProbeResult, String> {
    let path = known_hosts_path(&app)?;
    let (result, connection) = terminal::probe(profile, secret.as_deref(), path).await?;
    // 探针成功:已认证连接入池,供远端 fs/git 复用(免二次握手)。
    remote::store_connection(&connection.profile_id, connection.handle);
    Ok(result)
}
