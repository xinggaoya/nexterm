use std::path::{Path, PathBuf};
use std::sync::OnceLock;

mod env;
mod registry;
mod roots;
mod wsl;

pub use env::{WorkspaceEnv, reject_ssh_unsupported};
pub use registry::{WorkspaceRegistry, authorize_spawn_cwd, bootstrap_registry_with_launch_dir};
pub(crate) use registry::normalize_host_path;
pub use wsl::{WslDistro, resolve_path};
#[cfg(windows)]
pub use wsl::{decode_command_output, wsl_path_to_host, wsl_path_to_unc};
#[cfg(windows)]
pub(crate) use wsl::{normalize_wsl_value, validate_wsl_distro_name, wsl_exec_capture};
#[cfg(windows)]
use wsl::{list_distros_blocking, normalize_wsl_workspace_request_path, run_wsl_sh};

#[tauri::command]
pub async fn workspace_authorize(
    path: String,
    workspace: Option<WorkspaceEnv>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_workspace_path(&registry, &path, &workspace)
}

// Snapshotted once at app startup so the live `current_dir()` drifting later
// (file dialogs, plugin chdir) can't shift the value seen by IPC or spawn.
static LAUNCH_CWD: OnceLock<Option<PathBuf>> = OnceLock::new();

pub fn init_launch_cwd() {
    LAUNCH_CWD.get_or_init(|| {
        std::env::current_dir()
            .ok()
            .filter(|p| is_usable_launch_dir(p))
    });
}

pub fn launch_cwd_snapshot() -> Option<PathBuf> {
    LAUNCH_CWD.get().and_then(|o| o.clone())
}

/// 解析可用的启动目录:快照的 cwd → 当前 cwd(须可用)→ 家目录。
/// 返回 `None` 表示没有可用目录,调用方跳过授权;不再兜底到
/// `PathBuf::from("/")` —— 那在 Windows 上不是有效目录,只会让
/// 授权调用空转。
fn resolve_launch_dir() -> Option<PathBuf> {
    if let Some(cwd) = launch_cwd_snapshot() {
        return Some(cwd);
    }
    if let Some(cwd) = std::env::current_dir()
        .ok()
        .filter(|p| is_usable_launch_dir(p))
    {
        return Some(cwd);
    }
    dirs::home_dir()
}

fn is_usable_launch_dir(path: &Path) -> bool {
    if !path.is_dir() || path == Path::new("/") {
        return false;
    }
    let s = path.to_string_lossy();
    if s.contains(".app/Contents/") {
        return false;
    }
    if cfg!(debug_assertions) && path.file_name().and_then(|s| s.to_str()) == Some("src-tauri") {
        return false;
    }
    true
}

fn authorize_workspace_path(
    registry: &WorkspaceRegistry,
    path: &str,
    workspace: &WorkspaceEnv,
) -> Result<String, String> {
    let client_path = normalize_workspace_request_path(path, workspace)?;
    // SSH 工作区:路径语义在远端,宿主注册表不参与;终端 cwd 授权靠
    // 前端从探针/用户输入取得的远端路径。fs 类操作由守卫提前拒绝。
    if workspace.is_ssh() {
        return Ok(client_path);
    }
    let resolved = resolve_path(&client_path, workspace);
    let canonical = registry.authorize(&resolved).map_err(|e| e.to_string())?;
    if workspace.is_wsl() {
        Ok(client_path)
    } else {
        Ok(canonical.to_string_lossy().replace('\\', "/"))
    }
}

#[cfg(windows)]
fn normalize_workspace_request_path(
    path: &str,
    workspace: &WorkspaceEnv,
) -> Result<String, String> {
    match workspace {
        WorkspaceEnv::Local | WorkspaceEnv::Ssh { .. } => Ok(path.to_string()),
        WorkspaceEnv::Wsl { distro } => normalize_wsl_workspace_request_path(distro, path),
    }
}

#[cfg(not(windows))]
fn normalize_workspace_request_path(
    path: &str,
    _workspace: &WorkspaceEnv,
) -> Result<String, String> {
    Ok(path.to_string())
}

#[tauri::command]
pub async fn wsl_list_distros() -> Result<Vec<WslDistro>, String> {
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(list_distros_blocking)
            .await
            .map_err(|e| e.to_string())?
    }
}

/// 本机文件系统根（Windows 盘符 / POSIX 根），应用内文件选择器的快捷入口。
#[tauri::command]
pub fn local_list_roots() -> Vec<String> {
    roots::list_roots()
}

#[tauri::command]
pub fn wsl_home(distro: String) -> Result<String, String> {
    #[cfg(not(windows))]
    {
        let _ = distro;
        Err("WSL is only available on Windows".into())
    }
    #[cfg(windows)]
    {
        let out = run_wsl_sh(&distro, "printf %s \"$HOME\"")?;
        let home = normalize_wsl_value(out, "");
        if home.is_empty() {
            Err(format!("could not resolve WSL home for {distro}"))
        } else {
            Ok(home)
        }
    }
}

#[cfg(windows)]
pub fn wsl_login_shell(distro: String) -> Result<String, String> {
    const SCRIPT: &str = r#"uid="$(id -u 2>/dev/null || printf '')"
entry=''
if [ -n "$uid" ] && command -v getent >/dev/null 2>&1; then
  entry="$(getent passwd "$uid" 2>/dev/null || true)"
fi
if [ -z "$entry" ] && [ -n "$uid" ] && [ -r /etc/passwd ]; then
  entry="$(awk -F: -v u="$uid" '$3 == u { print; exit }' /etc/passwd 2>/dev/null)"
fi
shell=''
if [ -n "$entry" ]; then
  shell="${entry##*:}"
fi
if [ -z "$shell" ] && [ -n "$SHELL" ]; then
  shell="$SHELL"
fi
if [ -z "$shell" ]; then
  shell=/bin/sh
fi
printf %s "$shell""#;

    let out = run_wsl_sh(&distro, SCRIPT)?;
    Ok(normalize_wsl_value(out, "/bin/sh"))
}
