use base64::Engine;
use crate::AppState;
use crate::shell_hooks;
use crate::pty::detect_default_shell;

#[tauri::command]
pub async fn pty_create(
    session_id: String,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // Build shell command with hook integration if available
    let shell_cmd = state.shell_hooks_dir.as_ref().map(|hook_dir| {
        let shell_path = detect_default_shell();
        shell_hooks::build_shell_command(&shell_path, hook_dir)
    });

    let mut manager = state.pty_manager.lock().map_err(|e| e.to_string())?;
    manager.create_session(session_id, app_handle, cwd, shell_cmd, cols, rows)
}

#[tauri::command]
pub async fn pty_write(
    session_id: String,
    data: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let engine = base64::engine::general_purpose::STANDARD;
    let decoded = engine
        .decode(&data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    let mut manager = state.pty_manager.lock().map_err(|e| e.to_string())?;
    manager.write(&session_id, &decoded)
}

#[tauri::command]
pub async fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut manager = state.pty_manager.lock().map_err(|e| e.to_string())?;
    manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub async fn pty_kill(
    session_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut manager = state.pty_manager.lock().map_err(|e| e.to_string())?;
    manager.kill(&session_id)
}
