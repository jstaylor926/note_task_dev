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
            let dirs: Vec<String> = serde_json::from_str(&json_str).unwrap_or_default();
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
pub fn create_task(conn: &Connection, title: &str, content: Option<&str>, priority: &str, profile_id: &str) -> Result<TaskRow> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO entities (id, entity_type, title, content, workspace_profile_id)
         VALUES (?1, 'task', ?2, ?3, ?4)",
        params![id, title, content, profile_id],
    )?;
    conn.execute(
        "INSERT INTO tasks (entity_id, status, priority, workspace_profile_id)
         VALUES (?1, 'todo', ?2, ?3)",
        params![id, priority, profile_id],
    )?;
    get_task(conn, &id)?.ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
}

/// Get a single task by entity ID (joins entities + tasks).
pub fn get_task(conn: &Connection, id: &str) -> Result<Option<TaskRow>> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.title, e.content, t.status, t.priority, t.due_date,
                t.assigned_to, t.completed_at, e.created_at, e.updated_at
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
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
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
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    }

    if let Some(status) = status_filter {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.title, e.content, t.status, t.priority, t.due_date,
                    t.assigned_to, t.completed_at, e.created_at, e.updated_at
             FROM entities e JOIN tasks t ON e.id = t.entity_id
             WHERE e.entity_type = 'task' AND e.workspace_profile_id = ?1 AND t.status = ?2
             ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, e.created_at DESC"
        )?;
        let result = stmt.query_map(params![profile_id, status], read_task_row)?.collect();
        result
    } else {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.title, e.content, t.status, t.priority, t.due_date,
                    t.assigned_to, t.completed_at, e.created_at, e.updated_at
             FROM entities e JOIN tasks t ON e.id = t.entity_id
             WHERE e.entity_type = 'task' AND e.workspace_profile_id = ?1
             ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, e.created_at DESC"
        )?;
        let result = stmt.query_map(params![profile_id], read_task_row)?.collect();
        result
    }
}

/// Update a task's fields. Sets completed_at when status='done'. Returns true if updated.
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
        let task = create_task(&conn, "My Task", Some("details"), "high", &pid).unwrap();
        assert!(!task.id.is_empty());
        assert_eq!(task.title, "My Task");
        assert_eq!(task.status, "todo");
        assert_eq!(task.priority, "high");
        assert!(task.completed_at.is_none());
    }

    #[test]
    fn test_get_task_by_id() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let task = create_task(&conn, "Fetch Me", None, "medium", &pid).unwrap();
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
        create_task(&conn, "A", None, "low", &pid).unwrap();
        create_task(&conn, "B", None, "high", &pid).unwrap();
        let tasks = list_tasks(&conn, &pid, None).unwrap();
        assert_eq!(tasks.len(), 2);
        // High priority should come first
        assert_eq!(tasks[0].priority, "high");
    }

    #[test]
    fn test_list_tasks_with_status_filter() {
        let conn = initialize(Path::new(":memory:")).unwrap();
        let pid = get_active_profile_id(&conn).unwrap().unwrap();
        let t = create_task(&conn, "A", None, "medium", &pid).unwrap();
        create_task(&conn, "B", None, "medium", &pid).unwrap();
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
        let task = create_task(&conn, "Complete Me", None, "medium", &pid).unwrap();
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
        let task = create_task(&conn, "T", None, "medium", &pid).unwrap();
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
        let task = create_task(&conn, "Bye", None, "low", &pid).unwrap();
        assert!(delete_task(&conn, &task.id).unwrap());
        assert!(get_task(&conn, &task.id).unwrap().is_none());
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
        create_task(&conn, "Search Task", Some("content"), "medium", &pid).unwrap();

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
        create_task(&conn, "TaskB", None, "medium", &pid).unwrap();
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
}
