//! SSH 模块(Phase 1):连接档案、known_hosts TOFU、SSH 终端。
//!
//! 设计契约:
//! - 机密(密码/passphrase)由前端每次连接时提供,内存中转,不落盘;
//!   keychain 接入属 Phase 3。
//! - `WorkspaceEnv::Ssh` 在 Phase 1 仅支持终端;fs/git/shell 侧由
//!   `workspace::reject_ssh_unsupported` 统一拒绝并给出清晰错误。

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

/// 连接探针:验证凭据可用并解析远端 home 与登录 shell。
/// `secret` 是密码或私钥 passphrase(取决于档案的认证方式)。
#[tauri::command]
pub async fn ssh_connect_test(
    app: AppHandle,
    profile: SshProfile,
    secret: Option<String>,
) -> Result<terminal::SshProbeResult, String> {
    let path = known_hosts_path(&app)?;
    let result = terminal::probe(profile.clone(), secret.as_deref(), path.clone()).await?;
    // 探针成功:认证连接入池,供 Phase 2 远端 fs/git 复用。
    let connection = client::connect(&profile, secret.as_deref(), path).await?;
    remote::global_pool().store(&profile.id, connection.handle);
    Ok(result)
}
