//! Remote API server for the Cortex Mobile Companion.
//!
//! Embeds an axum HTTP server inside the Tauri process that exposes
//! existing Tauri commands over the network. Mobile clients authenticate
//! via PIN pairing and use Bearer tokens for all subsequent requests.
//!
//! Default bind: 0.0.0.0:9401 (only when enabled via settings).

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    middleware,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;

use crate::db;
use crate::remote_auth::{
    self, ErrorResponse, PairRequest, PairResponse, PairingChallenge, RemoteAppState,
    VerifyPinRequest, VerifyPinResponse,
};

/// Start the remote API server on the given port.
/// This is spawned as a tokio task from main.rs.
pub async fn start_server(state: RemoteAppState, port: u16) -> anyhow::Result<()> {
    let app = build_router(state);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    log::info!("Remote API server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

pub fn build_router(state: RemoteAppState) -> Router {
    let api = Router::new()
        // Health (no auth required)
        .route("/health", get(health_handler))
        // Pairing (no auth required)
        .route("/pair", post(pair_handler))
        .route("/pair/verify", post(verify_pin_handler))
        // Notes
        .route("/notes", get(list_notes).post(create_note))
        .route("/notes/{id}", get(get_note).put(update_note).delete(delete_note))
        // Tasks
        .route("/tasks", get(list_tasks).post(create_task))
        .route("/tasks/{id}", get(get_task).put(update_task).delete(delete_task))
        // Files
        .route("/files/list", post(list_directory))
        .route("/files/read", post(read_file))
        .route("/files/stat", post(file_stat))
        .route("/files/tree", get(file_tree))
        // Terminal
        .route("/terminal/sessions", get(list_terminals).post(create_terminal))
        .route("/terminal/sessions/{id}", delete(kill_terminal))
        .route("/terminal/sessions/{id}/resize", post(resize_terminal))
        // Devices management
        .route("/devices", get(list_devices))
        .route("/devices/{id}", delete(revoke_device));

    Router::new()
        .nest("/api/v1", api)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            remote_auth::auth_middleware,
        ))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

// ─── Health ──────────────────────────────────────────────────────────

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    tauri: bool,
    sqlite: bool,
    sidecar: bool,
    version: String,
}

