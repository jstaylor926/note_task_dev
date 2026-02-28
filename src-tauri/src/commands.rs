use crate::AppState;
use crate::db;
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

// ─── Universal Search ────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct UniversalSearchResult {
    pub id: String,
    pub result_type: String,
    pub title: String,
    pub snippet: Option<String>,
    pub source_file: Option<String>,
    pub relevance_score: f64,
    pub metadata: Option<serde_json::Value>,
}

#[derive(serde::Serialize)]
pub struct UniversalSearchResponse {
    pub results: Vec<UniversalSearchResult>,
    pub query: String,
    pub code_count: usize,
    pub entity_count: usize,
}

/// Compute a relevance score for an entity based on query match quality and recency.
pub fn compute_entity_score(title: &str, content: Option<&str>, query: &str, updated_at: &str) -> f64 {
    let title_lower = title.to_lowercase();
    let query_lower = query.to_lowercase();

    let mut score: f64 = if title_lower == query_lower {
        0.95
    } else if title_lower.contains(&query_lower) {
        0.80
    } else if content.map(|c| c.to_lowercase().contains(&query_lower)).unwrap_or(false) {
        0.60
    } else {
        0.50
    };

    // Recency boost
    if let Ok(updated) = chrono_parse_rough(updated_at) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let diff_secs = now.saturating_sub(updated);
        if diff_secs < 86400 {
            score += 0.05; // last 24h
        } else if diff_secs < 604800 {
            score += 0.02; // last 7 days
        }
    }

    score.min(1.0)
}

/// Rough parse of an ISO 8601 / SQLite timestamp into epoch seconds.
fn chrono_parse_rough(ts: &str) -> Result<u64, ()> {
    // Expect "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS"
    let ts = ts.replace('T', " ");
    let parts: Vec<&str> = ts.split(' ').collect();
    if parts.is_empty() { return Err(()); }
    let date_parts: Vec<u64> = parts[0].split('-').filter_map(|p| p.parse().ok()).collect();
    if date_parts.len() < 3 { return Err(()); }
    let (y, m, d) = (date_parts[0], date_parts[1], date_parts[2]);
    // Rough epoch calculation (not precise, but good enough for recency comparison)
    let days = (y - 1970) * 365 + (m - 1) * 30 + d;
    let mut secs = days * 86400;
    if parts.len() > 1 {
        let time_parts: Vec<u64> = parts[1].split(':').filter_map(|p| p.parse().ok()).collect();
        if time_parts.len() >= 2 {
            secs += time_parts[0] * 3600 + time_parts[1] * 60;
            if time_parts.len() >= 3 { secs += time_parts[2]; }
        }
    }
    Ok(secs)
}

#[tauri::command]
pub async fn universal_search(
    query: String,
    limit: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<UniversalSearchResponse, String> {
    let limit = limit.unwrap_or(20);
    let sidecar_url = state.sidecar_url.clone();

    // Entity search (scoped lock, dropped before any .await)
    let entity_results = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let profile_id = db::get_active_profile_id(&db)
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "default".to_string());
        db::search_entities(&db, &query, None, &profile_id, limit)
            .map_err(|e| e.to_string())?
    };

    // Vector search via sidecar
    let client = reqwest::Client::new();
    let url = format!("{}/search", sidecar_url);
    let code_results: Vec<serde_json::Value> = match client
        .get(&url)
        .query(&[("query", query.as_str()), ("limit", &limit.to_string())])
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(resp) => {
            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            body.get("results")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
        }
        Err(_) => vec![],
    };

    // Map code results to UniversalSearchResult
    let code_count = code_results.len();
    let mut merged: Vec<UniversalSearchResult> = code_results
        .iter()
        .map(|r| {
            let chunk_type = r.get("chunk_type").and_then(|v| v.as_str()).unwrap_or("code");
            let result_type = if chunk_type == "function" || chunk_type == "class" || chunk_type == "struct" {
                chunk_type.to_string()
            } else {
                "code".to_string()
            };
            UniversalSearchResult {
                id: r.get("source_file").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                result_type,
                title: r.get("entity_name")
                    .and_then(|v| v.as_str())
                    .or_else(|| r.get("source_file").and_then(|v| v.as_str()))
                    .unwrap_or("unknown")
                    .to_string(),
                snippet: r.get("text").and_then(|v| v.as_str()).map(|s| {
                    if s.len() > 200 { format!("{}...", &s[..200]) } else { s.to_string() }
                }),
                source_file: r.get("source_file").and_then(|v| v.as_str()).map(|s| s.to_string()),
                relevance_score: r.get("relevance_score").and_then(|v| v.as_f64()).unwrap_or(0.0),
                metadata: None,
            }
        })
        .collect();

    // Map entity results to UniversalSearchResult with computed scores
    let entity_count = entity_results.len();
    for entity in &entity_results {
        let score = compute_entity_score(
            &entity.title,
            entity.content.as_deref(),
            &query,
            &entity.updated_at,
        );
        merged.push(UniversalSearchResult {
            id: entity.id.clone(),
            result_type: entity.entity_type.clone(),
            title: entity.title.clone(),
            snippet: entity.content.as_ref().map(|c| {
                if c.len() > 200 { format!("{}...", &c[..200]) } else { c.clone() }
            }),
            source_file: entity.source_file.clone(),
            relevance_score: score,
            metadata: None,
        });
    }

    // Sort by relevance desc
    merged.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap_or(std::cmp::Ordering::Equal));
    merged.truncate(limit);

    Ok(UniversalSearchResponse {
        results: merged,
        query,
        code_count,
        entity_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_entity_score_exact_title_match() {
        let score = compute_entity_score("SearchPanel", None, "SearchPanel", "2020-01-01 00:00:00");
        assert!((score - 0.95).abs() < 0.001, "Exact match score should be 0.95, got {}", score);
    }

    #[test]
    fn test_compute_entity_score_title_contains() {
        let score = compute_entity_score("My SearchPanel Component", None, "SearchPanel", "2020-01-01 00:00:00");
        assert!((score - 0.80).abs() < 0.001, "Contains match should be 0.80, got {}", score);
    }

    #[test]
    fn test_compute_entity_score_content_only() {
        let score = compute_entity_score("Unrelated Title", Some("mentions SearchPanel here"), "SearchPanel", "2020-01-01 00:00:00");
        assert!((score - 0.60).abs() < 0.001, "Content-only match should be 0.60, got {}", score);
    }
}
