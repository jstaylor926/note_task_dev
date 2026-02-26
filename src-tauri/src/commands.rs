use crate::AppState;

#[derive(serde::Serialize)]
pub struct HealthStatus {
    pub tauri: String,
    pub sidecar: String,
    pub sqlite: String,
    pub lancedb: String,
}

#[tauri::command]
pub async fn health_check(state: tauri::State<'_, AppState>) -> Result<HealthStatus, String> {
    // 1. Tauri is always ok if we reach this code
    let tauri_status = "ok".to_string();

    // 2. Check SQLite
    let sqlite_status = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        match db.execute_batch("SELECT 1") {
            Ok(_) => "ok".to_string(),
            Err(e) => format!("error: {}", e),
        }
    };

    // 3. Check sidecar + LanceDB via sidecar health endpoint
    let (sidecar_status, lancedb_status) =
        match crate::sidecar::check_sidecar_health(&state.sidecar_url).await {
            Ok(body) => {
                let sc = body
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let ldb = body
                    .get("lancedb")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                (sc, ldb)
            }
            Err(e) => (format!("unreachable: {}", e), "unknown".to_string()),
        };

    Ok(HealthStatus {
        tauri: tauri_status,
        sidecar: sidecar_status,
        sqlite: sqlite_status,
        lancedb: lancedb_status,
    })
}

#[tauri::command]
pub fn get_app_status(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let manager = state.sidecar_manager.lock().map_err(|e| e.to_string())?;
    Ok(format!("{:?}", manager.status))
}
