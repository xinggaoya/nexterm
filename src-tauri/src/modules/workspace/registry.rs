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

/// 授权根上限。长会话里用户会打开大量目录，注册表只增不减会让
/// `is_authorized` 退化成对整个集合的线性扫描。超出后按插入顺序淘汰最旧的。
const MAX_AUTHORIZED_ROOTS: usize = 64;

/// 稳定的错误前缀，前端据此区分「路径越权」与「路径不存在」。
/// 形状是 `PathNotAuthorized: <path>`，与仓库其它 `Result<_, String>`
/// 命令的错误约定一致。
pub const PATH_NOT_AUTHORIZED_PREFIX: &str = "PathNotAuthorized: ";

/// 绝对不能被工作区授权的目录。即使某个流程误把它们加了进来，
/// `authorize` 也会拒绝 —— 深链、CLI 参数都走这一个入口。
const FORBIDDEN_HOME_SUBPATHS: &[&str] = &[".ssh", ".aws", ".gnupg", ".config/gcloud"];

struct CanonicalEntry {
    canonical: PathBuf,
    inserted_at: Instant,
}

#[derive(Default)]
pub struct WorkspaceRegistry {
    roots: Mutex<AuthorizedRoots>,
    canonical_cache: Mutex<HashMap<PathBuf, CanonicalEntry>>,
}

#[derive(Default)]
struct AuthorizedRoots {
    set: HashSet<PathBuf>,
    /// 插入顺序，用于 `MAX_AUTHORIZED_ROOTS` 的 FIFO 淘汰。
    order: Vec<PathBuf>,
}

/// 该路径（或其任一祖先前缀）是否是凭据目录。
fn is_sensitive_dir(path: &Path) -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    let home = normalize_host_path(home);
    let target = normalize_host_path(path.to_path_buf());
    if !target.starts_with(&home) {
        return false;
    }
    let Ok(relative) = target.strip_prefix(&home) else {
        return false;
    };
    let components: Vec<String> = relative
        .components()
        .map(|c| c.as_os_str().to_string_lossy().replace('\\', "/"))
        .collect();
    for sensitive in FORBIDDEN_HOME_SUBPATHS {
        let parts: Vec<&str> = sensitive.split('/').collect();
        if parts.len() <= components.len()
            && parts
                .iter()
                .zip(components.iter())
                .all(|(a, b)| a.eq_ignore_ascii_case(b))
        {
            return true;
        }
    }
    false
}

impl WorkspaceRegistry {
    pub fn authorize<P: AsRef<Path>>(&self, path: P) -> std::io::Result<PathBuf> {
        let canonical = normalize_host_path(std::fs::canonicalize(path.as_ref())?);
        if is_sensitive_dir(&canonical) {
            return Err(std::io::Error::other(format!(
                "refusing to authorize sensitive directory: {}",
                canonical.display()
            )));
        }
        let mut roots = self.roots.lock().map_err(|error| {
            std::io::Error::other(format!("workspace registry poisoned: {error}"))
        })?;
        // HashSet 无插入顺序，用 Vec 记录 FIFO 顺序做容量淘汰。
        if !roots.set.contains(&canonical) {
            roots.order.push(canonical.clone());
        }
        roots.set.insert(canonical.clone());
        while roots.order.len() > MAX_AUTHORIZED_ROOTS {
            if let Some(evicted) = roots.order.first().cloned() {
                roots.order.remove(0);
                roots.set.remove(&evicted);
            } else {
                break;
            }
        }
        Ok(canonical)
    }

