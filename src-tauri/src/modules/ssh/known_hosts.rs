//! known_hosts 的 TOFU(Trust On First Use)管理。
//!
//! Phase 1 策略:首次连接记录并信任;指纹匹配放行;**指纹变化一律拒绝**
//! (疑似 MITM),错误信息提示用户手动清理 known_hosts 条目后重连。
//! "接受变化"的确认 UI 属 Phase 3。

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostEntry {
    pub host: String,
    pub key_type: String,
    pub public_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyVerdict {
    Match,
    New,
    Changed { stored_public_key: String },
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredKnownHosts {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    entries: Vec<KnownHostEntry>,
}

fn file_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn load(path: &PathBuf) -> StoredKnownHosts {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn store(path: &PathBuf, stored: &StoredKnownHosts) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(stored).map_err(|error| error.to_string())?;
    let tmp = path.with_extension("json.__nexterm_tmp__");
    std::fs::write(&tmp, raw).map_err(|error| format!("write {}: {error}", tmp.display()))?;
    std::fs::rename(&tmp, path)
        .map_err(|error| format!("rename to {}: {error}", path.display()))
}

/// 校验远端主机密钥。`host` 为 `host:port` 形式。
pub fn verify(
    path: &PathBuf,
    host: &str,
    key_type: &str,
    public_key: &str,
) -> HostKeyVerdict {
    let stored = load(path);
    match stored
        .entries
        .iter()
        .find(|entry| entry.host.eq_ignore_ascii_case(host))
    {
        None => HostKeyVerdict::New,
        Some(entry) => {
            if entry.key_type == key_type && entry.public_key == public_key {
                HostKeyVerdict::Match
            } else {
                HostKeyVerdict::Changed {
                    stored_public_key: entry.public_key.clone(),
                }
            }
        }
    }
}

/// 记录(或覆盖同 host 的)主机密钥。仅在 verify 给出 New / 由用户确认
/// Changed 后调用。
pub fn record(
    path: &PathBuf,
    host: &str,
    key_type: &str,
    public_key: &str,
) -> Result<(), String> {
    let _guard = file_lock().lock().map_err(|error| format!("known hosts lock poisoned: {error}"))?;
    let mut stored = load(path);
    stored.entries.retain(|entry| !entry.host.eq_ignore_ascii_case(host));
    stored.entries.push(KnownHostEntry {
        host: host.to_string(),
        key_type: key_type.to_string(),
        public_key: public_key.to_string(),
    });
    store(path, &stored)
}

/// 用户在确认主机重建后手动移除条目(Phase 3 由 UI 暴露)。
pub fn remove(path: &PathBuf, host: &str) -> Result<bool, String> {
    let _guard = file_lock().lock().map_err(|error| format!("known hosts lock poisoned: {error}"))?;
    let mut stored = load(path);
    let before = stored.entries.len();
    stored
        .entries
        .retain(|entry| !entry.host.eq_ignore_ascii_case(host));
    let removed = stored.entries.len() != before;
    if removed {
        store(path, &stored)?;
    }
    Ok(removed)
}

pub fn list(path: &PathBuf) -> Vec<KnownHostEntry> {
    load(path).entries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nexterm-ssh-known-hosts-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir.join("ssh-known-hosts.json")
    }

    #[test]
    fn new_host_records_then_matches() {
        let path = temp_path("roundtrip");
        assert_eq!(verify(&path, "h1:22", "ssh-ed25519", "AAA"), HostKeyVerdict::New);
        record(&path, "h1:22", "ssh-ed25519", "AAA").expect("record");
        assert_eq!(verify(&path, "h1:22", "ssh-ed25519", "AAA"), HostKeyVerdict::Match);
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn changed_key_is_detected_with_stored_value() {
        let path = temp_path("changed");
        record(&path, "h2:22", "ssh-ed25519", "OLD").expect("record");
        match verify(&path, "h2:22", "ssh-ed25519", "NEW") {
            HostKeyVerdict::Changed { stored_public_key } => {
                assert_eq!(stored_public_key, "OLD");
            }
            other => panic!("expected Changed, got {other:?}"),
        }
        // key type 不同同样视为变化
        assert_ne!(verify(&path, "h2:22", "rsa-sha2-512", "OLD"), HostKeyVerdict::Match);
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn host_comparison_is_case_insensitive_and_record_overwrites() {
        let path = temp_path("case");
        record(&path, "Example.COM:22", "ssh-ed25519", "A").expect("record");
        assert_eq!(verify(&path, "example.com:22", "ssh-ed25519", "A"), HostKeyVerdict::Match);
        record(&path, "example.com:22", "ssh-ed25519", "B").expect("overwrite");
        let entries = list(&path);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].public_key, "B");
        assert!(remove(&path, "EXAMPLE.COM:22").expect("remove"));
        assert!(list(&path).is_empty());
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }
}
