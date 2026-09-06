use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::env::WorkspaceEnv;
use super::resolve_launch_dir;
use super::wsl::resolve_path;

// Short TTL keeps the auth-check TOCTOU window tight while still coalescing the
// burst of canonicalize calls within a single panel refresh (~100ms).
const CANONICAL_TTL: Duration = Duration::from_secs(1);
const CANONICAL_CACHE_CAP: usize = 256;

struct CanonicalEntry {
    canonical: PathBuf,
    inserted_at: Instant,
}

#[derive(Default)]
pub struct WorkspaceRegistry {
    roots: Mutex<HashSet<PathBuf>>,
    canonical_cache: Mutex<HashMap<PathBuf, CanonicalEntry>>,
}

impl WorkspaceRegistry {
    pub fn authorize<P: AsRef<Path>>(&self, path: P) -> std::io::Result<PathBuf> {
        let canonical = normalize_host_path(std::fs::canonicalize(path.as_ref())?);
        let mut set = self
            .roots
            .lock()
            .map_err(|error| std::io::Error::other(format!("workspace registry poisoned: {error}")))?;
        set.insert(canonical.clone());
        Ok(canonical)
    }

    pub fn is_authorized(&self, target: &Path) -> bool {
        let target = normalize_host_path(target.to_path_buf());
        match self.roots.lock() {
            Ok(set) => set.iter().any(|root| target.starts_with(root)),
            // A poisoned registry means an earlier panic while inserting or
            // reading authorized roots. Be safe and reject the path: callers
            // will re-authorize through the bootstrap path on the next call.
            Err(error) => {
                log::warn!("workspace registry poisoned during is_authorized: {error}");
                false
            }
        }
    }

    /// Find the longest authorized root that is a prefix of `target`,
    /// returning it as a forward-slash string suitable for
    /// `WorkspaceFsChangedEvent`. Used by app-internal fs commands to
    /// route their proactive events to the right watcher.
    pub fn longest_authorized_root(&self, target: &Path) -> Option<String> {
        let target = normalize_host_path(target.to_path_buf());
        let set = self.roots.lock().ok()?;
        set.iter()
            .filter(|root| target.starts_with(root))
            .max_by_key(|root| root.as_os_str().len())
            .map(|root| root.to_string_lossy().replace('\\', "/"))
    }

    pub fn canonicalize_cached<P: AsRef<Path>>(&self, path: P) -> std::io::Result<PathBuf> {
        let key = path.as_ref().to_path_buf();
        {
            match self.canonical_cache.lock() {
                Ok(cache) => {
                    if let Some(entry) = cache.get(&key) {
                        if entry.inserted_at.elapsed() < CANONICAL_TTL {
                            return Ok(entry.canonical.clone());
                        }
                    }
                }
                Err(error) => {
                    log::warn!("canonical cache poisoned on read; bypassing: {error}");
                }
            }
        }
        let canonical = normalize_host_path(std::fs::canonicalize(&key)?);
        let mut cache = match self.canonical_cache.lock() {
            Ok(cache) => cache,
            Err(error) => {
                // Read-side still works; the only thing we lose is the cache
                // for this entry. Falling through to the result below is
                // strictly better than aborting the IPC handler.
                log::warn!("canonical cache poisoned on write; skipping cache: {error}");
                return Ok(canonical);
            }
        };
        if cache.len() >= CANONICAL_CACHE_CAP {
            cache.retain(|_, entry| entry.inserted_at.elapsed() < CANONICAL_TTL);
            if cache.len() >= CANONICAL_CACHE_CAP {
                cache.clear();
            }
        }
        cache.insert(
            key,
            CanonicalEntry {
                canonical: canonical.clone(),
                inserted_at: Instant::now(),
            },
        );
        Ok(canonical)
    }
}

#[cfg(windows)]
pub(crate) fn normalize_host_path(path: PathBuf) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

#[cfg(not(windows))]
pub(crate) fn normalize_host_path(path: PathBuf) -> PathBuf {
    path
}