async fn health_handler(
    State(state): State<RemoteAppState>,
) -> Json<HealthResponse> {
    let sqlite_ok = {
        let conn = state.db.lock().unwrap();
        conn.execute_batch("SELECT 1").is_ok()
    };

    // Quick sidecar check
    let sidecar_ok = reqwest::Client::new()
        .get(format!("{}/health", state.sidecar_url))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .is_ok();

    Json(HealthResponse {
        status: "ok".to_string(),
        tauri: true,
        sqlite: sqlite_ok,
        sidecar: sidecar_ok,
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

// ─── Pairing ─────────────────────────────────────────────────────────

async fn pair_handler(
    State(state): State<RemoteAppState>,
    Json(body): Json<PairRequest>,
) -> Result<Json<PairResponse>, (StatusCode, Json<ErrorResponse>)> {
    if state.pairing.is_locked_out() {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(ErrorResponse::new("LOCKED_OUT", "Too many failed attempts. Try again later.")),
        ));
    }

    let pin = state.pairing.generate_pin();
    let challenge_id = uuid::Uuid::new_v4().to_string();

    log::info!("=== PAIRING PIN: {} === (device: {})", pin, body.device_name);

    let challenge = PairingChallenge {
        challenge_id: challenge_id.clone(),
        pin,
        device_id: body.device_id,
        device_name: body.device_name,
        platform: body.platform,
        created_at: std::time::Instant::now(),
    };

    {
        let mut active = state.pairing.active_challenge.lock().unwrap();
        *active = Some(challenge);
    }

    Ok(Json(PairResponse { challenge_id }))
}

async fn verify_pin_handler(
    State(state): State<RemoteAppState>,
    Json(body): Json<VerifyPinRequest>,
) -> Result<Json<VerifyPinResponse>, (StatusCode, Json<ErrorResponse>)> {
    if state.pairing.is_locked_out() {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(ErrorResponse::new("LOCKED_OUT", "Too many failed attempts. Try again later.")),
        ));
    }

    let challenge = {
        let active = state.pairing.active_challenge.lock().unwrap();
        active.clone()
    };

    let challenge = match challenge {
        Some(c) => c,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new("NO_CHALLENGE", "No active pairing challenge. Call /pair first.")),
            ));
        }
    };

    // Check expiry (5 minutes)
    if challenge.created_at.elapsed() > std::time::Duration::from_secs(300) {
        let mut active = state.pairing.active_challenge.lock().unwrap();
        *active = None;
        return Err((
            StatusCode::GONE,
            Json(ErrorResponse::new("EXPIRED", "Pairing PIN has expired. Generate a new one.")),
        ));
    }

    // Check challenge_id and device_id match
    if challenge.challenge_id != body.challenge_id || challenge.device_id != body.device_id {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("MISMATCH", "Challenge ID or device ID does not match.")),
        ));
    }

    // Check PIN
    if challenge.pin != body.pin {
        let locked = state.pairing.record_failure();
        let msg = if locked {
            "Incorrect PIN. Too many attempts — pairing locked for 5 minutes."
        } else {
            "Incorrect PIN."
        };
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse::new("WRONG_PIN", msg)),
        ));
    }

    // PIN correct — generate token and store device
    let token = remote_auth::generate_token();
    let token_hash = remote_auth::hash_token(&token);

    {
        let conn = state.db.lock().unwrap();
        db::insert_paired_device(
            &conn,
            &challenge.device_id,
            &challenge.device_name,
            &token_hash,
            challenge.platform.as_deref(),
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new("DB_ERROR", &e.to_string())),
            )
        })?;
    }

    // Clear challenge and reset failures
    {
        let mut active = state.pairing.active_challenge.lock().unwrap();
        *active = None;
    }
    state.pairing.reset_failures();

    log::info!("Device '{}' paired successfully", challenge.device_name);

    Ok(Json(VerifyPinResponse {
        token,
        message: "Device paired successfully.".to_string(),
    }))
}

// ─── Notes ───────────────────────────────────────────────────────────

async fn list_notes(
    State(state): State<RemoteAppState>,
) -> Result<Json<Vec<db::NoteRow>>, (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| internal_error(&e.to_string()))?
        .unwrap_or_else(|| "default".to_string());
    let notes = db::list_notes(&conn, &profile_id)
        .map_err(|e| internal_error(&e.to_string()))?;
    Ok(Json(notes))
}

#[derive(Deserialize)]
struct CreateNoteBody {
    title: String,
    content: String,
}

async fn create_note(
    State(state): State<RemoteAppState>,
    Json(body): Json<CreateNoteBody>,
) -> Result<(StatusCode, Json<db::NoteRow>), (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| internal_error(&e.to_string()))?
        .unwrap_or_else(|| "default".to_string());
    let note = db::create_note(&conn, &body.title, &body.content, &profile_id)
        .map_err(|e| internal_error(&e.to_string()))?;
    Ok((StatusCode::CREATED, Json(note)))
}

async fn get_note(
    State(state): State<RemoteAppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<db::NoteRow>, (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    let note = db::get_note(&conn, &id)
        .map_err(|e| internal_error(&e.to_string()))?
        .ok_or_else(|| not_found("Note"))?;
    Ok(Json(note))
}

#[derive(Deserialize)]
struct UpdateNoteBody {
    title: String,
    content: String,
}

async fn update_note(
    State(state): State<RemoteAppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<UpdateNoteBody>,
) -> Result<Json<bool>, (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    let result = db::update_note(&conn, &id, &body.title, &body.content)
        .map_err(|e| internal_error(&e.to_string()))?;
    Ok(Json(result))
}

async fn delete_note(
    State(state): State<RemoteAppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    let result = db::delete_note(&conn, &id)
        .map_err(|e| internal_error(&e.to_string()))?;
    Ok(Json(result))
}

// ─── Tasks ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TaskQuery {
    status: Option<String>,
}

