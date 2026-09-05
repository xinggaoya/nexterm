//! SSH 连接档案(profile)的存储与 CRUD。
//!
//! 存储为 `app_data_dir/ssh-profiles.json`,由 Rust 侧独占管理(前端经
//! 命令读写)。**机密(密码/私钥 passphrase)永不落盘** —— Phase 1 由前端
//! 连接时提供,Phase 3 计划接入 OS keychain。

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// 认证方式。密码在连接时提供;私钥档案只存路径。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SshAuthMethod {
    Password,
    Key {
        #[serde(rename = "keyPath")]
        key_path: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    pub auth_method: SshAuthMethod,
    #[serde(default)]
    pub created_at: u64,
}

fn default_port() -> u16 {
    22
}

impl SshProfile {
    /// `host:port` 键,known_hosts 与日志使用。
    pub fn host_key(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProfiles {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    profiles: Vec<SshProfile>,
}

fn file_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn profiles_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve app data dir: {error}"))?;
    Ok(dir.join("ssh-profiles.json"))
}

fn load_profiles(path: &PathBuf) -> Vec<SshProfile> {
    match std::fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<StoredProfiles>(&raw) {
            Ok(stored) => stored.profiles,
            Err(error) => {
                log::warn!("ssh profiles file corrupt, starting empty: {error}");
                Vec::new()
            }
        },
        Err(_) => Vec::new(),
    }
}

fn store_profiles(path: &PathBuf, profiles: &[SshProfile]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    let stored = StoredProfiles {
        version: 1,
        profiles: profiles.to_vec(),
    };
    let raw = serde_json::to_string_pretty(&stored).map_err(|error| error.to_string())?;
    // 临时文件 + rename 原子替换,与 shell 集成脚本同一套路。
    let tmp = path.with_extension("json.__nexterm_tmp__");
    std::fs::write(&tmp, raw).map_err(|error| format!("write {}: {error}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|error| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename to {}: {error}", path.display())
    })
}

pub fn list_profiles(app: &tauri::AppHandle) -> Result<Vec<SshProfile>, String> {
    let path = profiles_path(app)?;
    let _guard = file_lock().lock().map_err(|error| format!("ssh profiles lock poisoned: {error}"))?;
    Ok(load_profiles(&path))
}

/// 新增或按 id 覆盖;新档案自动生成 id 与 created_at。
pub fn save_profile(app: &tauri::AppHandle, mut profile: SshProfile) -> Result<SshProfile, String> {
    validate_profile(&profile)?;
    let path = profiles_path(app)?;
    let _guard = file_lock().lock().map_err(|error| format!("ssh profiles lock poisoned: {error}"))?;
    let mut profiles = load_profiles(&path);
    if profile.id.is_empty() {
        profile.id = generate_profile_id();
        profile.created_at = unix_now();
        profiles.push(profile.clone());
    } else {
        match profiles.iter_mut().find(|p| p.id == profile.id) {
            Some(existing) => {
                profile.created_at = existing.created_at;
                *existing = profile.clone();
            }
            None => {
                profile.created_at = unix_now();
                profiles.push(profile.clone());
            }
        }
    }
    store_profiles(&path, &profiles)?;
    Ok(profile)
}

pub fn delete_profile(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let path = profiles_path(app)?;
    let _guard = file_lock().lock().map_err(|error| format!("ssh profiles lock poisoned: {error}"))?;
    let mut profiles = load_profiles(&path);
    let before = profiles.len();
    profiles.retain(|profile| profile.id != id);
    if profiles.len() == before {
        return Err(format!("unknown ssh profile: {id}"));
    }
    store_profiles(&path, &profiles)
}

pub fn find_profile(app: &tauri::AppHandle, id: &str) -> Result<SshProfile, String> {
    let path = profiles_path(app)?;
    let _guard = file_lock().lock().map_err(|error| format!("ssh profiles lock poisoned: {error}"))?;
    load_profiles(&path)
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| format!("unknown ssh profile: {id}"))
}

fn validate_profile(profile: &SshProfile) -> Result<(), String> {
    if profile.name.trim().is_empty() {
        return Err("ssh profile name must not be empty".into());
    }
    if profile.host.trim().is_empty() {
        return Err("ssh profile host must not be empty".into());
    }
    if profile.username.trim().is_empty() {
        return Err("ssh profile username must not be empty".into());
    }
    if profile.port == 0 {
        return Err("ssh profile port must be positive".into());
    }
    if let SshAuthMethod::Key { key_path } = &profile.auth_method {
        if key_path.trim().is_empty() {
            return Err("ssh profile key path must not be empty".into());
        }
    }
    Ok(())
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn generate_profile_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("ssh-{nanos:032x}-{}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(name: &str, host: &str) -> SshProfile {
        SshProfile {
            id: String::new(),
            name: name.into(),
            host: host.into(),
            port: 22,
            username: "dev".into(),
            auth_method: SshAuthMethod::Password,
            created_at: 0,
        }
    }

    #[test]
    fn host_key_formats_with_port() {
        let mut profile = sample("prod", "10.0.0.1");
        profile.port = 2222;
        assert_eq!(profile.host_key(), "10.0.0.1:2222");
    }

    #[test]
    fn validation_rejects_empty_fields() {
        assert!(validate_profile(&sample("n", "h")).is_ok());
        assert!(validate_profile(&sample("", "h")).is_err());
        assert!(validate_profile(&sample("n", "  ")).is_err());
        let mut no_user = sample("n", "h");
        no_user.username = String::new();
        assert!(validate_profile(&no_user).is_err());
        let mut zero_port = sample("n", "h");
        zero_port.port = 0;
        assert!(validate_profile(&zero_port).is_err());
    }

    #[test]
    fn key_auth_requires_non_empty_path() {
        let mut profile = sample("n", "h");
        profile.auth_method = SshAuthMethod::Key {
            key_path: "  ".into(),
        };
        assert!(validate_profile(&profile).is_err());
        profile.auth_method = SshAuthMethod::Key {
            key_path: "/home/dev/.ssh/id_ed25519".into(),
        };
        assert!(validate_profile(&profile).is_ok());
    }

    #[test]
    fn profiles_round_trip_via_temp_file() {
        let dir = std::env::temp_dir().join(format!(
            "nexterm-ssh-profiles-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("ssh-profiles.json");

        let mut profile = sample("prod", "10.0.0.1");
        store_profiles(&path, std::slice::from_ref(&profile)).expect("store");
        let loaded = load_profiles(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "prod");

        profile.id = "ssh-test".into();
        store_profiles(&path, &[profile.clone()]).expect("store 2");
        let loaded = load_profiles(&path);
        assert_eq!(loaded[0].id, "ssh-test");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_profile_file_starts_empty() {
        let dir = std::env::temp_dir().join(format!(
            "nexterm-ssh-corrupt-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("ssh-profiles.json");
        std::fs::write(&path, "{not json").expect("write junk");
        assert!(load_profiles(&path).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