// `None` means "use bootstrapped default". `Some` is canonicalized to defeat
// symlink/`..` traversal and must sit under an authorized root.
pub fn authorize_spawn_cwd(
    registry: &WorkspaceRegistry,
    cwd: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<Option<PathBuf>, String> {
    let Some(cwd) = cwd.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if workspace.is_ssh() {
        // SSH cwd 是远端路径,宿主注册表无意义;实际授权发生在远端。
        return Ok(Some(PathBuf::from(cwd)));
    }
    let resolved = resolve_path(cwd, workspace);
    let canonical = registry
        .canonicalize_cached(&resolved)
        .map_err(|e| format!("cwd not accessible: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("cwd is not a directory: {}", canonical.display()));
    }
    if !registry.is_authorized(&canonical) {
        return Err(format!(
            "cwd is outside the authorized workspace: {}",
            canonical.display()
        ));
    }
    Ok(Some(canonical))
}

pub fn bootstrap_registry_with_launch_dir(registry: &WorkspaceRegistry, launch_dir: Option<&Path>) {
    if let Some(dir) = launch_dir {
        let _ = registry.authorize(dir);
    }
    // resolve_launch_dir 返回 None 时无可用启动目录,跳过授权;
    // 旧实现会兜底 authorize "/"(Windows 上并非有效目录)。
    if let Some(dir) = resolve_launch_dir() {
        let _ = registry.authorize(dir);
    }
    if let Some(home) = dirs::home_dir() {
        let _ = registry.authorize(home);
    }
}

#[cfg(test)]
mod auth_tests {
    use super::*;
    use std::env;
    use std::fs;

    fn tempdir(label: &str) -> PathBuf {
        let mut p = env::temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        p.push(format!(
            "nexterm-auth-{label}-{nanos}-{}",
            std::process::id()
        ));
        fs::create_dir_all(&p).expect("create tempdir");
        normalize_host_path(fs::canonicalize(&p).expect("canonicalize tempdir"))
    }

    #[test]
    fn authorize_spawn_cwd_accepts_none() {
        let reg = WorkspaceRegistry::default();
        assert!(authorize_spawn_cwd(&reg, None, &WorkspaceEnv::Local)
            .unwrap()
            .is_none());
    }

    #[test]
    fn authorize_spawn_cwd_accepts_empty_string() {
        let reg = WorkspaceRegistry::default();
        assert!(authorize_spawn_cwd(&reg, Some("   "), &WorkspaceEnv::Local)
            .unwrap()
            .is_none());
    }

    #[test]
    fn authorize_spawn_cwd_accepts_authorized_path() {
        let dir = tempdir("ok");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&dir).expect("authorize root");
        let s = dir.to_string_lossy().into_owned();
        let resolved = authorize_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect("authorized")
            .expect("returned canonical");
        assert_eq!(resolved, dir);
    }

    #[test]
    fn authorize_spawn_cwd_accepts_subdir_of_authorized_root() {
        let root = tempdir("subroot");
        let sub = root.join("inside");
        fs::create_dir_all(&sub).expect("subdir");
        let canonical_sub = normalize_host_path(fs::canonicalize(&sub).expect("canon sub"));
        let reg = WorkspaceRegistry::default();
        reg.authorize(&root).expect("authorize root");
        let s = canonical_sub.to_string_lossy().into_owned();
        let resolved = authorize_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect("subdir authorized")
            .expect("returned canonical");
        assert_eq!(resolved, canonical_sub);
    }

    #[test]
    fn bootstrap_registry_authorizes_explicit_launch_dir() {
        let dir = tempdir("launcharg");
        let reg = WorkspaceRegistry::default();
        bootstrap_registry_with_launch_dir(&reg, Some(dir.as_path()));

        assert!(
            reg.is_authorized(&dir),
            "launch argument dir should be an authorized workspace root"
        );
    }

    #[cfg(windows)]
    #[test]
    fn registry_authorization_treats_windows_verbatim_prefix_as_equivalent() {
        fn strip_verbatim(path: &Path) -> PathBuf {
            let raw = path.to_string_lossy();
            PathBuf::from(raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string())
        }

        fn add_verbatim(path: &Path) -> PathBuf {
            let raw = path.to_string_lossy();
            if raw.starts_with(r"\\?\") {
                PathBuf::from(raw.to_string())
            } else {
                PathBuf::from(format!(r"\\?\{raw}"))
            }
        }

        let root = tempdir("verbatim");
        let reg = WorkspaceRegistry::default();
        let authorized = reg.authorize(&root).expect("authorize root");
        let normal = strip_verbatim(&authorized);
        let verbatim = add_verbatim(&normal);

        assert!(reg.is_authorized(&normal), "normal path should match root");
        assert!(
            reg.is_authorized(&verbatim),
            "verbatim path should match root"
        );
    }

    #[test]
    fn authorize_spawn_cwd_rejects_unauthorized_path() {
        let allowed = tempdir("allowed");
        let foreign = tempdir("foreign");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&allowed).expect("authorize root");
        let s = foreign.to_string_lossy().into_owned();
        let err = authorize_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect_err("should reject unauthorized cwd");
        assert!(err.contains("outside"), "got: {err}");
    }

    #[test]
    fn authorize_spawn_cwd_rejects_missing_path() {
        let mut missing = env::temp_dir();
        missing.push(format!(
            "nexterm-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let reg = WorkspaceRegistry::default();
        let s = missing.to_string_lossy().into_owned();
        let err = authorize_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect_err("should reject missing path");
        assert!(err.contains("cwd not accessible"), "got: {err}");
    }

    #[test]
    fn authorize_spawn_cwd_blocks_symlink_escape() {
        let allowed = tempdir("symroot");
        let outside = tempdir("symtarget");
        let link = allowed.join("escape");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).expect("symlink");
        #[cfg(windows)]
        if let Err(err) = std::os::windows::fs::symlink_dir(&outside, &link) {
            if err.raw_os_error() == Some(1314) {
                return;
            }
            panic!("symlink: {err}");
        }
        let reg = WorkspaceRegistry::default();
        reg.authorize(&allowed).expect("authorize root");
        let s = link.to_string_lossy().into_owned();
        let err = authorize_spawn_cwd(&reg, Some(&s), &WorkspaceEnv::Local)
            .expect_err("symlink-escape must be rejected");
        assert!(err.contains("outside"), "got: {err}");
    }
}