async fn list_tasks(
    State(state): State<RemoteAppState>,
    Query(query): Query<TaskQuery>,
) -> Result<Json<Vec<db::TaskRow>>, (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| internal_error(&e.to_string()))?
        .unwrap_or_else(|| "default".to_string());
    let tasks = db::list_tasks(&conn, &profile_id, query.status.as_deref())
        .map_err(|e| internal_error(&e.to_string()))?;
    Ok(Json(tasks))
}

#[derive(Deserialize)]
struct CreateTaskBody {
    title: String,
    content: Option<String>,
    priority: String,
    source_type: Option<String>,
}

async fn create_task(
    State(state): State<RemoteAppState>,
    Json(body): Json<CreateTaskBody>,
) -> Result<(StatusCode, Json<db::TaskRow>), (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| internal_error(&e.to_string()))?
        .unwrap_or_else(|| "default".to_string());
    let task = db::create_task(
        &conn,
        &body.title,
        body.content.as_deref(),
        &body.priority,
        &profile_id,
        body.source_type.as_deref(),
    )
    .map_err(|e| internal_error(&e.to_string()))?;
    Ok((StatusCode::CREATED, Json(task)))
}

async fn get_task(
    State(state): State<RemoteAppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<db::TaskRow>, (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    let task = db::get_task(&conn, &id)
        .map_err(|e| internal_error(&e.to_string()))?
        .ok_or_else(|| not_found("Task"))?;
    Ok(Json(task))
}

#[derive(Deserialize)]
struct UpdateTaskBody {
    title: Option<String>,
    content: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    due_date: Option<String>,
    assigned_to: Option<String>,
}

async fn update_task(
    State(state): State<RemoteAppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<UpdateTaskBody>,
) -> Result<Json<bool>, (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    // Fetch existing task to merge partial updates
    let existing = db::get_task(&conn, &id)
        .map_err(|e| internal_error(&e.to_string()))?
        .ok_or_else(|| not_found("Task"))?;

    let title = body.title.as_deref().unwrap_or(&existing.title);
    let content = body.content.as_deref().or(existing.content.as_deref());
    let status = body.status.as_deref().unwrap_or(&existing.status);
    let priority = body.priority.as_deref().unwrap_or(&existing.priority);
    let due_date = body.due_date.as_deref().or(existing.due_date.as_deref());
    let assigned_to = body.assigned_to.as_deref().or(existing.assigned_to.as_deref());

    let result = db::update_task(&conn, &id, title, content, status, priority, due_date, assigned_to)
        .map_err(|e| internal_error(&e.to_string()))?;
    Ok(Json(result))
}

async fn delete_task(
    State(state): State<RemoteAppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    let result = db::delete_task(&conn, &id)
        .map_err(|e| internal_error(&e.to_string()))?;
    Ok(Json(result))
}

// ─── Files ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct FilePathBody {
    path: String,
}

#[derive(Serialize)]
struct FileReadResponse {
    content: String,
    size: u64,
    extension: Option<String>,
    path: String,
}

async fn read_file(
    State(state): State<RemoteAppState>,
    Json(body): Json<FilePathBody>,
) -> Result<Json<FileReadResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Validate path is within project root
    validate_file_path(&body.path, &state.project_root)?;

    let path = std::path::Path::new(&body.path);
    let canonical = path.canonicalize().map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new("NOT_FOUND", &format!("Path not accessible: {}", e))),
        )
    })?;

    if !canonical.is_file() {
        return Err(not_found("File"));
    }

    let metadata = std::fs::metadata(&canonical).map_err(|e| internal_error(&e.to_string()))?;
    let content = std::fs::read_to_string(&canonical).map_err(|e| {
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(ErrorResponse::new("READ_ERROR", &format!("Failed to read file: {}", e))),
        )
    })?;

    let extension = canonical.extension().map(|e| e.to_string_lossy().to_string());

    Ok(Json(FileReadResponse {
        content,
        size: metadata.len(),
        extension,
        path: canonical.to_string_lossy().to_string(),
    }))
}

