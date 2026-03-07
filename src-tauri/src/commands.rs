use crate::AppState;
use crate::db;
use crate::events;
use serde::de::DeserializeOwned;

fn detect_current_git_branch(project_root: &str) -> String {
    std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(project_root)
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "main".to_string())
}

fn normalize_watched_directories(input: &str) -> String {
    if serde_json::from_str::<Vec<String>>(input).is_ok() {
        return input.to_string();
    }

    let dirs: Vec<String> = input
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect();

    serde_json::to_string(&dirs).unwrap_or_else(|_| "[]".to_string())
}

fn extract_sidecar_error_detail(
    payload: &serde_json::Value,
) -> (String, String) {
    let detail = payload.get("detail");
    let detail_error = detail.and_then(|d| d.get("error"));
    let root_error = payload.get("error");
    let error_obj = detail_error.or(root_error);

    let code = error_obj
        .and_then(|e| e.get("code"))
        .and_then(|v| v.as_str())
        .unwrap_or("SIDECAR_ERROR")
        .to_string();

    let message = error_obj
        .and_then(|e| e.get("message"))
        .and_then(|v| v.as_str())
        .or_else(|| detail.and_then(|d| d.as_str()))
        .or_else(|| payload.get("message").and_then(|v| v.as_str()))
        .unwrap_or("Sidecar request failed")
        .to_string();

    (code, message)
}

async fn parse_sidecar_response<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, String> {
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
            let (code, message) = extract_sidecar_error_detail(&payload);
            return Err(format!(
                "{} (HTTP {}): {}",
                code,
                status.as_u16(),
                message
            ));
        }

        let fallback = if body.trim().is_empty() {
            "empty sidecar error body".to_string()
        } else {
            body
        };
        return Err(format!("SIDECAR_HTTP_{}: {}", status.as_u16(), fallback));
    }

    serde_json::from_str::<T>(&body).map_err(|e| {
        format!("Failed to parse sidecar response JSON: {}", e)
    })
}

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

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct HybridSearchOptions {
    pub mode: Option<String>,
    pub limit: Option<usize>,
    pub source_types: Option<Vec<String>>,
    pub file_path_prefix: Option<String>,
    pub git_branch: Option<String>,
    pub rerank: Option<bool>,
}

#[derive(serde::Serialize)]
pub struct HybridSearchResponse {
    pub results: Vec<SearchResult>,
    pub query: String,
    pub mode: String,
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
    let git_branch = detect_current_git_branch(&state.project_root);

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
    if let Some(ref fp) = file_path_prefix {
        params.push(("file_path_prefix", fp.clone()));
    }
    params.push(("git_branch", git_branch));

    let response = crate::sidecar_client::send_with_policy(|| {
        client.get(url.clone()).query(&params)
    })
    .await?;
    let res: serde_json::Value = parse_sidecar_response(response).await?;

    let results = res["results"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|r| SearchResult {
            text: r["text"].as_str().unwrap_or_default().to_string(),
            source_file: r["source_file"].as_str().unwrap_or_default().to_string(),
            chunk_index: r["chunk_index"].as_i64().unwrap_or(0) as i32,
            chunk_type: r["chunk_type"].as_str().unwrap_or("text").to_string(),
            entity_name: r["entity_name"].as_str().map(|s| s.to_string()),
            language: r["language"].as_str().unwrap_or("text").to_string(),
            source_type: r["source_type"].as_str().unwrap_or("unknown").to_string(),
            relevance_score: r["relevance_score"].as_f64().unwrap_or(0.0),
            created_at: r["created_at"].as_str().unwrap_or_default().to_string(),
        })
        .collect();

    Ok(SearchResponse {
        results,
        query,
    })
}

