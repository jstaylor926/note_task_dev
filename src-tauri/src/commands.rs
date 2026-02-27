use crate::AppState;
use crate::events;

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

#[derive(serde::Serialize)]
pub struct SearchResult {
    pub text: String,
    pub source_file: String,
    pub chunk_index: i32,
    pub chunk_type: String,
    pub entity_name: Option<String>,
    pub language: String,
    pub source_type: String,
    pub relevance_score: f64,
    pub created_at: String,
}

#[derive(serde::Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub query: String,
}

#[tauri::command]
pub async fn semantic_search(
    query: String,
    limit: Option<usize>,
    language: Option<String>,
    source_type: Option<String>,
    chunk_type: Option<String>,
    file_path_prefix: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<SearchResponse, String> {
    let client = reqwest::Client::new();
    let limit = limit.unwrap_or(10);
    let url = format!("{}/search", state.sidecar_url);

    let mut params: Vec<(&str, String)> = vec![
        ("query", query.clone()),
        ("limit", limit.to_string()),
    ];
    if let Some(ref lang) = language {
        params.push(("language", lang.clone()));
    }
    if let Some(ref st) = source_type {
        params.push(("source_type", st.clone()));
    }
    if let Some(ref ct) = chunk_type {
        params.push(("chunk_type", ct.clone()));
    }
    if let Some(ref fpp) = file_path_prefix {
        params.push(("file_path_prefix", fpp.clone()));
    }

    let resp = client
        .get(&url)
        .query(&params)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse search response: {}", e))?;

    let empty = vec![];
    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty)
        .iter()
        .map(|r| SearchResult {
            text: r.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            source_file: r.get("source_file").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
            chunk_index: r.get("chunk_index").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            chunk_type: r.get("chunk_type").and_then(|v| v.as_str()).unwrap_or("text").to_string(),
            entity_name: r.get("entity_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
            language: r.get("language").and_then(|v| v.as_str()).unwrap_or("text").to_string(),
            source_type: r.get("source_type").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
            relevance_score: r.get("relevance_score").and_then(|v| v.as_f64()).unwrap_or(0.0),
            created_at: r.get("created_at").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        })
        .collect();

    Ok(SearchResponse {
        results,
        query,
    })
}

#[tauri::command]
pub fn get_indexing_status(
    state: tauri::State<'_, AppState>,
) -> Result<events::IndexingProgressPayload, String> {
    let indexing = state.indexing.lock().map_err(|e| e.to_string())?;
    Ok(events::IndexingProgressPayload {
        completed: indexing.completed,
        total: indexing.total_queued,
        current_file: indexing.current_file.clone(),
        is_idle: indexing.is_idle(),
    })
}