#[derive(Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    extension: Option<String>,
    size: u64,
}

async fn list_directory(
    State(state): State<RemoteAppState>,
    Json(body): Json<FilePathBody>,
) -> Result<Json<Vec<DirEntry>>, (StatusCode, Json<ErrorResponse>)> {
    validate_file_path(&body.path, &state.project_root)?;

    let canonical = std::path::Path::new(&body.path)
        .canonicalize()
        .map_err(|e| not_found(&format!("Path: {}", e)))?;

    if !canonical.is_dir() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("NOT_DIR", "Path is not a directory")),
        ));
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&canonical).map_err(|e| internal_error(&e.to_string()))?;

    for entry in read_dir.flatten() {
        let metadata = entry.metadata().unwrap_or_else(|_| {
            std::fs::metadata(entry.path()).unwrap()
        });
        let entry_path = entry.path();
        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry_path.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            extension: entry_path.extension().map(|e| e.to_string_lossy().to_string()),
            size: metadata.len(),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(Json(entries))
}

#[derive(Serialize)]
struct FileStat {
    path: String,
    size: u64,
    is_dir: bool,
    is_file: bool,
    extension: Option<String>,
    readonly: bool,
}

async fn file_stat(
    State(state): State<RemoteAppState>,
    Json(body): Json<FilePathBody>,
) -> Result<Json<FileStat>, (StatusCode, Json<ErrorResponse>)> {
    validate_file_path(&body.path, &state.project_root)?;

    let canonical = std::path::Path::new(&body.path)
        .canonicalize()
        .map_err(|e| not_found(&format!("Path: {}", e)))?;

    let metadata = std::fs::metadata(&canonical).map_err(|e| internal_error(&e.to_string()))?;

    Ok(Json(FileStat {
        path: canonical.to_string_lossy().to_string(),
        size: metadata.len(),
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        extension: canonical.extension().map(|e| e.to_string_lossy().to_string()),
        readonly: metadata.permissions().readonly(),
    }))
}

#[derive(Serialize)]
struct FileEntry {
    path: String,
    relative_path: String,
    is_dir: bool,
    extension: Option<String>,
}

#[derive(Deserialize)]
struct FileTreeQuery {
    root: Option<String>,
}

async fn file_tree(
    State(state): State<RemoteAppState>,
    Query(query): Query<FileTreeQuery>,
) -> Result<Json<Vec<FileEntry>>, (StatusCode, Json<ErrorResponse>)> {
    let root = query.root.unwrap_or_else(|| state.project_root.clone());
    let root_path = std::path::Path::new(&root);

    if !root_path.is_dir() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("NOT_DIR", "Root is not a directory")),
        ));
    }

    let mut builder = ignore::WalkBuilder::new(root_path);
    builder.hidden(true).git_ignore(true).git_global(true).git_exclude(true);

    let contextignore = root_path.join(".contextignore");
    if contextignore.exists() {
        builder.add_ignore(&contextignore);
    }

    let mut entries = Vec::new();
    for result in builder.build().flatten() {
        let path = result.path().to_path_buf();
        if !path.is_file() {
            continue;
        }
        let relative = path
            .strip_prefix(root_path)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        entries.push(FileEntry {
            path: path.to_string_lossy().to_string(),
            relative_path: relative,
            is_dir: false,
            extension: path.extension().map(|e| e.to_string_lossy().to_string()),
        });
    }

    entries.sort_by(|a, b| a.relative_path.to_lowercase().cmp(&b.relative_path.to_lowercase()));
    Ok(Json(entries))
}

// ─── Terminal ────────────────────────────────────────────────────────

#[derive(Serialize)]
struct TerminalSession {
    session_id: String,
}