#[tauri::command]
pub async fn hybrid_search(
    query: String,
    options: Option<HybridSearchOptions>,
    state: tauri::State<'_, AppState>,
) -> Result<HybridSearchResponse, String> {
    let client = reqwest::Client::new();
    let opts = options.unwrap_or(HybridSearchOptions {
        mode: Some("hybrid".to_string()),
        limit: Some(10),
        source_types: None,
        file_path_prefix: None,
        git_branch: None,
        rerank: Some(false),
    });
    let mode = opts.mode.clone().unwrap_or_else(|| "hybrid".to_string());
    let limit = opts.limit.unwrap_or(10);
    let branch = opts
        .git_branch
        .clone()
        .unwrap_or_else(|| detect_current_git_branch(&state.project_root));

    let url = format!("{}/api/v1/rag/query", state.sidecar_url);
    let body = serde_json::json!({
        "query": query,
        "limit": limit,
        "mode": mode,
        "source_types": opts.source_types,
        "file_path_prefix": opts.file_path_prefix,
        "git_branch": branch,
        "rerank": opts.rerank.unwrap_or(false),
    });

    let response = crate::sidecar_client::send_with_policy(|| {
        client.post(url.clone()).json(&body)
    })
    .await?;
    let res: serde_json::Value = parse_sidecar_response(response).await?;

    let results = res["results"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|r| SearchResult {
            text: r["text"].as_str().unwrap_or_default().to_string(),
            source_file: r["source_file"].as_str().unwrap_or_default().to_string(),
            chunk_index: r["chunk_index"].as_i64().unwrap_or(0) as i32,
            chunk_type: r["chunk_type"].as_str().unwrap_or("text").to_string(),
            entity_name: r["entity_name"].as_str().map(|s| s.to_string()),
            language: r["language"].as_str().unwrap_or("text").to_string(),
            source_type: r["source_type"].as_str().unwrap_or("unknown").to_string(),
            relevance_score: r["relevance_score"].as_f64().unwrap_or(0.0),
            created_at: r["created_at"].as_str().unwrap_or_default().to_string(),
        })
        .collect();

    Ok(HybridSearchResponse {
        results,
        query: query.to_string(),
        mode: res["mode"].as_str().unwrap_or("hybrid").to_string(),
    })
}

