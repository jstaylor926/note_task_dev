use rusqlite::{Connection, Result};
use std::path::Path;
use uuid::Uuid;

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
}
