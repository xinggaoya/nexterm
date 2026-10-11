use std::path::PathBuf;

use tauri::{AppHandle, State};

use super::super::workspace::{authorize_access_path, WorkspaceEnv, WorkspaceRegistry};
use super::{LspMessage, LspRegistry, LspResolvedCommand, LspSessionInfo, SessionId};

/// 启动一个语言服务器。
///
/// **只接受 `language`，不接受可执行文件路径。** 命令由后端白名单解析
/// （[`LspRegistry::resolve_spec`]）；`cwd` 必须是已授权的工作区目录。
/// 允许 webview 指定 `command` 等于交出一个「以宿主权限执行任意程序」的
/// 原语。
#[tauri::command]
pub async fn lsp_start(
    language: String,
    cwd: Option<String>,
    channel: tauri::ipc::Channel<LspMessage>,
    registry: State<'_, LspRegistry>,
    workspace_registry: State<'_, WorkspaceRegistry>,
    workspace: Option<WorkspaceEnv>,
    _app: AppHandle,
) -> Result<SessionId, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let resolved = resolve_authorized_cwd(cwd.as_deref(), &workspace, workspace_registry.inner())?;
    registry
        .spawn(&language, resolved.as_deref(), channel)
        .map_err(String::from)
}

/// 把前端传来的 cwd 解析成一个「已授权」的绝对路径。
///
/// - `None` → `None`（server 用自己的默认 cwd）
/// - 给了但没授权 → 报错，而不是静默放行
fn resolve_authorized_cwd(
    cwd: Option<&str>,
    workspace: &WorkspaceEnv,
    registry: &WorkspaceRegistry,
) -> Result<Option<PathBuf>, String> {
    let Some(raw) = cwd.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let authorized = authorize_access_path(registry, raw, workspace)?;
    Ok(Some(authorized))
}

#[tauri::command]
pub async fn lsp_write(
    id: SessionId,
    message: String,
    registry: State<'_, LspRegistry>,
) -> Result<(), String> {
    registry.write(id, message).map_err(String::from)
}

#[tauri::command]
pub async fn lsp_stop(id: SessionId, registry: State<'_, LspRegistry>) -> Result<(), String> {
    registry.kill(id).map_err(String::from)
}

/// 终止并清空所有语言服务器（切换工作区 / 应用退出时调用）。
#[tauri::command]
pub async fn lsp_stop_all(registry: State<'_, LspRegistry>) -> Result<usize, String> {
    Ok(registry.kill_all())
}

#[tauri::command]
pub async fn lsp_list(registry: State<'_, LspRegistry>) -> Result<Vec<LspSessionInfo>, String> {
    Ok(registry.list())
}

#[tauri::command]
pub async fn lsp_resolve_command(
    language: String,
    registry: State<'_, LspRegistry>,
) -> Result<Option<LspResolvedCommand>, String> {
    Ok(registry.resolve_command(&language))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn tempdir(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let mut p = std::env::temp_dir();
        p.push(format!(
            "nexterm-lsp-{label}-{nanos}-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&p).expect("create tempdir");
        p
    }

    #[test]
    fn blank_cwd_resolves_to_none() {
        let env = WorkspaceEnv::Local;
        let reg = WorkspaceRegistry::default();
        assert_eq!(resolve_authorized_cwd(None, &env, &reg).unwrap(), None);
        assert_eq!(
            resolve_authorized_cwd(Some("   "), &env, &reg).unwrap(),
            None
        );
    }

    #[test]
    fn authorized_cwd_is_accepted() {
        let dir = tempdir("ok");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&dir).expect("authorize");
        let raw = dir.to_string_lossy().into_owned();
        let resolved = resolve_authorized_cwd(Some(&raw), &WorkspaceEnv::Local, &reg)
            .expect("authorized")
            .expect("some");
        assert_eq!(Path::new(&resolved), dir.as_path());
    }

    #[test]
    fn unauthorized_cwd_is_rejected_not_silently_allowed() {
        // 安全护栏：给了一个没授权的目录就必须失败，而不是退回到「不检查」。
        let allowed = tempdir("allowed");
        let foreign = tempdir("foreign");
        let reg = WorkspaceRegistry::default();
        reg.authorize(&allowed).expect("authorize");
        let raw = foreign.to_string_lossy().into_owned();
        let err = resolve_authorized_cwd(Some(&raw), &WorkspaceEnv::Local, &reg)
            .expect_err("unauthorized cwd must be rejected");
        assert!(
            err.starts_with(crate::modules::workspace::PATH_NOT_AUTHORIZED_PREFIX),
            "unexpected error: {err}"
        );
    }
}
