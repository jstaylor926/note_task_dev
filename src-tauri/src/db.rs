use rusqlite::{Connection, Result, params};
use serde::{Serialize, Deserialize};
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NoteRow {
    pub id: String,
    pub title: String,
    pub content: String,
    pub metadata: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskRow {
    pub id: String,
    pub title: String,
    pub content: Option<String>,
    pub status: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub assigned_to: Option<String>,
    pub completed_at: Option<String>,
    pub source_type: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EntityLinkRow {
    pub id: String,
    pub source_entity_id: String,
    pub target_entity_id: String,
    pub relationship_type: String,
    pub confidence: f64,
    pub auto_generated: bool,
    pub context: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EntitySearchResult {
    pub id: String,
    pub entity_type: String,
    pub title: String,
    pub content: Option<String>,
    pub source_file: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceProfileRow {
    pub id: String,
    pub name: String,
    pub watched_directories: String,
    pub llm_routing_overrides: Option<String>,
    pub system_prompt_additions: Option<String>,
    pub default_model: Option<String>,
    pub embedding_model: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionStateRow {
    pub id: String,
    pub workspace_profile_id: String,
    pub payload: String, // JSON blob
    pub trigger: String,
    pub duration_minutes: Option<i32>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessageRow {
    pub id: String,
    pub workspace_profile_id: String,
    pub thread_id: Option<String>,
    pub role: String,
    pub content: String,
    pub model_used: Option<String>,
    pub token_count_input: Option<i32>,
    pub token_count_output: Option<i32>,
    pub cost_usd: Option<f64>,
    pub latency_ms: Option<i32>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppAuditLogRow {
    pub id: String,
    pub event_type: String,
    pub actor: Option<String>,
    pub trace_id: Option<String>,
    pub details_json: Option<String>,
    pub created_at: String,
}

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    description TEXT,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    watched_directories TEXT NOT NULL,
    llm_routing_overrides TEXT,
    system_prompt_additions TEXT,
    default_model TEXT,
    embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_profiles_active ON workspace_profiles(is_active);

CREATE TABLE IF NOT EXISTS session_states (
    id TEXT PRIMARY KEY,
    workspace_profile_id TEXT NOT NULL REFERENCES workspace_profiles(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    trigger TEXT NOT NULL DEFAULT 'exit',
    duration_minutes INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_profile ON session_states(workspace_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    metadata TEXT,
    source_file TEXT,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_profile ON entities(workspace_profile_id);
CREATE INDEX IF NOT EXISTS idx_entities_source ON entities(source_file);
CREATE INDEX IF NOT EXISTS idx_entities_updated ON entities(updated_at DESC);

CREATE TABLE IF NOT EXISTS entity_links (
    id TEXT PRIMARY KEY,
    source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    auto_generated BOOLEAN DEFAULT TRUE,
    context TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_links_source ON entity_links(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON entity_links(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_links_type ON entity_links(relationship_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_links_unique ON entity_links(source_entity_id, target_entity_id, relationship_type);

CREATE TABLE IF NOT EXISTS tasks (
    entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium',
    due_date TIMESTAMP,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    source_type TEXT,
    assigned_to TEXT,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_profile ON tasks(workspace_profile_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    thread_id TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model_used TEXT,
    token_count_input INTEGER,
    token_count_output INTEGER,
    cost_usd REAL,
    latency_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_profile ON chat_messages(workspace_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_thread ON chat_messages(thread_id, created_at ASC);

CREATE TABLE IF NOT EXISTS terminal_commands (
    id TEXT PRIMARY KEY,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    session_entity_id TEXT REFERENCES entities(id),
    command TEXT NOT NULL,
    cwd TEXT,
    exit_code INTEGER,
    stdout_preview TEXT,
    stderr_preview TEXT,
    stdout_size_bytes INTEGER,
    stderr_size_bytes INTEGER,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_terminal_profile ON terminal_commands(workspace_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_exit ON terminal_commands(exit_code);

CREATE TABLE IF NOT EXISTS file_index (
    file_path TEXT NOT NULL,
    workspace_profile_id TEXT NOT NULL REFERENCES workspace_profiles(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    language TEXT,
    chunk_count INTEGER,
    file_size_bytes INTEGER,
    last_indexed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (file_path, workspace_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_fileindex_profile ON file_index(workspace_profile_id);
CREATE INDEX IF NOT EXISTS idx_fileindex_hash ON file_index(content_hash);

CREATE TABLE IF NOT EXISTS git_events (
    id TEXT PRIMARY KEY,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    repo_path TEXT,
    ref_name TEXT,
    commit_hash TEXT,
    parent_hashes TEXT,
    message TEXT,
    author TEXT,
    files_changed TEXT,
    insertions INTEGER,
    deletions INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_git_profile ON git_events(workspace_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_git_type ON git_events(event_type);
CREATE INDEX IF NOT EXISTS idx_git_branch ON git_events(ref_name);

CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS llm_runs (
    id TEXT PRIMARY KEY,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    provider TEXT,
    model TEXT NOT NULL,
    request_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER,
    token_count_input INTEGER,
    token_count_output INTEGER,
    cost_usd REAL,
    trace_id TEXT,
    metadata_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_llm_runs_profile ON llm_runs(workspace_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_runs_trace ON llm_runs(trace_id);

CREATE TABLE IF NOT EXISTS retrieval_feedback (
    id TEXT PRIMARY KEY,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    query TEXT NOT NULL,
    selected_result_id TEXT,
    selected_result_type TEXT,
    relevance_label TEXT,
    trace_id TEXT,
    metadata_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_retrieval_feedback_profile ON retrieval_feedback(workspace_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retrieval_feedback_trace ON retrieval_feedback(trace_id);

CREATE TABLE IF NOT EXISTS app_audit_log (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    actor TEXT,
    trace_id TEXT,
    details_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_event_type ON app_audit_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trace ON app_audit_log(trace_id);

CREATE TABLE IF NOT EXISTS paired_devices (
    id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    platform TEXT,
    last_seen_at TIMESTAMP,
    paired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_paired_devices_token ON paired_devices(token_hash);
CREATE INDEX IF NOT EXISTS idx_paired_devices_revoked ON paired_devices(revoked);

CREATE TABLE IF NOT EXISTS editor_layouts (
    workspace_profile_id TEXT PRIMARY KEY REFERENCES workspace_profiles(id) ON DELETE CASCADE,
    layout_json TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- FTS5 Virtual Table for Search
CREATE VIRTUAL TABLE IF NOT EXISTS fts_search USING fts5(
    entity_id UNINDEXED,
    entity_type UNINDEXED,
    title,
    content,
    tokenize="porter unicode61"
);

-- Triggers to keep FTS in sync with entities
CREATE TRIGGER IF NOT EXISTS tr_entities_ai AFTER INSERT ON entities BEGIN
    INSERT INTO fts_search(entity_id, entity_type, title, content)
    VALUES (new.id, new.entity_type, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS tr_entities_ad AFTER DELETE ON entities BEGIN
    DELETE FROM fts_search WHERE entity_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS tr_entities_au AFTER UPDATE ON entities BEGIN
    UPDATE fts_search SET 
        title = new.title,
        content = new.content
    WHERE entity_id = old.id;
END;
"#;

pub fn initialize(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    // Enable WAL mode for concurrent reads
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    // Create all tables and indexes
    conn.execute_batch(SCHEMA_SQL)?;

    // Insert initial schema version if table is empty
    let version_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM schema_version", [], |row| row.get(0))?;
    if version_count == 0 {
        conn.execute(
            "INSERT INTO schema_version (version, description) VALUES (1, 'initial schema')",
            [],
        )?;
    }

    let current_version: i64 =
        conn.query_row("SELECT MAX(version) FROM schema_version", [], |row| row.get(0))?;
    if current_version < 2 {
        conn.execute(
            "INSERT INTO schema_version (version, description) VALUES (2, 'add llm_runs, retrieval_feedback, app_audit_log')",
            [],
        )?;
    }

    // Insert default workspace profile if none exists
    let profile_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM workspace_profiles", [], |row| {
            row.get(0)
        })?;
    if profile_count == 0 {
        let default_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO workspace_profiles (id, name, watched_directories, is_active) VALUES (?1, ?2, ?3, TRUE)",
            [&default_id, "Default", "[]"],
        )?;
    }

    // Insert default app_config entries if empty
    let config_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM app_config", [], |row| row.get(0))?;
    if config_count == 0 {
        let defaults = [
            ("theme", r#""dark""#),
            ("sidecar_port", "9400"),
            ("periodic_snapshot_interval_minutes", "5"),
            ("max_stdout_capture_bytes", "10240"),
            ("embedding_batch_size", "32"),
        ];
        for (key, value) in defaults {
            conn.execute(
                "INSERT INTO app_config (key, value) VALUES (?1, ?2)",
                [key, value],
            )?;
        }
    }

    // Populate FTS if empty and we have entities
    let fts_count: i64 = conn.query_row("SELECT COUNT(*) FROM fts_search", [], |row| row.get(0))?;
    if fts_count == 0 {
        conn.execute_batch(
            "INSERT INTO fts_search(entity_id, entity_type, title, content)
             SELECT id, entity_type, title, content FROM entities"
        )?;
    }

    log::info!("Database initialized at {:?}", db_path);
    Ok(conn)
}

/// Get the active workspace profile ID. Returns None if no active profile exists.
pub fn get_active_profile_id(conn: &Connection) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT id FROM workspace_profiles WHERE is_active = TRUE LIMIT 1")?;
    let mut rows = stmt.query([])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

/// Get the watched directories for the active profile
pub fn get_active_profile_watched_directories(conn: &Connection) -> Result<Option<Vec<String>>> {
    let mut stmt = conn.prepare("SELECT watched_directories FROM workspace_profiles WHERE is_active = TRUE LIMIT 1")?;
    let mut rows = stmt.query([])?;
    match rows.next()? {
        Some(row) => {
            let json_str: String = row.get(0)?;
            let dirs: Vec<String> = match serde_json::from_str(&json_str) {
                Ok(parsed) => parsed,
                Err(_) => json_str
                    .lines()
                    .map(|line| line.trim())
                    .filter(|line| !line.is_empty())
                    .map(|line| line.to_string())
                    .collect(),
            };
            Ok(Some(dirs))
        }
        None => Ok(None),
    }
}

/// Get the stored content hash for a file. Returns None if file is not indexed.
pub fn get_file_hash(conn: &Connection, file_path: &str, profile_id: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT content_hash FROM file_index WHERE file_path = ?1 AND workspace_profile_id = ?2",
    )?;
    let mut rows = stmt.query(rusqlite::params![file_path, profile_id])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

/// Insert or update the file_index entry for a file.
pub fn upsert_file_index(
    conn: &Connection,
    file_path: &str,
    profile_id: &str,
    content_hash: &str,
    language: &str,
    chunk_count: usize,
    file_size: u64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO file_index (file_path, workspace_profile_id, content_hash, language, chunk_count, file_size_bytes, last_indexed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
         ON CONFLICT(file_path, workspace_profile_id) DO UPDATE SET
           content_hash = excluded.content_hash,
           language = excluded.language,
           chunk_count = excluded.chunk_count,
           file_size_bytes = excluded.file_size_bytes,
           last_indexed = CURRENT_TIMESTAMP",
        rusqlite::params![file_path, profile_id, content_hash, language, chunk_count as i64, file_size as i64],
    )?;
    Ok(())
}

/// Insert or update an entity (function, class, struct, etc.) extracted from a source file.
pub fn upsert_entity(
    conn: &Connection,
    entity_type: &str,
    title: &str,
    source_file: &str,
    profile_id: &str,
    metadata_json: &str,
) -> Result<()> {
    // Check if an entity with the same title+source_file+type already exists
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM entities WHERE title = ?1 AND source_file = ?2 AND entity_type = ?3",
            rusqlite::params![title, source_file, entity_type],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing_id {
        conn.execute(
            "UPDATE entities SET metadata = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            rusqlite::params![metadata_json, id],
        )?;
    } else {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO entities (id, entity_type, title, source_file, workspace_profile_id, metadata)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, entity_type, title, source_file, profile_id, metadata_json],
        )?;
    }
    Ok(())
}

/// Delete all entities associated with a source file.
pub fn delete_entities_by_source_file(conn: &Connection, source_file: &str) -> Result<usize> {
    let deleted = conn.execute(
        "DELETE FROM entities WHERE source_file = ?1",
        rusqlite::params![source_file],
    )?;
    Ok(deleted)
}

/// Insert a terminal command record.
pub fn insert_terminal_command(
    conn: &Connection,
    profile_id: &str,
    command: &str,
    cwd: Option<&str>,
    exit_code: Option<i32>,
    duration_ms: Option<u64>,
    output: Option<&str>,
) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    let size_bytes = output.map(|s| s.len() as i64);
    conn.execute(
        "INSERT INTO terminal_commands (id, workspace_profile_id, command, cwd, exit_code, duration_ms, stdout_preview, stdout_size_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            id,
            profile_id,
            command,
            cwd,
            exit_code,
            duration_ms.map(|d| d as i64),
            output,
            size_bytes,
        ],
    )?;
    Ok(id)
}

/// Delete the file_index entry for a file.
pub fn delete_file_index(conn: &Connection, file_path: &str, profile_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM file_index WHERE file_path = ?1 AND workspace_profile_id = ?2",
        rusqlite::params![file_path, profile_id],
    )?;
    Ok(())
}

// ─── Note CRUD ───────────────────────────────────────────────────────

/// Create a new note entity. Returns the created NoteRow.
pub fn create_note(conn: &Connection, title: &str, content: &str, profile_id: &str) -> Result<NoteRow> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO entities (id, entity_type, title, content, workspace_profile_id)
         VALUES (?1, 'note', ?2, ?3, ?4)",
        params![id, title, content, profile_id],
    )?;
    // Read back the created row to get server-set timestamps
    get_note(conn, &id)?.ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
}

/// Get a single note by ID.
pub fn get_note(conn: &Connection, id: &str) -> Result<Option<NoteRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, metadata, created_at, updated_at
         FROM entities WHERE id = ?1 AND entity_type = 'note'"
    )?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => Ok(Some(NoteRow {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            metadata: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })),
        None => Ok(None),
    }
}

/// List all notes for a workspace profile, ordered by updated_at DESC.
pub fn list_notes(conn: &Connection, profile_id: &str) -> Result<Vec<NoteRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, metadata, created_at, updated_at
         FROM entities WHERE entity_type = 'note' AND workspace_profile_id = ?1
         ORDER BY updated_at DESC"
    )?;
    let rows = stmt.query_map(params![profile_id], |row| {
        Ok(NoteRow {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            metadata: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

/// Update a note's title and content. Returns true if a row was updated.
pub fn update_note(conn: &Connection, id: &str, title: &str, content: &str) -> Result<bool> {
    let updated = conn.execute(
        "UPDATE entities SET title = ?1, content = ?2, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?3 AND entity_type = 'note'",
        params![title, content, id],
    )?;
    Ok(updated > 0)
}

/// Delete a note. Returns true if a row was deleted. Cascade deletes entity_links via FK.
pub fn delete_note(conn: &Connection, id: &str) -> Result<bool> {
    let deleted = conn.execute(
        "DELETE FROM entities WHERE id = ?1 AND entity_type = 'note'",
        params![id],
    )?;
    Ok(deleted > 0)
}

// ─── Task CRUD ───────────────────────────────────────────────────────

/// Create a new task (inserts into both entities and tasks tables). Returns the created TaskRow.
pub fn create_task(conn: &Connection, title: &str, content: Option<&str>, priority: &str, profile_id: &str, source_type: Option<&str>) -> Result<TaskRow> {
    let id = Uuid::new_v4().to_string();
    let st = source_type.unwrap_or("manual");
    conn.execute(
        "INSERT INTO entities (id, entity_type, title, content, workspace_profile_id)
         VALUES (?1, 'task', ?2, ?3, ?4)",
        params![id, title, content, profile_id],
    )?;
    conn.execute(
        "INSERT INTO tasks (entity_id, status, priority, workspace_profile_id, source_type)
         VALUES (?1, 'todo', ?2, ?3, ?4)",
        params![id, priority, profile_id, st],
    )?;
    get_task(conn, &id)?.ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
}

/// Get a single task by entity ID (joins entities + tasks).
pub fn get_task(conn: &Connection, id: &str) -> Result<Option<TaskRow>> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.title, e.content, t.status, t.priority, t.due_date,
                t.assigned_to, t.completed_at, t.source_type, e.created_at, e.updated_at
         FROM entities e JOIN tasks t ON e.id = t.entity_id
         WHERE e.id = ?1 AND e.entity_type = 'task'"
    )?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => Ok(Some(TaskRow {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            status: row.get(3)?,
            priority: row.get(4)?,
            due_date: row.get(5)?,
            assigned_to: row.get(6)?,
            completed_at: row.get(7)?,
            source_type: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })),
        None => Ok(None),
    }
}

/// List tasks for a workspace profile with optional status filter.
pub fn list_tasks(conn: &Connection, profile_id: &str, status_filter: Option<&str>) -> Result<Vec<TaskRow>> {
    fn read_task_row(row: &rusqlite::Row) -> rusqlite::Result<TaskRow> {
        Ok(TaskRow {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            status: row.get(3)?,
            priority: row.get(4)?,
            due_date: row.get(5)?,
            assigned_to: row.get(6)?,
            completed_at: row.get(7)?,
            source_type: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    }

    if let Some(status) = status_filter {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.title, e.content, t.status, t.priority, t.due_date,
                    t.assigned_to, t.completed_at, t.source_type, e.created_at, e.updated_at
             FROM entities e JOIN tasks t ON e.id = t.entity_id
             WHERE e.entity_type = 'task' AND e.workspace_profile_id = ?1 AND t.status = ?2
             ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, e.created_at DESC"
        )?;
        let result = stmt.query_map(params![profile_id, status], read_task_row)?.collect();
        result
    } else {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.title, e.content, t.status, t.priority, t.due_date,
                    t.assigned_to, t.completed_at, t.source_type, e.created_at, e.updated_at
             FROM entities e JOIN tasks t ON e.id = t.entity_id
             WHERE e.entity_type = 'task' AND e.workspace_profile_id = ?1
             ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, e.created_at DESC"
        )?;
        let result = stmt.query_map(params![profile_id], read_task_row)?.collect();
        result
    }
}

/// Update a task's fields. Sets completed_at when status='done'. Returns true if updated.
#[allow(clippy::too_many_arguments)]
pub fn update_task(
    conn: &Connection,
    id: &str,
    title: &str,
    content: Option<&str>,
    status: &str,
    priority: &str,
    due_date: Option<&str>,
    assigned_to: Option<&str>,
) -> Result<bool> {
    let updated_entity = conn.execute(
        "UPDATE entities SET title = ?1, content = ?2, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?3 AND entity_type = 'task'",
        params![title, content, id],
    )?;
    if updated_entity == 0 {
        return Ok(false);
    }

    // Use SQL expression for completed_at: set CURRENT_TIMESTAMP when transitioning to 'done',
    // preserve existing value if already done, clear if moving away from done
    if status == "done" {
        conn.execute(
            "UPDATE tasks SET status = ?1, priority = ?2, due_date = ?3, assigned_to = ?4,
             completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
             WHERE entity_id = ?5",
            params![status, priority, due_date, assigned_to, id],
        )?;
    } else {
        conn.execute(
            "UPDATE tasks SET status = ?1, priority = ?2, due_date = ?3, assigned_to = ?4,
             completed_at = NULL
             WHERE entity_id = ?5",
            params![status, priority, due_date, assigned_to, id],
        )?;
    }
    Ok(true)
}

/// Delete a task. CASCADE deletes the tasks row via FK.
pub fn delete_task(conn: &Connection, id: &str) -> Result<bool> {
    let deleted = conn.execute(
        "DELETE FROM entities WHERE id = ?1 AND entity_type = 'task'",
        params![id],
    )?;
    Ok(deleted > 0)
}

/// Check if a task with this exact title already exists (for auto-extraction dedup).
pub fn find_task_by_title(conn: &Connection, title: &str, profile_id: &str) -> Result<Option<TaskRow>> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.title, e.content, t.status, t.priority, t.due_date,
                t.assigned_to, t.completed_at, t.source_type, e.created_at, e.updated_at
         FROM entities e JOIN tasks t ON e.id = t.entity_id
         WHERE e.entity_type = 'task' AND e.title = ?1 AND e.workspace_profile_id = ?2"
    )?;
    let mut rows = stmt.query(params![title, profile_id])?;
    match rows.next()? {
        Some(row) => Ok(Some(TaskRow {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            status: row.get(3)?,
            priority: row.get(4)?,
            due_date: row.get(5)?,
            assigned_to: row.get(6)?,
            completed_at: row.get(7)?,
            source_type: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })),
        None => Ok(None),
    }
}

// ─── Workspace Profile CRUD ──────────────────────────────────────────

pub fn create_workspace_profile(
    conn: &Connection,
    name: &str,
    watched_directories: &str,
    default_model: Option<&str>,
) -> Result<WorkspaceProfileRow> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO workspace_profiles (id, name, watched_directories, default_model)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, name, watched_directories, default_model],
    )?;
    get_workspace_profile(conn, &id)?.ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
}

pub fn get_workspace_profile(conn: &Connection, id: &str) -> Result<Option<WorkspaceProfileRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, watched_directories, llm_routing_overrides,
                system_prompt_additions, default_model, embedding_model,
                is_active, created_at, updated_at
         FROM workspace_profiles WHERE id = ?1"
    )?;
    let mut rows = stmt.query(params![id])?;
    match rows.next()? {
        Some(row) => Ok(Some(WorkspaceProfileRow {
            id: row.get(0)?,
            name: row.get(1)?,
            watched_directories: row.get(2)?,
            llm_routing_overrides: row.get(3)?,
            system_prompt_additions: row.get(4)?,
            default_model: row.get(5)?,
            embedding_model: row.get(6)?,
            is_active: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })),
        None => Ok(None),
    }
}

pub fn list_workspace_profiles(conn: &Connection) -> Result<Vec<WorkspaceProfileRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, watched_directories, llm_routing_overrides,
                system_prompt_additions, default_model, embedding_model,
                is_active, created_at, updated_at
         FROM workspace_profiles ORDER BY name ASC"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(WorkspaceProfileRow {
            id: row.get(0)?,
            name: row.get(1)?,
            watched_directories: row.get(2)?,
            llm_routing_overrides: row.get(3)?,
            system_prompt_additions: row.get(4)?,
            default_model: row.get(5)?,
            embedding_model: row.get(6)?,
            is_active: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn activate_workspace_profile(conn: &Connection, id: &str) -> Result<bool> {
    // 1. Deactivate all
    conn.execute("UPDATE workspace_profiles SET is_active = FALSE", [])?;
    // 2. Activate one
    let updated = conn.execute(
        "UPDATE workspace_profiles SET is_active = TRUE WHERE id = ?1",
        params![id],
    )?;
    Ok(updated > 0)
}

pub fn update_workspace_profile(
    conn: &Connection,
    id: &str,
    name: &str,
    watched_directories: &str,
    default_model: Option<&str>,
) -> Result<bool> {
    let updated = conn.execute(
        "UPDATE workspace_profiles 
         SET name = ?1, watched_directories = ?2, default_model = ?3, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?4",
        params![name, watched_directories, default_model, id],
    )?;
    Ok(updated > 0)
}

pub fn delete_workspace_profile(conn: &Connection, id: &str) -> Result<bool> {
    let deleted = conn.execute(
        "DELETE FROM workspace_profiles WHERE id = ?1",
        params![id],
    )?;
    Ok(deleted > 0)
}

// ─── Session State CRUD ──────────────────────────────────────────────

pub fn create_session_state(
    conn: &Connection,
    profile_id: &str,
    payload_json: &str,
    trigger: &str,
    duration_minutes: Option<i32>,
) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO session_states (id, workspace_profile_id, payload, trigger, duration_minutes)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, profile_id, payload_json, trigger, duration_minutes],
    )?;
    Ok(id)
}

pub fn get_latest_session_state(conn: &Connection, profile_id: &str) -> Result<Option<SessionStateRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_profile_id, payload, trigger, duration_minutes, created_at
         FROM session_states 
         WHERE workspace_profile_id = ?1 
         ORDER BY created_at DESC LIMIT 1"
    )?;
    let mut rows = stmt.query(params![profile_id])?;
    match rows.next()? {
        Some(row) => Ok(Some(SessionStateRow {
            id: row.get(0)?,
            workspace_profile_id: row.get(1)?,
            payload: row.get(2)?,
            trigger: row.get(3)?,
            duration_minutes: row.get(4)?,
            created_at: row.get(5)?,
        })),
        None => Ok(None),
    }
}

pub fn list_session_history(conn: &Connection, profile_id: &str, limit: usize) -> Result<Vec<SessionStateRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_profile_id, payload, trigger, duration_minutes, created_at
         FROM session_states 
         WHERE workspace_profile_id = ?1 
         ORDER BY created_at DESC LIMIT ?2"
    )?;
    let rows = stmt.query_map(params![profile_id, limit as i64], |row| {
        Ok(SessionStateRow {
            id: row.get(0)?,
            workspace_profile_id: row.get(1)?,
            payload: row.get(2)?,
            trigger: row.get(3)?,
            duration_minutes: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

// ─── Chat Message CRUD ───────────────────────────────────────────────

pub fn create_chat_message(
    conn: &Connection,
    profile_id: &str,
    thread_id: Option<&str>,
    role: &str,
    content: &str,
    model_used: Option<&str>,
) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO chat_messages (id, workspace_profile_id, thread_id, role, content, model_used)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, profile_id, thread_id, role, content, model_used],
    )?;
    Ok(id)
}

pub fn list_chat_history(conn: &Connection, profile_id: &str, limit: usize) -> Result<Vec<ChatMessageRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_profile_id, thread_id, role, content, model_used,
                token_count_input, token_count_output, cost_usd, latency_ms, created_at
         FROM chat_messages 
         WHERE workspace_profile_id = ?1 
         ORDER BY created_at DESC LIMIT ?2"
    )?;
    let rows = stmt.query_map(params![profile_id, limit as i64], |row| {
        Ok(ChatMessageRow {
            id: row.get(0)?,
            workspace_profile_id: row.get(1)?,
            thread_id: row.get(2)?,
            role: row.get(3)?,
            content: row.get(4)?,
            model_used: row.get(5)?,
            token_count_input: row.get(6)?,
            token_count_output: row.get(7)?,
            cost_usd: row.get(8)?,
            latency_ms: row.get(9)?,
            created_at: row.get(10)?,
        })
    })?;
    rows.collect()
}

// ─── Entity Links ────────────────────────────────────────────────────

/// Create an entity link. Uses ON CONFLICT to upsert.
pub fn create_entity_link(
    conn: &Connection,
    source_id: &str,
    target_id: &str,
    relationship_type: &str,
    auto_generated: bool,
    context: Option<&str>,
) -> Result<EntityLinkRow> {
    create_entity_link_with_confidence(conn, source_id, target_id, relationship_type, 1.0, auto_generated, context)
}

/// Create an entity link with an explicit confidence score. Uses ON CONFLICT to upsert.
pub fn create_entity_link_with_confidence(
    conn: &Connection,
    source_id: &str,
    target_id: &str,
    relationship_type: &str,
    confidence: f64,
    auto_generated: bool,
    context: Option<&str>,
) -> Result<EntityLinkRow> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO entity_links (id, source_entity_id, target_entity_id, relationship_type, confidence, auto_generated, context)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(source_entity_id, target_entity_id, relationship_type) DO UPDATE SET
           context = excluded.context,
           confidence = excluded.confidence,
           auto_generated = excluded.auto_generated",
        params![id, source_id, target_id, relationship_type, confidence, auto_generated, context],
    )?;
    // Read back the row (may be the upserted one with different id)
    let mut stmt = conn.prepare(
        "SELECT id, source_entity_id, target_entity_id, relationship_type, confidence, auto_generated, context, created_at
         FROM entity_links WHERE source_entity_id = ?1 AND target_entity_id = ?2 AND relationship_type = ?3"
    )?;
    let mut rows = stmt.query(params![source_id, target_id, relationship_type])?;
    let row = rows.next()?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    Ok(EntityLinkRow {
        id: row.get(0)?,
        source_entity_id: row.get(1)?,
        target_entity_id: row.get(2)?,
        relationship_type: row.get(3)?,
        confidence: row.get(4)?,
        auto_generated: row.get(5)?,
        context: row.get(6)?,
        created_at: row.get(7)?,
    })
}

/// Delete an entity link by ID.
pub fn delete_entity_link(conn: &Connection, link_id: &str) -> Result<bool> {
    let deleted = conn.execute(
        "DELETE FROM entity_links WHERE id = ?1",
        params![link_id],
    )?;
    Ok(deleted > 0)
}

/// List all entity links where the given entity is either source or target.
pub fn list_entity_links(conn: &Connection, entity_id: &str) -> Result<Vec<EntityLinkRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, source_entity_id, target_entity_id, relationship_type, confidence, auto_generated, context, created_at
         FROM entity_links WHERE source_entity_id = ?1 OR target_entity_id = ?1
         ORDER BY created_at DESC"
    )?;
    let rows = stmt.query_map(params![entity_id], |row| {
        Ok(EntityLinkRow {
            id: row.get(0)?,
            source_entity_id: row.get(1)?,
            target_entity_id: row.get(2)?,
            relationship_type: row.get(3)?,
            confidence: row.get(4)?,
            auto_generated: row.get(5)?,
            context: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

/// A link enriched with the linked entity's details (avoids N+1 queries in frontend).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LinkWithEntity {
    pub link_id: String,
    pub linked_entity_id: String,
    pub linked_entity_title: String,
    pub linked_entity_type: String,
    pub linked_source_file: Option<String>,
    pub relationship_type: String,
    pub confidence: f64,
    pub auto_generated: bool,
    pub direction: String,  // "outgoing" or "incoming"
}

/// Get all entity titles for a profile (used to feed known_symbols to sidecar).
/// Returns Vec<(id, title, entity_type)>.
pub fn list_entity_titles(conn: &Connection, profile_id: &str) -> Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, entity_type FROM entities WHERE workspace_profile_id = ?1"
    )?;
    let rows = stmt.query_map(params![profile_id], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?;
    rows.collect()
}

/// Find entities by exact title match. Returns Vec<(id, entity_type)>.
pub fn find_entities_by_title(conn: &Connection, title: &str, profile_id: &str) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, entity_type FROM entities WHERE title = ?1 AND workspace_profile_id = ?2"
    )?;
    let rows = stmt.query_map(params![title, profile_id], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })?;
    rows.collect()
}

/// Find entities by source file path. Returns Vec<(id, title, entity_type)>.
pub fn find_entities_by_source_file(conn: &Connection, source_file: &str) -> Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, entity_type FROM entities WHERE source_file = ?1"
    )?;
    let rows = stmt.query_map(params![source_file], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?;
    rows.collect()
}

/// List suggested links (auto_generated=true with confidence >= min_confidence).
pub fn list_suggested_links(conn: &Connection, entity_id: &str, min_confidence: f64) -> Result<Vec<EntityLinkRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, source_entity_id, target_entity_id, relationship_type, confidence, auto_generated, context, created_at
         FROM entity_links
         WHERE (source_entity_id = ?1 OR target_entity_id = ?1)
           AND auto_generated = 1 AND confidence >= ?2
         ORDER BY confidence DESC"
    )?;
    let rows = stmt.query_map(params![entity_id, min_confidence], |row| {
        Ok(EntityLinkRow {
            id: row.get(0)?,
            source_entity_id: row.get(1)?,
            target_entity_id: row.get(2)?,
            relationship_type: row.get(3)?,
            confidence: row.get(4)?,
            auto_generated: row.get(5)?,
            context: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

/// Count suggested links across the workspace (auto_generated=true, confidence in [0.70, 0.85)).
pub fn count_suggested_links(conn: &Connection, profile_id: &str) -> Result<usize> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entity_links el
         JOIN entities e ON e.id = el.source_entity_id
         WHERE el.auto_generated = 1 AND el.confidence >= 0.70 AND el.confidence < 0.85
           AND e.workspace_profile_id = ?1",
        params![profile_id],
        |row| row.get(0),
    )?;
    Ok(count as usize)
}

/// Confirm a suggested link (set auto_generated = false). Returns true if updated.
pub fn confirm_entity_link(conn: &Connection, link_id: &str) -> Result<bool> {
    let updated = conn.execute(
        "UPDATE entity_links SET auto_generated = 0 WHERE id = ?1",
        params![link_id],
    )?;
    Ok(updated > 0)
}

/// List entity links with full details of the linked entity.
pub fn list_entity_links_with_details(conn: &Connection, entity_id: &str) -> Result<Vec<LinkWithEntity>> {
    let mut stmt = conn.prepare(
        "SELECT el.id,
           CASE WHEN el.source_entity_id = ?1 THEN el.target_entity_id ELSE el.source_entity_id END as linked_id,
           e.title, e.entity_type, e.source_file,
           el.relationship_type, el.confidence, el.auto_generated,
           CASE WHEN el.source_entity_id = ?1 THEN 'outgoing' ELSE 'incoming' END as direction
         FROM entity_links el
         JOIN entities e ON e.id = CASE WHEN el.source_entity_id = ?1 THEN el.target_entity_id ELSE el.source_entity_id END
         WHERE el.source_entity_id = ?1 OR el.target_entity_id = ?1
         ORDER BY el.confidence DESC"
    )?;
    let rows = stmt.query_map(params![entity_id], |row| {
        Ok(LinkWithEntity {
            link_id: row.get(0)?,
            linked_entity_id: row.get(1)?,
            linked_entity_title: row.get(2)?,
            linked_entity_type: row.get(3)?,
            linked_source_file: row.get(4)?,
            relationship_type: row.get(5)?,
            confidence: row.get(6)?,
            auto_generated: row.get(7)?,
            direction: row.get(8)?,
        })
    })?;
    rows.collect()
}

/// Get all entities for a profile (for global graph visualization).
pub fn get_all_entities(conn: &Connection, profile_id: &str) -> Result<Vec<EntitySearchResult>> {
    let mut stmt = conn.prepare(
        "SELECT id, entity_type, title, content, source_file, updated_at
         FROM entities WHERE workspace_profile_id = ?1"
    )?;
    let rows = stmt.query_map(params![profile_id], |row| {
        Ok(EntitySearchResult {
            id: row.get(0)?,
            entity_type: row.get(1)?,
            title: row.get(2)?,
            content: row.get(3)?,
            source_file: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

/// Get all links for a profile (for global graph visualization).
pub fn get_all_links(conn: &Connection, profile_id: &str) -> Result<Vec<EntityLinkRow>> {
    let mut stmt = conn.prepare(
        "SELECT el.id, el.source_entity_id, el.target_entity_id, el.relationship_type, 
                el.confidence, el.auto_generated, el.context, el.created_at
         FROM entity_links el
         JOIN entities e ON e.id = el.source_entity_id
         WHERE e.workspace_profile_id = ?1"
    )?;
    let rows = stmt.query_map(params![profile_id], |row| {
        Ok(EntityLinkRow {
            id: row.get(0)?,
            source_entity_id: row.get(1)?,
            target_entity_id: row.get(2)?,
            relationship_type: row.get(3)?,
            confidence: row.get(4)?,
            auto_generated: row.get(5)?,
            context: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

// ─── Entity Search ───────────────────────────────────────────────────

/// Search entities by keyword (LIKE) with optional type filter.
pub fn search_entities(
    conn: &Connection,
    query: &str,
    entity_type: Option<&str>,
    profile_id: &str,
    limit: usize,
) -> Result<Vec<EntitySearchResult>> {
    fn read_search_row(row: &rusqlite::Row) -> rusqlite::Result<EntitySearchResult> {
        Ok(EntitySearchResult {
            id: row.get(0)?,
            entity_type: row.get(1)?,
            title: row.get(2)?,
            content: row.get(3)?,
            source_file: row.get(4)?,
            updated_at: row.get(5)?,
        })
    }

    let like_pattern = format!("%{}%", query);
    if let Some(etype) = entity_type {
        let mut stmt = conn.prepare(
            "SELECT id, entity_type, title, content, source_file, updated_at
             FROM entities
             WHERE workspace_profile_id = ?1 AND entity_type = ?2
               AND (title LIKE ?3 OR content LIKE ?3)
             ORDER BY updated_at DESC LIMIT ?4"
        )?;
        let result = stmt.query_map(params![profile_id, etype, like_pattern, limit as i64], read_search_row)?.collect();
        result
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, entity_type, title, content, source_file, updated_at
             FROM entities
             WHERE workspace_profile_id = ?1
               AND (title LIKE ?2 OR content LIKE ?2)
             ORDER BY updated_at DESC LIMIT ?3"
        )?;
        let result = stmt.query_map(params![profile_id, like_pattern, limit as i64], read_search_row)?.collect();
        result
    }
}

// ─── Task Lineage ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskLineageRow {
    pub task_id: String,
    pub source_entity_id: String,
    pub source_entity_title: String,
    pub source_entity_type: String,
    pub source_file: Option<String>,
}

/// For each task_id, find the incoming 'contains_task' link and join the source entity.
pub fn get_task_lineages(conn: &Connection, task_ids: &[String]) -> Result<Vec<TaskLineageRow>> {
    if task_ids.is_empty() {
        return Ok(vec![]);
    }
    let placeholders: Vec<String> = task_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
    let sql = format!(
        "SELECT el.target_entity_id, el.source_entity_id, e.title, e.entity_type, e.source_file
         FROM entity_links el
         JOIN entities e ON e.id = el.source_entity_id
         WHERE el.relationship_type = 'contains_task' AND el.target_entity_id IN ({})",
        placeholders.join(", ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = task_ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok(TaskLineageRow {
            task_id: row.get(0)?,
            source_entity_id: row.get(1)?,
            source_entity_title: row.get(2)?,
            source_entity_type: row.get(3)?,
            source_file: row.get(4)?,
        })
    })?;
    rows.collect()
}

// ─── Paired Devices (Remote API) ─────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PairedDeviceRow {
    pub id: String,
    pub device_name: String,
    pub platform: Option<String>,
    pub last_seen_at: Option<String>,
    pub paired_at: String,
    pub revoked: bool,
}

pub fn insert_paired_device(
    conn: &Connection,
    device_id: &str,
    device_name: &str,
    token_hash: &str,
    platform: Option<&str>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO paired_devices (id, device_name, token_hash, platform, revoked, paired_at)
         VALUES (?1, ?2, ?3, ?4, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
            device_name = excluded.device_name,
            token_hash = excluded.token_hash,
            platform = excluded.platform,
            revoked = 0,
            paired_at = CURRENT_TIMESTAMP",
        params![device_id, device_name, token_hash, platform],
    )?;
    Ok(())
}

pub fn validate_device_token(conn: &Connection, token_hash: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM paired_devices WHERE token_hash = ?1 AND revoked = 0",
    )?;
    let mut rows = stmt.query(params![token_hash])?;
    match rows.next()? {
        Some(row) => {
            let device_id: String = row.get(0)?;
            // Update last_seen_at
            conn.execute(
                "UPDATE paired_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1",
                params![device_id],
            )?;
            Ok(Some(device_id))
        }
        None => Ok(None),
    }
}

pub fn list_paired_devices(conn: &Connection) -> Result<Vec<PairedDeviceRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, device_name, platform, last_seen_at, paired_at, revoked
         FROM paired_devices ORDER BY paired_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(PairedDeviceRow {
            id: row.get(0)?,
            device_name: row.get(1)?,
            platform: row.get(2)?,
            last_seen_at: row.get(3)?,
            paired_at: row.get(4)?,
            revoked: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn revoke_paired_device(conn: &Connection, device_id: &str) -> Result<bool> {
    let affected = conn.execute(
        "UPDATE paired_devices SET revoked = 1 WHERE id = ?1",
        params![device_id],
    )?;
    Ok(affected > 0)
}

pub fn delete_paired_device(conn: &Connection, device_id: &str) -> Result<bool> {
    let affected = conn.execute(
        "DELETE FROM paired_devices WHERE id = ?1",
        params![device_id],
    )?;
    Ok(affected > 0)
}

pub fn search_entities_fts(
    conn: &Connection,
    query: &str,
    entity_type: Option<&str>,
    profile_id: &str,
    limit: usize,
) -> Result<Vec<EntitySearchResult>> {
    if let Some(t) = entity_type {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.entity_type, e.title, e.content, e.source_file, e.updated_at
             FROM fts_search f
             JOIN entities e ON f.entity_id = e.id
             WHERE fts_search MATCH ?1
               AND e.workspace_profile_id = ?2
               AND e.entity_type = ?3
             ORDER BY rank LIMIT ?4",
        )?;
        let rows = stmt.query_map(params![query, profile_id, t, limit as i64], |row| {
            Ok(EntitySearchResult {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                source_file: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        return rows.collect();
    }

    let mut stmt = conn.prepare(
        "SELECT e.id, e.entity_type, e.title, e.content, e.source_file, e.updated_at
         FROM fts_search f
         JOIN entities e ON f.entity_id = e.id
         WHERE fts_search MATCH ?1 AND e.workspace_profile_id = ?2
         ORDER BY rank LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![query, profile_id, limit as i64], |row| {
        Ok(EntitySearchResult {
            id: row.get(0)?,
            entity_type: row.get(1)?,
            title: row.get(2)?,
            content: row.get(3)?,
            source_file: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

/// Get a config value from app_config
pub fn get_app_config(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM app_config WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

/// Set a config value in app_config (upsert)
pub fn set_app_config(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO app_config (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
        params![key, value],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn insert_llm_run(
    conn: &Connection,
    workspace_profile_id: Option<&str>,
    provider: Option<&str>,
    model: &str,
    request_kind: &str,
    status: &str,
    latency_ms: Option<i64>,
    token_count_input: Option<i64>,
    token_count_output: Option<i64>,
    cost_usd: Option<f64>,
    trace_id: Option<&str>,
    metadata_json: Option<&str>,
) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO llm_runs (
            id, workspace_profile_id, provider, model, request_kind, status,
            latency_ms, token_count_input, token_count_output, cost_usd, trace_id, metadata_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            id,
            workspace_profile_id,
            provider,
            model,
            request_kind,
            status,
            latency_ms,
            token_count_input,
            token_count_output,
            cost_usd,
            trace_id,
            metadata_json,
        ],
    )?;
    Ok(id)
}

#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn insert_retrieval_feedback(
    conn: &Connection,
    workspace_profile_id: Option<&str>,
    query: &str,
    selected_result_id: Option<&str>,
    selected_result_type: Option<&str>,
    relevance_label: Option<&str>,
    trace_id: Option<&str>,
    metadata_json: Option<&str>,
) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO retrieval_feedback (
            id, workspace_profile_id, query, selected_result_id, selected_result_type,
            relevance_label, trace_id, metadata_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            workspace_profile_id,
            query,
            selected_result_id,
            selected_result_type,
            relevance_label,
            trace_id,
            metadata_json,
        ],
    )?;
    Ok(id)
}

pub fn insert_app_audit_log(
    conn: &Connection,
    event_type: &str,
    actor: Option<&str>,
    trace_id: Option<&str>,
    details_json: Option<&str>,
) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO app_audit_log (id, event_type, actor, trace_id, details_json)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, event_type, actor, trace_id, details_json],
    )?;
    Ok(id)
}

pub fn list_recent_app_audit_logs(
    conn: &Connection,
    limit: usize,
) -> Result<Vec<AppAuditLogRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, event_type, actor, trace_id, details_json, created_at
         FROM app_audit_log
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit as i64], |row| {
        Ok(AppAuditLogRow {
            id: row.get(0)?,
            event_type: row.get(1)?,
            actor: row.get(2)?,
            trace_id: row.get(3)?,
            details_json: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

// ─── Editor Layout ───────────────────────────────────────────────────

/// Save the editor layout for the active workspace profile (upsert).
pub fn save_editor_layout(conn: &Connection, profile_id: &str, layout_json: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO editor_layouts (workspace_profile_id, layout_json, updated_at)
         VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(workspace_profile_id) DO UPDATE SET
           layout_json = excluded.layout_json,
           updated_at = CURRENT_TIMESTAMP",
        params![profile_id, layout_json],
    )?;
    Ok(())
}

/// Get the saved editor layout for a workspace profile. Returns None if no layout was saved.
pub fn get_editor_layout(conn: &Connection, profile_id: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT layout_json FROM editor_layouts WHERE workspace_profile_id = ?1",
    )?;
    let mut rows = stmt.query(params![profile_id])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialize_creates_tables() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        // 11 tables + sqlite internal tables
        assert!(count >= 11);
    }

    #[test]
    fn test_initialize_idempotent() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        // Re-run schema creation — should not error
        conn.execute_batch(SCHEMA_SQL).unwrap();
    }

    #[test]
    fn test_get_active_profile_id() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let profile_id = get_active_profile_id(&conn).unwrap();
        assert!(profile_id.is_some());
    }

    #[test]
    fn test_get_active_profile_watched_directories_parses_json_and_lines() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let profile_id = get_active_profile_id(&conn).unwrap().unwrap();

        conn.execute(
            "UPDATE workspace_profiles SET watched_directories = ?1 WHERE id = ?2",
            params![r#"["/tmp/a","/tmp/b"]"#, profile_id],
        )
        .unwrap();
        let dirs = get_active_profile_watched_directories(&conn)
            .unwrap()
            .unwrap();
        assert_eq!(dirs, vec!["/tmp/a".to_string(), "/tmp/b".to_string()]);

        conn.execute(
            "UPDATE workspace_profiles SET watched_directories = ?1 WHERE id = ?2",
            params!["/tmp/c\n/tmp/d", profile_id],
        )
        .unwrap();
        let dirs = get_active_profile_watched_directories(&conn)
            .unwrap()
            .unwrap();
        assert_eq!(dirs, vec!["/tmp/c".to_string(), "/tmp/d".to_string()]);
    }

    #[test]
    fn test_insert_app_audit_log() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let id = insert_app_audit_log(
            &conn,
            "remote_access.enabled",
            Some("system"),
            Some("trace-1"),
            Some(r#"{"enabled":true}"#),
        )
        .unwrap();
        assert!(!id.is_empty());

        let event_type: String = conn
            .query_row(
                "SELECT event_type FROM app_audit_log WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(event_type, "remote_access.enabled");
    }

    #[test]
    fn test_list_recent_app_audit_logs() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        insert_app_audit_log(&conn, "event.one", Some("a"), None, None).unwrap();
        insert_app_audit_log(&conn, "event.two", Some("b"), None, None).unwrap();

        let logs = list_recent_app_audit_logs(&conn, 1).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].event_type, "event.two");
    }

    #[test]
    fn test_file_index_crud() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let profile_id = get_active_profile_id(&conn).unwrap().unwrap();

        // Initially no hash
        let hash = get_file_hash(&conn, "src/main.rs", &profile_id).unwrap();
        assert!(hash.is_none());

        // Upsert
        upsert_file_index(&conn, "src/main.rs", &profile_id, "abc123", "rust", 5, 1024).unwrap();
        let hash = get_file_hash(&conn, "src/main.rs", &profile_id).unwrap();
        assert_eq!(hash.as_deref(), Some("abc123"));

        // Update with new hash
        upsert_file_index(&conn, "src/main.rs", &profile_id, "def456", "rust", 7, 2048).unwrap();
        let hash = get_file_hash(&conn, "src/main.rs", &profile_id).unwrap();
        assert_eq!(hash.as_deref(), Some("def456"));

        // Delete
        delete_file_index(&conn, "src/main.rs", &profile_id).unwrap();
        let hash = get_file_hash(&conn, "src/main.rs", &profile_id).unwrap();
        assert!(hash.is_none());
    }

    #[test]
    fn test_delete_file_index_nonexistent() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let profile_id = get_active_profile_id(&conn).unwrap().unwrap();
        // Should succeed even if the file doesn't exist
        delete_file_index(&conn, "nonexistent.rs", &profile_id).unwrap();
    }

    #[test]
    fn test_entity_upsert_and_query() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let profile_id = get_active_profile_id(&conn).unwrap().unwrap();

        let metadata = r#"{"start_line": 10, "end_line": 20}"#;
        upsert_entity(&conn, "function", "my_func", "src/lib.rs", &profile_id, metadata).unwrap();

        // Verify it was inserted
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM entities WHERE source_file = 'src/lib.rs'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);

        // Upsert again with updated metadata — should update, not duplicate
        let new_metadata = r#"{"start_line": 10, "end_line": 25}"#;
        upsert_entity(&conn, "function", "my_func", "src/lib.rs", &profile_id, new_metadata).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM entities WHERE source_file = 'src/lib.rs'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);

        // Verify metadata was updated
        let stored: String = conn
            .query_row(
                "SELECT metadata FROM entities WHERE source_file = 'src/lib.rs' AND title = 'my_func'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(stored.contains("25"));
    }

    #[test]
    fn test_delete_entities_by_source_file() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let profile_id = get_active_profile_id(&conn).unwrap().unwrap();

        // Insert two entities for the same file
        upsert_entity(&conn, "function", "func_a", "src/lib.rs", &profile_id, "{}").unwrap();
        upsert_entity(&conn, "class", "MyClass", "src/lib.rs", &profile_id, "{}").unwrap();
        // Insert one entity for a different file
        upsert_entity(&conn, "function", "other_func", "src/other.rs", &profile_id, "{}").unwrap();

        let deleted = delete_entities_by_source_file(&conn, "src/lib.rs").unwrap();
        assert_eq!(deleted, 2);

        // other.rs entity should still exist
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM entities WHERE source_file = 'src/other.rs'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_insert_terminal_command() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let profile_id = get_active_profile_id(&conn).unwrap().unwrap();

        let id = insert_terminal_command(
            &conn,
            &profile_id,
            "ls -la",
            Some("/home/user"),
            Some(0),
            Some(150),
            Some("total 0"),
        )
        .unwrap();
        assert!(!id.is_empty());

        // Verify inserted
        let command: String = conn
            .query_row(
                "SELECT command FROM terminal_commands WHERE id = ?1",
                rusqlite::params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(command, "ls -la");
    }

    #[test]
    fn test_delete_entities_nonexistent_file() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let deleted = delete_entities_by_source_file(&conn, "nonexistent.rs").unwrap();
        assert_eq!(deleted, 0);
    }

    // ─── Note CRUD tests ────────────────────────────────────────────

    #[test]
    fn test_create_note_returns_valid_row() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let note = create_note(&conn, "My Note", "Hello world", &pid).unwrap();
        assert!(!note.id.is_empty());
        assert_eq!(note.title, "My Note");
        assert_eq!(note.content, "Hello world");
    }

    #[test]
    fn test_get_note_by_id() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let note = create_note(&conn, "Test", "Content", &pid).unwrap();
        let fetched = get_note(&conn, &note.id).unwrap().unwrap();
        assert_eq!(fetched.id, note.id);
        assert_eq!(fetched.title, "Test");
    }

    #[test]
    fn test_get_note_nonexistent() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let result = get_note(&conn, "nonexistent").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_list_notes() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        create_note(&conn, "Note A", "a", &pid).unwrap();
        create_note(&conn, "Note B", "b", &pid).unwrap();
        let notes = list_notes(&conn, &pid).unwrap();
        assert_eq!(notes.len(), 2);
    }

    #[test]
    fn test_update_note() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let note = create_note(&conn, "Old Title", "old", &pid).unwrap();
        let updated = update_note(&conn, &note.id, "New Title", "new content").unwrap();
        assert!(updated);
        let fetched = get_note(&conn, &note.id).unwrap().unwrap();
        assert_eq!(fetched.title, "New Title");
        assert_eq!(fetched.content, "new content");
    }

    #[test]
    fn test_update_note_nonexistent() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let updated = update_note(&conn, "fake-id", "t", "c").unwrap();
        assert!(!updated);
    }

    #[test]
    fn test_delete_note() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let note = create_note(&conn, "To Delete", "bye", &pid).unwrap();
        let deleted = delete_note(&conn, &note.id).unwrap();
        assert!(deleted);
        assert!(get_note(&conn, &note.id).unwrap().is_none());
    }

    #[test]
    fn test_delete_note_nonexistent() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let deleted = delete_note(&conn, "fake").unwrap();
        assert!(!deleted);
    }

    // ─── Task CRUD tests ────────────────────────────────────────────

    #[test]
    fn test_create_task_returns_valid_row() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let task = create_task(&conn, "My Task", Some("details"), "high", &pid, None).unwrap();
        assert!(!task.id.is_empty());
        assert_eq!(task.title, "My Task");
        assert_eq!(task.status, "todo");
        assert_eq!(task.priority, "high");
        assert!(task.completed_at.is_none());
        assert_eq!(task.source_type.as_deref(), Some("manual"));
    }

    #[test]
    fn test_create_task_with_source_type() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let task = create_task(&conn, "Auto Task", None, "low", &pid, Some("note")).unwrap();
        assert_eq!(task.source_type.as_deref(), Some("note"));

        let task2 = create_task(&conn, "Code Task", None, "medium", &pid, Some("code_comment")).unwrap();
        assert_eq!(task2.source_type.as_deref(), Some("code_comment"));

        let task3 = create_task(&conn, "Term Task", None, "high", &pid, Some("terminal")).unwrap();
        assert_eq!(task3.source_type.as_deref(), Some("terminal"));
    }

    #[test]
    fn test_get_task_by_id() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let task = create_task(&conn, "Fetch Me", None, "medium", &pid, None).unwrap();
        let fetched = get_task(&conn, &task.id).unwrap().unwrap();
        assert_eq!(fetched.id, task.id);
        assert_eq!(fetched.title, "Fetch Me");
    }

    #[test]
    fn test_get_task_nonexistent() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        assert!(get_task(&conn, "nope").unwrap().is_none());
    }

    #[test]
    fn test_list_tasks_all() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        create_task(&conn, "A", None, "low", &pid, None).unwrap();
        create_task(&conn, "B", None, "high", &pid, None).unwrap();
        let tasks = list_tasks(&conn, &pid, None).unwrap();
        assert_eq!(tasks.len(), 2);
        // High priority should come first
        assert_eq!(tasks[0].priority, "high");
    }

    #[test]
    fn test_list_tasks_source_type_preserved() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        create_task(&conn, "Manual", None, "medium", &pid, None).unwrap();
        create_task(&conn, "From Note", None, "medium", &pid, Some("note")).unwrap();
        let tasks = list_tasks(&conn, &pid, None).unwrap();
        assert_eq!(tasks.len(), 2);
        let manual = tasks.iter().find(|t| t.title == "Manual").unwrap();
        assert_eq!(manual.source_type.as_deref(), Some("manual"));
        let note = tasks.iter().find(|t| t.title == "From Note").unwrap();
        assert_eq!(note.source_type.as_deref(), Some("note"));
    }

    #[test]
    fn test_list_tasks_with_status_filter() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let t = create_task(&conn, "A", None, "medium", &pid, None).unwrap();
        create_task(&conn, "B", None, "medium", &pid, None).unwrap();
        update_task(&conn, &t.id, "A", None, "done", "medium", None, None).unwrap();

        let done = list_tasks(&conn, &pid, Some("done")).unwrap();
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].title, "A");

        let todo = list_tasks(&conn, &pid, Some("todo")).unwrap();
        assert_eq!(todo.len(), 1);
        assert_eq!(todo[0].title, "B");
    }

    #[test]
    fn test_update_task_sets_completed_at_on_done() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let task = create_task(&conn, "Complete Me", None, "medium", &pid, None).unwrap();
        assert!(task.completed_at.is_none());

        update_task(&conn, &task.id, "Complete Me", None, "done", "medium", None, None).unwrap();
        let updated = get_task(&conn, &task.id).unwrap().unwrap();
        assert_eq!(updated.status, "done");
        assert!(updated.completed_at.is_some());
    }

    #[test]
    fn test_update_task_clears_completed_at_on_undone() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let task = create_task(&conn, "T", None, "medium", &pid, None).unwrap();
        update_task(&conn, &task.id, "T", None, "done", "medium", None, None).unwrap();
        update_task(&conn, &task.id, "T", None, "todo", "medium", None, None).unwrap();
        let t = get_task(&conn, &task.id).unwrap().unwrap();
        assert_eq!(t.status, "todo");
        assert!(t.completed_at.is_none());
    }

    #[test]
    fn test_update_task_nonexistent() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let updated = update_task(&conn, "fake", "t", None, "todo", "low", None, None).unwrap();
        assert!(!updated);
    }

    #[test]
    fn test_delete_task() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let task = create_task(&conn, "Bye", None, "low", &pid, None).unwrap();
        assert!(delete_task(&conn, &task.id).unwrap());
        assert!(get_task(&conn, &task.id).unwrap().is_none());
    }

    #[test]
    fn test_find_task_by_title_match() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        create_task(&conn, "Fix login bug", None, "high", &pid, Some("note")).unwrap();
        let found = find_task_by_title(&conn, "Fix login bug", &pid).unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().title, "Fix login bug");
    }

    #[test]
    fn test_find_task_by_title_miss() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        create_task(&conn, "Other task", None, "low", &pid, None).unwrap();
        let found = find_task_by_title(&conn, "Nonexistent task", &pid).unwrap();
        assert!(found.is_none());
    }

    // ─── Entity Link tests ──────────────────────────────────────────

    #[test]
    fn test_create_and_list_entity_links() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let n1 = create_note(&conn, "Note1", "a", &pid).unwrap();
        let n2 = create_note(&conn, "Note2", "b", &pid).unwrap();

        let link = create_entity_link(&conn, &n1.id, &n2.id, "references", false, Some("see also")).unwrap();
        assert_eq!(link.source_entity_id, n1.id);
        assert_eq!(link.target_entity_id, n2.id);
        assert_eq!(link.relationship_type, "references");
        assert!(!link.auto_generated);

        // List from source side
        let links = list_entity_links(&conn, &n1.id).unwrap();
        assert_eq!(links.len(), 1);

        // List from target side
        let links = list_entity_links(&conn, &n2.id).unwrap();
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn test_entity_link_upsert() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let n1 = create_note(&conn, "A", "a", &pid).unwrap();
        let n2 = create_note(&conn, "B", "b", &pid).unwrap();

        create_entity_link(&conn, &n1.id, &n2.id, "related", false, Some("ctx1")).unwrap();
        // Same source+target+type should upsert
        let link2 = create_entity_link(&conn, &n1.id, &n2.id, "related", true, Some("ctx2")).unwrap();
        assert_eq!(link2.context.as_deref(), Some("ctx2"));

        let links = list_entity_links(&conn, &n1.id).unwrap();
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn test_delete_entity_link() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let n1 = create_note(&conn, "A", "a", &pid).unwrap();
        let n2 = create_note(&conn, "B", "b", &pid).unwrap();
        let link = create_entity_link(&conn, &n1.id, &n2.id, "ref", false, None).unwrap();

        assert!(delete_entity_link(&conn, &link.id).unwrap());
        assert!(!delete_entity_link(&conn, &link.id).unwrap()); // already deleted
        let links = list_entity_links(&conn, &n1.id).unwrap();
        assert!(links.is_empty());
    }

    #[test]
    fn test_cascade_delete_links_on_entity_delete() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let n1 = create_note(&conn, "A", "a", &pid).unwrap();
        let n2 = create_note(&conn, "B", "b", &pid).unwrap();
        create_entity_link(&conn, &n1.id, &n2.id, "ref", false, None).unwrap();

        delete_note(&conn, &n1.id).unwrap();
        let links = list_entity_links(&conn, &n2.id).unwrap();
        assert!(links.is_empty());
    }

    // ─── Entity Search tests ────────────────────────────────────────

    #[test]
    fn test_search_entities_by_title() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        create_note(&conn, "Rust patterns", "content", &pid).unwrap();
        create_note(&conn, "Python tips", "content", &pid).unwrap();

        let results = search_entities(&conn, "Rust", None, &pid, 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Rust patterns");
    }

    #[test]
    fn test_search_entities_by_content() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        create_note(&conn, "Note", "The quick brown fox", &pid).unwrap();

        let results = search_entities(&conn, "brown fox", None, &pid, 10).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_search_entities_with_type_filter() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        create_note(&conn, "Search Note", "content", &pid).unwrap();
        create_task(&conn, "Search Task", Some("content"), "medium", &pid, None).unwrap();

        let notes = search_entities(&conn, "Search", Some("note"), &pid, 10).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].entity_type, "note");

        let tasks = search_entities(&conn, "Search", Some("task"), &pid, 10).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].entity_type, "task");
    }

    #[test]
    fn test_search_entities_respects_limit() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        for i in 0..5 {
            create_note(&conn, &format!("Note {}", i), "common keyword", &pid).unwrap();
        }
        let results = search_entities(&conn, "common", None, &pid, 3).unwrap();
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_search_entities_no_match() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        create_note(&conn, "Hello", "world", &pid).unwrap();
        let results = search_entities(&conn, "zzzzz", None, &pid, 10).unwrap();
        assert!(results.is_empty());
    }

    // ─── Auto-linking query tests ──────────────────────────────────────

    #[test]
    fn test_list_entity_titles() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        create_note(&conn, "NoteA", "a", &pid).unwrap();
        create_task(&conn, "TaskB", None, "medium", &pid, None).unwrap();
        let titles = list_entity_titles(&conn, &pid).unwrap();
        assert_eq!(titles.len(), 2);
        let names: Vec<&str> = titles.iter().map(|(_, t, _)| t.as_str()).collect();
        assert!(names.contains(&"NoteA"));
        assert!(names.contains(&"TaskB"));
    }

    #[test]
    fn test_find_entities_by_title() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        create_note(&conn, "SearchPanel", "component", &pid).unwrap();
        create_note(&conn, "OtherPanel", "different", &pid).unwrap();
        let results = find_entities_by_title(&conn, "SearchPanel", &pid).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].1, "note");
    }

    #[test]
    fn test_find_entities_by_title_no_match() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let results = find_entities_by_title(&conn, "Nonexistent", &pid).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_find_entities_by_source_file() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        upsert_entity(&conn, "function", "my_func", "src/lib.rs", &pid, "{}").unwrap();
        upsert_entity(&conn, "class", "MyClass", "src/lib.rs", &pid, "{}").unwrap();
        let results = find_entities_by_source_file(&conn, "src/lib.rs").unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_list_suggested_links() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let n1 = create_note(&conn, "A", "a", &pid).unwrap();
        let n2 = create_note(&conn, "B", "b", &pid).unwrap();
        let n3 = create_note(&conn, "C", "c", &pid).unwrap();

        // Auto-generated link with confidence 0.9
        create_entity_link(&conn, &n1.id, &n2.id, "references", true, Some("ctx")).unwrap();
        // Manual link
        create_entity_link(&conn, &n1.id, &n3.id, "related", false, None).unwrap();

        let suggested = list_suggested_links(&conn, &n1.id, 0.5).unwrap();
        assert_eq!(suggested.len(), 1);
        assert!(suggested[0].auto_generated);
    }

    #[test]
    fn test_confirm_entity_link() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let n1 = create_note(&conn, "A", "a", &pid).unwrap();
        let n2 = create_note(&conn, "B", "b", &pid).unwrap();
        let link = create_entity_link(&conn, &n1.id, &n2.id, "references", true, None).unwrap();
        assert!(link.auto_generated);

        let confirmed = confirm_entity_link(&conn, &link.id).unwrap();
        assert!(confirmed);

        // Now it should not appear in suggested links
        let suggested = list_suggested_links(&conn, &n1.id, 0.0).unwrap();
        assert!(suggested.is_empty());
    }

    #[test]
    fn test_confirm_entity_link_nonexistent() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let confirmed = confirm_entity_link(&conn, "fake-id").unwrap();
        assert!(!confirmed);
    }

    #[test]
    fn test_list_entity_links_with_details() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let n1 = create_note(&conn, "NoteA", "content a", &pid).unwrap();
        let n2 = create_note(&conn, "NoteB", "content b", &pid).unwrap();
        create_entity_link(&conn, &n1.id, &n2.id, "references", true, Some("see also")).unwrap();

        // From n1's perspective
        let details = list_entity_links_with_details(&conn, &n1.id).unwrap();
        assert_eq!(details.len(), 1);
        assert_eq!(details[0].linked_entity_id, n2.id);
        assert_eq!(details[0].linked_entity_title, "NoteB");
        assert_eq!(details[0].linked_entity_type, "note");
        assert_eq!(details[0].direction, "outgoing");
        assert!(details[0].auto_generated);

        // From n2's perspective
        let details = list_entity_links_with_details(&conn, &n2.id).unwrap();
        assert_eq!(details.len(), 1);
        assert_eq!(details[0].linked_entity_id, n1.id);
        assert_eq!(details[0].linked_entity_title, "NoteA");
        assert_eq!(details[0].direction, "incoming");
    }

    // ─── count_suggested_links tests ─────────────────────────────────

    #[test]
    fn test_count_suggested_links_counts_mid_confidence() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let n1 = create_note(&conn, "A", "a", &pid).unwrap();
        let n2 = create_note(&conn, "B", "b", &pid).unwrap();
        let n3 = create_note(&conn, "C", "c", &pid).unwrap();
        let n4 = create_note(&conn, "D", "d", &pid).unwrap();

        // Mid-confidence auto link (should be counted)
        create_entity_link_with_confidence(&conn, &n1.id, &n2.id, "references", 0.75, true, None).unwrap();
        // High-confidence auto link (should NOT be counted - >= 0.85)
        create_entity_link_with_confidence(&conn, &n1.id, &n3.id, "references", 0.90, true, None).unwrap();
        // Manual link (should NOT be counted)
        create_entity_link(&conn, &n1.id, &n4.id, "related", false, None).unwrap();

        let count = count_suggested_links(&conn, &pid).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_count_suggested_links_empty() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let count = count_suggested_links(&conn, &pid).unwrap();
        assert_eq!(count, 0);
    }

    // ─── get_task_lineages tests ─────────────────────────────────────

    #[test]
    fn test_get_task_lineages_with_lineage() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let note = create_note(&conn, "My Note", "content", &pid).unwrap();
        let task = create_task(&conn, "Fix bug", Some("from note"), "medium", &pid, Some("note")).unwrap();

        // Create contains_task link from note to task
        create_entity_link(&conn, &note.id, &task.id, "contains_task", true, None).unwrap();

        let lineages = get_task_lineages(&conn, std::slice::from_ref(&task.id)).unwrap();
        assert_eq!(lineages.len(), 1);
        assert_eq!(lineages[0].task_id, task.id);
        assert_eq!(lineages[0].source_entity_id, note.id);
        assert_eq!(lineages[0].source_entity_title, "My Note");
        assert_eq!(lineages[0].source_entity_type, "note");
    }

    #[test]
    fn test_get_task_lineages_without_lineage() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let task = create_task(&conn, "Manual task", None, "medium", &pid, None).unwrap();

        let lineages = get_task_lineages(&conn, std::slice::from_ref(&task.id)).unwrap();
        assert!(lineages.is_empty());
    }

    #[test]
    fn test_editor_layout_save_and_get() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();

        // Initially no layout
        let layout = get_editor_layout(&conn, &pid).unwrap();
        assert!(layout.is_none());

        // Save layout
        let json = r#"{"type":"pane","id":"pane-1","tabs":[],"activeTabIndex":0}"#;
        save_editor_layout(&conn, &pid, json).unwrap();

        // Get it back
        let layout = get_editor_layout(&conn, &pid).unwrap();
        assert_eq!(layout.as_deref(), Some(json));
    }

    #[test]
    fn test_editor_layout_upsert() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();

        let json1 = r#"{"type":"pane","id":"pane-1","tabs":[]}"#;
        save_editor_layout(&conn, &pid, json1).unwrap();

        let json2 = r#"{"type":"split","id":"split-1","children":[]}"#;
        save_editor_layout(&conn, &pid, json2).unwrap();

        let layout = get_editor_layout(&conn, &pid).unwrap();
        assert_eq!(layout.as_deref(), Some(json2));
    }
}