// ─── Session & Handoff ───────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SessionStatePayload {
    pub summary: String,
    pub blockers: Vec<String>,
    pub next_steps: Vec<String>,
    pub focus: FocusContext,
    pub raw_signals: serde_json::Value,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct FocusContext {
    pub open_files: Vec<String>,
    pub active_terminal_cwd: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SessionCaptureInputV2 {
    pub trigger: String,
    pub open_files: Vec<String>,
    pub active_file: Option<String>,
    pub terminal_cwd: Option<String>,
    pub include_recent_terminal: Option<bool>,
}

#[tauri::command]
pub async fn session_capture(
    trigger: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let input = SessionCaptureInputV2 {
        trigger,
        open_files: vec![],
        active_file: None,
        terminal_cwd: None,
        include_recent_terminal: Some(false),
    };
    session_capture_v2(input, state).await
}

#[tauri::command]
pub async fn session_capture_v2(
    input: SessionCaptureInputV2,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    // 1. Gather raw signals (Drop lock before await)
    let (raw_signals, profile_id, git_branch) = {
        let db_conn = state.db.lock().map_err(|e| e.to_string())?;
        let profile_id = db::get_active_profile_id(&db_conn)
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "default".to_string());

        let recent_notes = db::list_notes(&db_conn, &profile_id)
            .map_err(|e| e.to_string())?
            .into_iter().take(5).collect::<Vec<_>>();

        let recent_tasks = db::list_tasks(&db_conn, &profile_id, None)
            .map_err(|e| e.to_string())?
            .into_iter().take(10).collect::<Vec<_>>();

        let _include_recent_terminal = input.include_recent_terminal.unwrap_or(false);
        let recent_terminal: Vec<serde_json::Value> = vec![];

        let git_branch = detect_current_git_branch(&state.project_root);

        let signals = serde_json::json!({
            "recent_notes": recent_notes,
            "recent_tasks": recent_tasks,
            "recent_terminal": recent_terminal,
            "active_file": input.active_file.clone(),
            "open_files": input.open_files.clone(),
            "git_branch": git_branch,
            "project_root": state.project_root,
        });
        (signals, profile_id, git_branch)
    };

    // 2. Synthesize via sidecar
    let synthesis_url = format!("{}/api/v1/session/synthesis", state.sidecar_url);
    let synthesis_body = serde_json::json!({ "raw_signals": raw_signals });
    let synthesis_started_at = std::time::Instant::now();
    let synthesis_response = crate::sidecar_client::send_with_policy(|| {
        client
            .post(synthesis_url.clone())
            .json(&synthesis_body)
    })
    .await
    .map_err(|e| format!("Synthesis failed: {}", e))?;
    let synthesis: serde_json::Value = parse_sidecar_response(synthesis_response)
        .await
        .map_err(|e| format!("Synthesis failed: {}", e))?;

    {
        let db_conn = state.db.lock().map_err(|e| e.to_string())?;
        let _ = db::insert_llm_run(
            &db_conn,
            Some(&profile_id),
            Some("ollama"),
            "ollama/llama3",
            "session_synthesis",
            "success",
            Some(synthesis_started_at.elapsed().as_millis() as i64),
            None,
            None,
            None,
            None,
            None,
        );
    }

    let payload = SessionStatePayload {
        summary: synthesis["summary"].as_str().unwrap_or("No summary").to_string(),
        blockers: synthesis["blockers"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default(),
        next_steps: synthesis["next_steps"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default(),
        focus: FocusContext {
            open_files: input.open_files.clone(),
            active_terminal_cwd: input
                .terminal_cwd
                .clone()
                .unwrap_or_else(|| state.project_root.clone()),
        },
        raw_signals: serde_json::json!({
            "signals": raw_signals,
            "provenance": synthesis["provenance"],
            "confidence": synthesis["confidence"],
            "source": synthesis["source"],
            "git_branch": git_branch,
        }),
    };

    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    // 3. Store in DB
    let id = {
        let db_conn = state.db.lock().map_err(|e| e.to_string())?;
        db::create_session_state(&db_conn, &profile_id, &payload_json, &input.trigger, None)
            .map_err(|e| e.to_string())?
    };

    Ok(id)
}

#[tauri::command]
pub fn get_latest_session(state: tauri::State<'_, AppState>) -> Result<Option<db::SessionStateRow>, String> {
    let db_conn = state.db.lock().map_err(|e| e.to_string())?;
    let profile_id = db::get_active_profile_id(&db_conn)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "default".to_string());
    
    db::get_latest_session_state(&db_conn, &profile_id).map_err(|e| e.to_string())
}

// ─── Chat ────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ChatMessageInput {
    pub role: String,
    pub content: String,
}

