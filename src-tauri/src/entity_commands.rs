use crate::db;
use crate::ingest;
use crate::AppState;

// ─── Note commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn note_create(
    title: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<db::NoteRow, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "default".to_string());
    db::create_note(&conn, &title, &content, &profile_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn note_get(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<db::NoteRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_note(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn note_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::NoteRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "default".to_string());
    db::list_notes(&conn, &profile_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn note_update(
    id: String,
    title: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_note(&conn, &id, &title, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn note_delete(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_note(&conn, &id).map_err(|e| e.to_string())
}

// ─── Task commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn task_create(
    title: String,
    content: Option<String>,
    priority: String,
    state: tauri::State<'_, AppState>,
) -> Result<db::TaskRow, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "default".to_string());
    db::create_task(&conn, &title, content.as_deref(), &priority, &profile_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn task_get(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<db::TaskRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_task(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn task_list(
    status_filter: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::TaskRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "default".to_string());
    db::list_tasks(&conn, &profile_id, status_filter.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn task_update(
    id: String,
    title: String,
    content: Option<String>,
    status: String,
    priority: String,
    due_date: Option<String>,
    assigned_to: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_task(
        &conn,
        &id,
        &title,
        content.as_deref(),
        &status,
        &priority,
        due_date.as_deref(),
        assigned_to.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn task_delete(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_task(&conn, &id).map_err(|e| e.to_string())
}

// ─── Entity Link commands ────────────────────────────────────────────

#[tauri::command]
pub fn entity_link_create(
    source_id: String,
    target_id: String,
    relationship_type: String,
    state: tauri::State<'_, AppState>,
) -> Result<db::EntityLinkRow, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::create_entity_link(&conn, &source_id, &target_id, &relationship_type, false, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn entity_link_list(
    entity_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::EntityLinkRow>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_entity_links(&conn, &entity_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn entity_link_delete(
    link_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_entity_link(&conn, &link_id).map_err(|e| e.to_string())
}

// ─── Auto-linking commands ───────────────────────────────────────────

/// Embed a note into LanceDB and run auto-linking via reference extraction.
#[tauri::command]
pub async fn note_auto_link(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::EntityLinkRow>, String> {
    // 1. Read note from SQLite
    let (title, content, profile_id, sidecar_url) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let profile_id = db::get_active_profile_id(&conn)
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "default".to_string());
        let note = db::get_note(&conn, &id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Note not found: {}", id))?;
        (note.title, note.content, profile_id, state.sidecar_url.clone())
    };

    // 2. Delete old embeddings for this note
    let source_file_key = format!("note_{}", id);
    let _ = ingest::delete_file_embeddings(&source_file_key, &sidecar_url).await;

    // 3. Embed note content
    if !content.is_empty() {
        ingest::embed_note(&id, &title, &content, &sidecar_url)
            .await
            .map_err(|e| e.to_string())?;
    }

    // 4. Get known symbols for fuzzy matching
    let known_symbols: Vec<String> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let titles = db::list_entity_titles(&conn, &profile_id).map_err(|e| e.to_string())?;
        titles.into_iter().map(|(_, title, _)| title).collect()
    };

    // 5. Extract references from note content
    let refs_response = ingest::extract_references(&content, &known_symbols, &sidecar_url)
        .await
        .map_err(|e| e.to_string())?;

    // 6. Create entity links for each matched reference
    let mut new_links = Vec::new();
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        for extracted_ref in &refs_response.references {
            let matched_entities: Vec<(String, String)> = match extracted_ref.ref_type.as_str() {
                "code_symbol" => {
                    db::find_entities_by_title(&conn, &extracted_ref.text, &profile_id)
                        .unwrap_or_default()
                }
                "file_path" => {
                    db::find_entities_by_source_file(&conn, &extracted_ref.text)
                        .unwrap_or_default()
                        .into_iter()
                        .map(|(eid, _, etype)| (eid, etype))
                        .collect()
                }
                _ => continue,
            };

            // Get a context snippet (surrounding text)
            let ctx_start = extracted_ref.start.saturating_sub(30);
            let ctx_end = (extracted_ref.end + 30).min(content.len());
            let context = content.get(ctx_start..ctx_end).unwrap_or(&extracted_ref.text);

            for (entity_id, _entity_type) in &matched_entities {
                // Don't link to self
                if entity_id == &id {
                    continue;
                }
                if let Ok(link) = db::create_entity_link_with_confidence(
                    &conn,
                    &id,
                    entity_id,
                    "references",
                    extracted_ref.confidence,
                    true,
                    Some(context),
                ) {
                    new_links.push(link);
                }
            }
        }
    }

    Ok(new_links)
}

/// Confirm a suggested link (user approves auto-generated link).
#[tauri::command]
pub fn entity_link_confirm(
    link_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::confirm_entity_link(&conn, &link_id).map_err(|e| e.to_string())
}

/// List links for an entity with rich details about the linked entities.
#[tauri::command]
pub fn entity_links_with_details(
    entity_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::LinkWithEntity>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_entity_links_with_details(&conn, &entity_id).map_err(|e| e.to_string())
}

// ─── Entity Search command ───────────────────────────────────────────

#[tauri::command]
pub fn entity_search(
    query: String,
    entity_type: Option<String>,
    limit: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::EntitySearchResult>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let profile_id = db::get_active_profile_id(&conn)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "default".to_string());
    let limit = limit.unwrap_or(20);
    db::search_entities(&conn, &query, entity_type.as_deref(), &profile_id, limit)
        .map_err(|e| e.to_string())
}
