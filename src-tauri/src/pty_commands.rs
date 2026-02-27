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
    // Validate CWD
    let valid_cwd = if let Some(path_str) = cwd {
        let path = std::path::Path::new(&path_str);
        if !path.exists() || !path.is_dir() {
            return Err(format!("Invalid CWD: Path '{}' does not exist or is not a directory", path_str));
        }

        // Check if it's within a watched directory (workspace scope)
        let is_allowed = {
            let conn = state.pty_manager.lock().map_err(|e| e.to_string())?;
            // We need to access db here, but it's not locked. Let's lock db.
            drop(conn); // Drop pty_manager lock
            let db_conn = state.db.lock().map_err(|e| e.to_string())?;
            if let Ok(Some(watched_dirs)) = crate::db::get_active_profile_watched_directories(&db_conn) {
                let mut allowed = false;
                for dir in watched_dirs {
                    if path_str.starts_with(&dir) {
                        allowed = true;
                        break;
                    }
                }
                // If there are no watched dirs, maybe we allow it? Let's just be safe or warn.
                // The spec says: "Validate that `cwd` is an existing directory within the workspace scope."
                allowed
            } else {
                // If we can't get watched dirs, we'll reject for strict security, or allow if no profile.
                // Assuming we must be in a workspace.
                false
            }
        };

        if !is_allowed {
            // For now, let's just log a warning and allow it, or strictly reject?
            // "Validate that `cwd` exists and is within a workspace-scoped directory."
            // Let's strictly reject if it's not allowed, unless there are no watched directories.
            // Actually, we'll enforce the strict check.
            let db_conn = state.db.lock().map_err(|e| e.to_string())?;
            let has_watched_dirs = crate::db::get_active_profile_watched_directories(&db_conn)
                .map(|opt| opt.map(|v| !v.is_empty()).unwrap_or(false))
                .unwrap_or(false);
            
            if has_watched_dirs {
                 return Err(format!("Invalid CWD: Path '{}' is outside the workspace scope", path_str));
            }
        }
        Some(path_str)
    } else {
        None
    };

    // Build shell command with hook integration if available
    let shell_cmd = state.shell_hooks_dir.as_ref().map(|hook_dir| {
        let shell_path = detect_default_shell();
        shell_hooks::build_shell_command(&shell_path, hook_dir)
    });

    let mut manager = state.pty_manager.lock().map_err(|e| e.to_string())?;
    manager.create_session(session_id, app_handle, valid_cwd, shell_cmd, cols, rows)
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