#[tauri::command]
pub async fn chat_send(
    messages: Vec<ChatMessageInput>,
    model: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/chat", state.sidecar_url);
    let effective_model = model.clone().unwrap_or_else(|| "ollama/llama3".to_string());
    let started_at = std::time::Instant::now();
    
    // 1. Save user message to DB (Drop lock before await)
    let profile_id = {
        let db_conn = state.db.lock().map_err(|e| e.to_string())?;
        let profile_id = db::get_active_profile_id(&db_conn)
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "default".to_string());

        if let Some(last_msg) = messages.last() {
            if last_msg.role == "user" {
                let _ = db::create_chat_message(&db_conn, &profile_id, None, "user", &last_msg.content, model.as_deref());
            }
        }
        profile_id
    };

    // 2. Call sidecar
    let body = serde_json::json!({
        "messages": messages,
        "model": effective_model,
        "stream": false,
        "context_strategy": "session"
    });
    let response = crate::sidecar_client::send_with_policy(|| {
        client.post(url.clone()).json(&body)
    })
    .await?;
    let res: serde_json::Value = parse_sidecar_response(response).await?;

    // 3. Save assistant response to DB
    if let Some(content) = res["choices"][0]["message"]["content"].as_str() {
        let db_conn = state.db.lock().map_err(|e| e.to_string())?;
        let _ = db::create_chat_message(&db_conn, &profile_id, None, "assistant", content, None);
        let provider = model
            .as_deref()
            .and_then(|m| m.split('/').next())
            .unwrap_or("ollama");
        let usage = &res["usage"];
        let _ = db::insert_llm_run(
            &db_conn,
            Some(&profile_id),
            Some(provider),
            &effective_model,
            "chat",
            "success",
            Some(started_at.elapsed().as_millis() as i64),
            usage["prompt_tokens"].as_i64(),
            usage["completion_tokens"].as_i64(),
            None,
            None,
            None,
        );
    }

    Ok(res)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ChatSendStreamRequest {
    pub messages: Vec<ChatMessageInput>,
    pub model: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ChatStreamChunk {
    pub delta: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ChatSendStreamResponse {
    pub chunks: Vec<ChatStreamChunk>,
    pub done: bool,
}

#[tauri::command]
pub async fn chat_send_stream(
    request: ChatSendStreamRequest,
    state: tauri::State<'_, AppState>,
) -> Result<ChatSendStreamResponse, String> {
    // Compatibility implementation: emit chunked text from a standard completion.
    let res = chat_send(request.messages, request.model, state).await?;
    let content = res["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default();

    let chunks = content
        .split_whitespace()
        .map(|t| ChatStreamChunk {
            delta: format!("{} ", t),
        })
        .collect();

    Ok(ChatSendStreamResponse { chunks, done: true })
}

// ─── Workspace Profiles ──────────────────────────────────────────────

#[tauri::command]
pub fn profile_list(state: tauri::State<'_, AppState>) -> Result<Vec<db::WorkspaceProfileRow>, String> {
    let db_conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_workspace_profiles(&db_conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_create(
    name: String,
    watched_directories: String,
    default_model: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<db::WorkspaceProfileRow, String> {
    let db_conn = state.db.lock().map_err(|e| e.to_string())?;
    let normalized = normalize_watched_directories(&watched_directories);
    db::create_workspace_profile(&db_conn, &name, &normalized, default_model.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_activate(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let db_conn = state.db.lock().map_err(|e| e.to_string())?;
    db::activate_workspace_profile(&db_conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_update(
    id: String,
    name: String,
    watched_directories: String,
    default_model: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let db_conn = state.db.lock().map_err(|e| e.to_string())?;
    let normalized = normalize_watched_directories(&watched_directories);
    db::update_workspace_profile(&db_conn, &id, &name, &normalized, default_model.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn profile_delete(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let db_conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_workspace_profile(&db_conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn model_set_profile_default(
    profile_id: String,
    model_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let db_conn = state.db.lock().map_err(|e| e.to_string())?;
    let affected = db_conn
        .execute(
            "UPDATE workspace_profiles
             SET default_model = ?1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?2",
            rusqlite::params![model_id, profile_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(affected > 0)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ModelListResponse {
    pub default_model: String,
    pub models: Vec<serde_json::Value>,
}

#[tauri::command]
pub async fn model_list(
    state: tauri::State<'_, AppState>,
) -> Result<ModelListResponse, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/models", state.sidecar_url);
    let response = crate::sidecar_client::send_with_policy(|| {
        client.get(url.clone())
    })
    .await?;
    let body: serde_json::Value = parse_sidecar_response(response).await?;

    Ok(ModelListResponse {
        default_model: body["default_model"].as_str().unwrap_or("ollama/llama3").to_string(),
        models: body["models"].as_array().cloned().unwrap_or_default(),
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

    // 1. Keyword search via FTS5 (parallelizable if we had multiple connections, but scoped for now)
    let fts_results = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let profile_id = db::get_active_profile_id(&db)
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "default".to_string());
        
        // Try FTS search first
        db::search_entities_fts(&db, &query, None, &profile_id, limit)
            .unwrap_or_default()
    };

    // 2. Vector search via sidecar
    let client = reqwest::Client::new();
    let url = format!("{}/search", sidecar_url);
    let branch = detect_current_git_branch(&state.project_root);
    let query_params = vec![
        ("query", query.as_str().to_string()),
        ("limit", limit.to_string()),
        ("git_branch", branch),
    ];
    let code_results: Vec<serde_json::Value> = match crate::sidecar_client::send_with_policy(|| {
        client.get(url.clone()).query(&query_params)
    }).await {
        Ok(resp) => {
            let body: serde_json::Value = match parse_sidecar_response(resp).await {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("Universal search vector query parse failed: {}", e);
                    serde_json::json!({})
                }
            };
            body.get("results")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
        }
        Err(e) => {
            log::warn!("Universal search vector query failed: {}", e);
            vec![]
        }
    };

    let mut merged: Vec<UniversalSearchResult> = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    // Map code results (Vector)
    let code_count = code_results.len();
    for r in &code_results {
        let source_file = r.get("source_file").and_then(|v| v.as_str()).unwrap_or("");
        let chunk_type = r.get("chunk_type").and_then(|v| v.as_str()).unwrap_or("code");
        let result_type = if chunk_type == "function" || chunk_type == "class" || chunk_type == "struct" {
            chunk_type.to_string()
        } else {
            "code".to_string()
        };
        let id = source_file.to_string();
        seen_ids.insert(id.clone());

        merged.push(UniversalSearchResult {
            id,
            result_type,
            title: r.get("entity_name")
                .and_then(|v| v.as_str())
                .or_else(|| r.get("source_file").and_then(|v| v.as_str()))
                .unwrap_or("unknown")
                .to_string(),
            snippet: r.get("text").and_then(|v| v.as_str()).map(|s| {
                if s.len() > 200 { format!("{}...", &s[..200]) } else { s.to_string() }
            }),
            source_file: Some(source_file.to_string()),
            relevance_score: r.get("relevance_score").and_then(|v| v.as_f64()).unwrap_or(0.0),
            metadata: None,
        });
    }

    // Map entity results (FTS5)
    let entity_count = fts_results.len();
    for entity in &fts_results {
        if seen_ids.contains(&entity.id) { continue; }
        
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

// ─── Intelligent Terminal ───────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct TerminalTranslateResponse {
    pub command: String,
    pub explanation: String,
    pub confidence: f64,
}

#[tauri::command]
pub async fn terminal_translate(
    query: String,
    state: tauri::State<'_, AppState>,
) -> Result<TerminalTranslateResponse, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/terminal/translate", state.sidecar_url);

    let body = serde_json::json!({
        "query": query,
        "context": {
            "project_root": state.project_root,
        }
    });
    let response = crate::sidecar_client::send_with_policy(|| {
        client.post(url.clone()).json(&body)
    })
    .await?;
    let res: TerminalTranslateResponse = parse_sidecar_response(response).await?;

    Ok(res)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct TerminalResolveResponse {
    pub analysis: String,
    pub suggestion: String,
    pub explanation: String,
}

#[tauri::command]
pub async fn terminal_resolve(
    command: String,
    exit_code: i32,
    output: String,
    state: tauri::State<'_, AppState>,
) -> Result<TerminalResolveResponse, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/terminal/resolve", state.sidecar_url);

    let body = serde_json::json!({
        "command": command,
        "exit_code": exit_code,
        "output": output,
    });
    let response = crate::sidecar_client::send_with_policy(|| {
        client.post(url.clone()).json(&body)
    })
    .await?;
    let res: TerminalResolveResponse = parse_sidecar_response(response).await?;

    Ok(res)
}

#[tauri::command]
pub fn terminal_command_persist(
    command: String,
    cwd: Option<String>,
    exit_code: Option<i32>,
    duration_ms: Option<u64>,
    output: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let db_conn = state.db.lock().map_err(|e| e.to_string())?;
    let profile_id = db::get_active_profile_id(&db_conn)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "default".to_string());

    db::insert_terminal_command(
        &db_conn,
        &profile_id,
        &command,
        cwd.as_deref(),
        exit_code,
        duration_ms,
        output.as_deref(),
    ).map_err(|e| e.to_string())
}

// ─── Remote Access Management ─────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct RemoteAccessStatus {
    pub enabled: bool,
    pub port: u16,
    pub paired_device_count: usize,
}

#[tauri::command]
pub fn get_remote_access_status(
    state: tauri::State<'_, AppState>,
) -> Result<RemoteAccessStatus, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let enabled = db::get_app_config(&conn, "remote_access_enabled")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(false);

    let port: u16 = db::get_app_config(&conn, "remote_api_port")
        .map_err(|e| e.to_string())?
        .and_then(|v| v.parse().ok())
        .unwrap_or(9401);

    let devices = db::list_paired_devices(&conn)
        .map_err(|e| e.to_string())?;

    Ok(RemoteAccessStatus {
        enabled,
        port,
        paired_device_count: devices.len(),
    })
}

#[tauri::command]
pub fn set_remote_access_enabled(
    enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_app_config(&conn, "remote_access_enabled", if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    let details = serde_json::json!({ "enabled": enabled }).to_string();
    let _ = db::insert_app_audit_log(
        &conn,
        "remote_access.enabled_changed",
        Some("local_user"),
        None,
        Some(&details),
    );
    Ok(())
}

#[tauri::command]
pub fn set_remote_access_port(
    port: u16,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if port < 1024 {
        return Err("Port must be >= 1024".to_string());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_app_config(&conn, "remote_api_port", &port.to_string())
        .map_err(|e| e.to_string())?;
    let details = serde_json::json!({ "port": port }).to_string();
    let _ = db::insert_app_audit_log(
        &conn,
        "remote_access.port_changed",
        Some("local_user"),
        None,
        Some(&details),
    );
    Ok(())
}

#[derive(serde::Serialize)]
pub struct PairedDevice {
    pub id: String,
    pub device_name: String,
    pub platform: Option<String>,
    pub last_seen_at: Option<String>,
    pub paired_at: String,
}

#[tauri::command]
pub fn list_paired_devices(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PairedDevice>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let devices = db::list_paired_devices(&conn)
        .map_err(|e| e.to_string())?;

    Ok(devices
        .into_iter()
        .map(|d| PairedDevice {
            id: d.id,
            device_name: d.device_name,
            platform: d.platform,
            last_seen_at: d.last_seen_at,
            paired_at: d.paired_at,
        })
        .collect())
}

#[tauri::command]
pub fn revoke_paired_device(
    device_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::revoke_paired_device(&conn, &device_id)
        .map_err(|e| e.to_string())?;
    let details = serde_json::json!({ "device_id": device_id }).to_string();
    let _ = db::insert_app_audit_log(
        &conn,
        "remote_access.device_revoked",
        Some("local_user"),
        None,
        Some(&details),
    );
    Ok(())
}

#[tauri::command]
pub fn device_delete(
    device_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let deleted = db::delete_paired_device(&conn, &device_id).map_err(|e| e.to_string())?;
    if deleted {
        let details = serde_json::json!({ "device_id": device_id }).to_string();
        let _ = db::insert_app_audit_log(
            &conn,
            "remote_access.device_deleted",
            Some("local_user"),
            None,
            Some(&details),
        );
    }
    Ok(deleted)
}

#[tauri::command]
pub fn session_history_list(
    limit: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::SessionStateRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "default".to_string());
    db::list_session_history(&conn, &profile_id, limit.unwrap_or(20)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_history_list(
    limit: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::ChatMessageRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "default".to_string());
    db::list_chat_history(&conn, &profile_id, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

// ─── Editor Layout Persistence ───────────────────────────────────────

#[tauri::command]
pub fn save_editor_layout(
    layout_json: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "default".to_string());
    db::save_editor_layout(&conn, &profile_id, &layout_json)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_editor_layout(
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "default".to_string());
    db::get_editor_layout(&conn, &profile_id)
        .map_err(|e| e.to_string())
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