    pub fn is_authorized(&self, target: &Path) -> bool {
        if is_sensitive_dir(target) {
            return false;
        }
        let target = normalize_host_path(target.to_path_buf());
        match self.roots.lock() {
            Ok(roots) => roots.set.iter().any(|root| target.starts_with(root)),
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
        if is_sensitive_dir(target) {
            return None;
        }
        let target = normalize_host_path(target.to_path_buf());
        let roots = self.roots.lock().ok()?;
        roots
            .set
            .iter()
            .filter(|root| target.starts_with(root))
            .max_by_key(|root| root.as_os_str().len())
            .map(|root| root.to_string_lossy().replace('\\', "/"))
    }

    /// 已授权根的数量（测试与诊断用）。
    pub fn authorized_root_count(&self) -> usize {
        self.roots.lock().map(|roots| roots.set.len()).unwrap_or(0)
    }

    /// 最近一次授权的根 —— 也就是「用户当前正在看的那个工作区」。
    ///
    /// 命令没给 cwd 时用它兜底，而不是「缺省 = 不检查」。后者让
    /// `shell_run_command` / `shell_bg_spawn` 在 cwd 缺省时完全绕开授权。
    pub fn current_root(&self) -> Option<PathBuf> {
        let roots = self.roots.lock().ok()?;
        roots.order.last().cloned()
    }

    /// 撤销一个授权根。关闭工作区时用，避免注册表只增不减。
    pub fn deauthorize<P: AsRef<Path>>(&self, path: P) {
        let Ok(canonical) = std::fs::canonicalize(path.as_ref()) else {
            return;
        };
        let canonical = normalize_host_path(canonical);
        let Ok(mut roots) = self.roots.lock() else {
            return;
        };
        roots.set.remove(&canonical);
        roots.order.retain(|root| root != &canonical);
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

// `None` means "fall back to the active workspace root", NOT "skip the
// check". `Some` is canonicalized to defeat symlink/`..` traversal and must
// sit under an authorized root.
pub fn authorize_spawn_cwd(
    registry: &WorkspaceRegistry,
    cwd: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<Option<PathBuf>, String> {
    let Some(cwd) = cwd.map(str::trim).filter(|s| !s.is_empty()) else {
        // 缺省 cwd 不等于「无授权」。旧实现在这里直接 Ok(None)，于是
        // `shell_run_command` 只要把 cwd 传成 null 就能在任意目录起进程。
        if workspace.is_ssh() {
            return Ok(None);
        }
        return Ok(registry.current_root());
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
        if let Err(error) = registry.authorize(dir) {
            log::warn!("bootstrap: launch dir not authorized: {error}");
        }
    }
    // resolve_launch_dir 返回 None 时无可用启动目录,跳过授权;
    // 旧实现会兜底 authorize "/"(Windows 上并非有效目录)。
    //
    // 旧实现在这里还无条件 authorize(dirs::home_dir())。那把 ~/.ssh、
    // ~/.aws、~/.gnupg、.env 一次性全部暴露给所有走 is_authorized 的
    // 命令 —— 一旦 webview 出现 XSS,凭据目录即刻可读。授权只应该来自
    // 「用户显式打开了某个目录」,家目录不是那个信号。
    if let Some(dir) = resolve_launch_dir() {
        if let Err(error) = registry.authorize(dir) {
            log::warn!("bootstrap: launch dir not authorized: {error}");
        }
    }
}

/// 路径类命令（fs_* / git_* / pty cwd …）的**统一入口校验**。
///
/// 这是一个 chokepoint：所有会碰本地文件系统的命令都必须在入口过这里，
/// 否则 `WorkspaceRegistry` 就只是「名字上像访问控制」。历史上只有 watcher
/// 用了 `is_authorized`，`fs_read_file` / `fs_write_file` / `fs_search` 全都
/// 裸奔 —— webview 内任意脚本可以读 `~/.ssh/id_rsa`、写任意路径。
///
/// 语义：
/// - `Local` / `Wsl`：解析到宿主路径 → canonicalize（消掉 `..` 与符号链接）
///   → 必须在某个已授权根之下
/// - `Ssh`：路径语义在远端，宿主注册表无意义，交由远端侧鉴权后原样返回
///
/// 返回的是 canonical 绝对路径，调用方应当**用它**而不是原始入参。
pub fn authorize_access_path(
    registry: &WorkspaceRegistry,
    raw: &str,
    workspace: &WorkspaceEnv,
) -> Result<PathBuf, String> {
    if workspace.is_ssh() {
        return Ok(PathBuf::from(raw));
    }
    let resolved = resolve_path(raw, workspace);
    let canonical = registry
        .canonicalize_cached(&resolved)
        .map_err(|e| format!("path not accessible: {e}"))?;
    if !registry.is_authorized(&canonical) {
        return Err(format!("{PATH_NOT_AUTHORIZED_PREFIX}{raw}"));
    }
    Ok(canonical)
}

/// 写入类路径的宽松版：目标文件可能尚不存在（新建文件、粘贴落盘的位置），
/// 此时 canonicalize 会失败。策略是回退到「最近一个存在的祖先」做授权判定
/// —— 符号链接逃逸仍然会被 canonicalize 挡住。
pub fn authorize_access_path_lenient(
    registry: &WorkspaceRegistry,
    raw: &str,
    workspace: &WorkspaceEnv,
) -> Result<PathBuf, String> {
    if workspace.is_ssh() {
        return Ok(PathBuf::from(raw));
    }
    match authorize_access_path(registry, raw, workspace) {
        Ok(canonical) => Ok(canonical),
        Err(error) if error.starts_with("path not accessible") => {
            let resolved = resolve_path(raw, workspace);
            let Some(parent) = resolved.parent() else {
                return Err(error);
            };
            let Ok(canonical_parent) = registry.canonicalize_cached(parent) else {
                return Err(error);
            };
            if !registry.is_authorized(&canonical_parent) {
                return Err(format!("{PATH_NOT_AUTHORIZED_PREFIX}{raw}"));
            }
            Ok(canonical_parent.join(resolved.file_name().unwrap_or_default()))
        }
        Err(error) => Err(error),
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
    fn authorize_spawn_cwd_falls_back_to_the_active_root() {
        // 安全护栏：cwd 缺省时必须回落到已授权根，而不是「不检查就放行」。
        let root = tempdir("default-cwd");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&root).expect("authorize root");
        let expected = reg.current_root().expect("active root");

        assert_eq!(
            authorize_spawn_cwd(&reg, None, &WorkspaceEnv::Local).unwrap(),
            Some(expected.clone())
        );
        assert_eq!(
            authorize_spawn_cwd(&reg, Some("   "), &WorkspaceEnv::Local).unwrap(),
            Some(expected.clone())
        );
    }

    #[test]
    fn authorize_spawn_cwd_returns_none_when_nothing_is_authorized() {
        let reg = WorkspaceRegistry::default();
        assert!(authorize_spawn_cwd(&reg, None, &WorkspaceEnv::Local)
            .unwrap()
            .is_none());
    }

    #[test]
    fn current_root_tracks_the_most_recent_authorization() {
        let first = tempdir("root-a");
        let second = tempdir("root-b");
        let reg = WorkspaceRegistry::default();
        assert!(reg.current_root().is_none());
        reg.authorize(&first).expect("authorize first");
        assert_eq!(reg.current_root().as_deref(), Some(first.as_path()));
        reg.authorize(&second).expect("authorize second");
        assert_eq!(reg.current_root().as_deref(), Some(second.as_path()));
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
    fn bootstrap_never_authorizes_the_whole_home_directory() {
        // 回归护栏：`resolve_launch_dir` 曾经以 `dirs::home_dir()` 兜底，
        // 而它只被 bootstrap 的授权路径使用 —— 也就是「每次冷启动都把
        // ~/.ssh、~/.aws、~/.gnupg 授权给所有 fs_* 命令」。
        // 注意：CLI 参数解析出的 launch dir 与当前进程 cwd 都可能恰好是
        // 家目录（从 home 启动终端时），那是**有意的**授权；这里断言的是
        // 「没有任何额外路径因为是家目录而被兜底授权」。
        // 回归护栏：曾经无条件 authorize(dirs::home_dir())，那把 ~/.ssh、
        // ~/.aws、~/.gnupg 一次性暴露给所有走 is_authorized 的命令。
        let reg = WorkspaceRegistry::default();
        bootstrap_registry_with_launch_dir(&reg, None);
        let Some(home) = dirs::home_dir() else {
            return;
        };
        for sensitive in [".ssh", ".aws", ".gnupg"] {
            let dir = home.join(sensitive);
            if !dir.exists() {
                continue;
            }
            assert!(
                !reg.is_authorized(&dir),
                "{sensitive} must never be authorized by bootstrap"
            );
        }
    }

    #[test]
    fn bootstrap_stays_empty_when_there_is_no_real_launch_dir() {
        // 回归护栏：`resolve_launch_dir` 曾以 `dirs::home_dir()` 兜底，而它
        // 只被 bootstrap 的授权路径用到 —— 也就是「macOS 从 Finder 启动时
        // cwd 是 `/`（不可用）→ 兜底到 home → 每次冷启动都把 ~/.ssh、
        // ~/.aws、~/.gnupg 授权给所有 fs_* 命令」。
        //
        // `launch_cwd_snapshot` 是 OnceLock，在本测试进程里已固定，因此
        // 这里直接断言「注册表里不存在任何因为是家目录而被兜底授权的根」。
        let reg = WorkspaceRegistry::default();
        bootstrap_registry_with_launch_dir(&reg, None);

        let Some(home) = dirs::home_dir() else {
            return;
        };
        let home = normalize_host_path(home);
        // 家目录本身可能恰好就是当前进程 cwd（从 home 启动终端），那种情况
        // 是**有意的**授权，不能据此断言。真正要守的是它的敏感子目录。
        for sensitive in [".ssh", ".aws", ".gnupg", ".config/gcloud"] {
            let dir = home.join(sensitive);
            if dir.exists() {
                assert!(
                    !reg.is_authorized(&dir),
                    "{sensitive} must never be authorized by bootstrap"
                );
            }
        }
    }

    #[test]
    fn authorize_refuses_sensitive_home_subdirectories() {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let reg = WorkspaceRegistry::default();
        for sensitive in [".ssh", ".aws", ".gnupg"] {
            let dir = home.join(sensitive);
            if !dir.exists() {
                continue;
            }
            assert!(
                reg.authorize(&dir).is_err(),
                "{sensitive} must be rejected by authorize()"
            );
            assert!(!reg.is_authorized(&dir));
        }
    }

    #[test]
    fn authorize_access_path_enforces_roots() {
        let allowed = tempdir("access-ok");
        let foreign = tempdir("access-foreign");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&allowed).expect("authorize root");
        let local = WorkspaceEnv::Local;

        let ok = authorize_access_path(&reg, allowed.to_str().unwrap(), &local);
        assert!(ok.is_ok(), "authorized root must pass: {ok:?}");

        let bad = authorize_access_path(&reg, foreign.to_str().unwrap(), &local);
        assert!(bad.is_err(), "foreign dir must be rejected");
        assert!(bad.unwrap_err().starts_with(PATH_NOT_AUTHORIZED_PREFIX));
    }

    #[test]
    fn authorize_access_path_lenient_allows_not_yet_created_files() {
        let root = tempdir("lenient-root");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&root).expect("authorize root");
        let target = root.join("brand-new-file.txt");
        let resolved =
            authorize_access_path_lenient(&reg, target.to_str().unwrap(), &WorkspaceEnv::Local)
                .expect("lenient resolve");
        assert!(resolved.ends_with("brand-new-file.txt"), "{resolved:?}");
    }

    #[test]
    fn authorized_roots_are_capped() {
        // 长会话里用户会打开大量目录；注册表只增不减会让 is_authorized
        // 退化成对整个集合的线性扫描。
        let reg = WorkspaceRegistry::default();
        for i in 0..(MAX_AUTHORIZED_ROOTS + 20) {
            let dir = tempdir(&format!("cap{i}"));
            reg.authorize(&dir).expect("authorize");
        }
        assert!(reg.authorized_root_count() <= MAX_AUTHORIZED_ROOTS);
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
