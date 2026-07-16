use tauri::{AppHandle, State};

use super::{LspMessage, LspRegistry, LspResolvedCommand, LspServerSpec, LspSessionInfo, SessionId};

#[tauri::command]
pub async fn lsp_start(
    spec: LspServerSpec,
    channel: tauri::ipc::Channel<LspMessage>,
    registry: State<'_, LspRegistry>,
    _app: AppHandle,
) -> Result<SessionId, String> {
    registry.spawn(spec, channel).map_err(String::from)
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
pub async fn lsp_stop(
    id: SessionId,
    registry: State<'_, LspRegistry>,
) -> Result<(), String> {
    registry.kill(id).map_err(String::from)
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
