use crate::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn lsp_spawn(
    language: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let lsp_mgr = &state.lsp_manager;
    lsp_mgr.spawn_server(app_handle, language, state.project_root.clone())
}

#[tauri::command]
pub async fn lsp_send(
    session_id: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let lsp_mgr = &state.lsp_manager;
    lsp_mgr.send_message(&session_id, message)
}