#[derive(Deserialize)]
struct CreateTerminalBody {
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

async fn list_terminals(
    State(state): State<RemoteAppState>,
) -> Json<Vec<TerminalSession>> {
    let pty_mgr = state.pty_manager.lock().unwrap();
    let sessions: Vec<TerminalSession> = pty_mgr
        .list_sessions()
        .into_iter()
        .map(|id| TerminalSession { session_id: id })
        .collect();
    Json(sessions)
}

async fn create_terminal(
    State(_state): State<RemoteAppState>,
    Json(_body): Json<CreateTerminalBody>,
) -> Result<(StatusCode, Json<TerminalSession>), (StatusCode, Json<ErrorResponse>)> {
    // TODO: Terminal creation from remote requires the Tauri AppHandle for event emission.
    // This will be implemented when we add the app_handle to RemoteAppState.
    // For now, mobile clients can view/interact with terminals created from the desktop.
    Err((
        StatusCode::NOT_IMPLEMENTED,
        Json(ErrorResponse::new(
            "NOT_IMPLEMENTED",
            "Remote terminal creation is not yet implemented. Use existing desktop terminal sessions.",
        )),
    ))
}

async fn kill_terminal(
    State(state): State<RemoteAppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, Json<ErrorResponse>)> {
    let mut pty_mgr = state.pty_manager.lock().map_err(|_| internal_error("Lock failed"))?;
    pty_mgr.kill(&id).map_err(|e| internal_error(&e))?;
    Ok(Json(true))
}

#[derive(Deserialize)]
struct ResizeBody {
    cols: u16,
    rows: u16,
}

async fn resize_terminal(
    State(state): State<RemoteAppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<ResizeBody>,
) -> Result<Json<bool>, (StatusCode, Json<ErrorResponse>)> {
    let mut pty_mgr = state.pty_manager.lock().map_err(|_| internal_error("Lock failed"))?;
    pty_mgr
        .resize(&id, body.cols, body.rows)
        .map_err(|e| internal_error(&e))?;
    Ok(Json(true))
}

// ─── Devices management ──────────────────────────────────────────────

async fn list_devices(
    State(state): State<RemoteAppState>,
) -> Result<Json<Vec<db::PairedDeviceRow>>, (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    let devices = db::list_paired_devices(&conn).map_err(|e| internal_error(&e.to_string()))?;
    Ok(Json(devices))
}

async fn revoke_device(
    State(state): State<RemoteAppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, Json<ErrorResponse>)> {
    let conn = state.db.lock().map_err(|_| internal_error("Lock failed"))?;
    let result = db::revoke_paired_device(&conn, &id).map_err(|e| internal_error(&e.to_string()))?;
    Ok(Json(result))
}

// ─── Helpers ─────────────────────────────────────────────────────────

fn internal_error(msg: &str) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse::new("INTERNAL_ERROR", msg)),
    )
}

fn not_found(entity: &str) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse::new("NOT_FOUND", &format!("{} not found", entity))),
    )
}

/// Validate that a file path doesn't escape the project root (path traversal protection).
fn validate_file_path(
    path: &str,
    project_root: &str,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    // Resolve the path to catch ".." traversal
    let resolved = match std::path::Path::new(path).canonicalize() {
        Ok(p) => p,
        Err(_) => {
            return Err(not_found("Path"));
        }
    };
    let root = match std::path::Path::new(project_root).canonicalize() {
        Ok(p) => p,
        Err(_) => {
            return Err(internal_error("Project root not accessible"));
        }
    };

    if !resolved.starts_with(&root) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse::new(
                "FORBIDDEN",
                "Access denied: path is outside the project root",
            )),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_file_path_rejects_traversal() {
        // /etc/passwd should not be under any typical project root
        let result = validate_file_path("/etc/passwd", "/home/user/project");
        assert!(result.is_err());
    }

    #[test]
    fn test_internal_error_format() {
        let (status, json) = internal_error("something broke");
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(json.0.error.code, "INTERNAL_ERROR");
    }

    #[test]
    fn test_not_found_format() {
        let (status, json) = not_found("Note");
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(json.0.error.message.contains("Note"));
    }
}
