# Data Schema

> This document defines the complete data model for both the relational layer (SQLite) and the vector layer (LanceDB). It is the source of truth for storage design. Future iterations should update this document when adding new tables, columns, or collections, and should note migration strategies for schema changes.

---

## Storage Architecture

The system uses a hybrid storage model:

- **SQLite (WAL mode):** Manages all deterministic, structured state — session payloads, entity graph, task metadata, chat history, terminal logs, git events, and file indexing metadata.
- **LanceDB (embedded):** Manages all vector embeddings — code chunks, note chunks, terminal output chunks, chat message embeddings. Each workspace profile gets its own LanceDB table for isolation.

Both databases are stored as local files in the application's data directory (e.g., `~/.config/app-name/` on Linux, `~/Library/Application Support/app-name/` on macOS).

---

## SQLite Schema

### workspace_profiles

Defines isolated work contexts with their own watched directories, LLM routing rules, and session history.

```sql
CREATE TABLE workspace_profiles (
    id TEXT PRIMARY KEY,                    -- UUID v4
    name TEXT NOT NULL UNIQUE,              -- Human-readable name ("Thesis Research", "Work — Digital Solutions")
    watched_directories TEXT NOT NULL,      -- JSON array of absolute directory paths
    llm_routing_overrides TEXT,             -- JSON: per-profile routing rules (e.g., block cloud APIs for work profile)
    system_prompt_additions TEXT,           -- Custom text appended to LLM system prompts for this profile
    default_model TEXT,                     -- Default LLM model identifier for this profile
    embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',  -- Embedding model for this profile's vector collection
    is_active BOOLEAN DEFAULT FALSE,        -- Only one profile active at a time
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_profiles_active ON workspace_profiles(is_active);
```

**Open questions:**
- Should profiles support inheritance (e.g., "base" profile with shared settings)?
- Should `watched_directories` support glob patterns or recursive depth limits?

---

### session_states

Stores the compressed context payloads captured on session exit and periodic snapshots. These are the core of the session handoff feature.

```sql
CREATE TABLE session_states (
    id TEXT PRIMARY KEY,                    -- UUID v4
    workspace_profile_id TEXT NOT NULL REFERENCES workspace_profiles(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,                  -- JSON: full session state object (see payload schema below)
    trigger TEXT NOT NULL DEFAULT 'exit',   -- What triggered this capture: 'exit', 'periodic', 'manual', 'profile_switch'
    duration_minutes INTEGER,              -- Session duration since last capture
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_profile ON session_states(workspace_profile_id, created_at DESC);
```

**Session State Payload Schema (JSON):**

```json
{
  "session_id": "uuid",
  "workspace_profile": "profile-name",
  "timestamp": "ISO-8601",
  "duration_minutes": 47,
  "focus": {
    "last_active_file": "relative/path/to/file.py",
    "last_cursor_position": { "line": 142, "col": 8 },
    "open_files": ["file1.py", "file2.py"],
    "active_terminal_cwd": "/absolute/path",
    "active_git_branch": "branch-name"
  },
  "context": {
    "recent_file_edits": [
      { "file": "path", "summary": "LLM-generated summary", "lines_changed": 34 }
    ],
    "recent_terminal_commands": [
      { "command": "string", "exit_code": 0, "stderr_summary": "string or null" }
    ],
    "recent_notes": [
      { "id": "entity-uuid", "title": "string", "snippet": "first 200 chars" }
    ],
    "active_chat_summary": "LLM-generated summary of recent chat thread"
  },
  "state": {
    "blockers": ["string"],
    "next_steps": ["string"],
    "git_status": {
      "branch": "string",
      "uncommitted_changes": 3,
      "ahead_of_main": 7
    }
  }
}
```

**Open questions:**
- What's the retention policy for old session states? Options: keep forever, keep last N per profile, age out after N days.
- Should the `blockers` and `next_steps` fields be editable by the user (manual override of LLM-generated content)?

---

### entities

The universal entity table for the knowledge graph. Every indexed artifact — code unit, note, task, git event, experiment, reference, chat thread, terminal session — is an entity.

```sql
CREATE TABLE entities (
    id TEXT PRIMARY KEY,                    -- UUID v4
    entity_type TEXT NOT NULL,              -- Enum: CodeUnit, Note, Task, GitEvent, Experiment, Reference, ChatThread, TerminalSession
    title TEXT NOT NULL,                    -- Display name (function name, note title, commit message, etc.)
    content TEXT,                           -- Full text content (for notes, chat messages; NULL for code units that reference source files)
    metadata TEXT,                          -- JSON: type-specific fields (see metadata schemas below)
    source_file TEXT,                       -- Absolute file path if applicable (NULL for chat, terminal sessions)
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_profile ON entities(workspace_profile_id);
CREATE INDEX idx_entities_source ON entities(source_file);
CREATE INDEX idx_entities_updated ON entities(updated_at DESC);
```

**Entity Metadata Schemas by Type:**

```json
// CodeUnit
{
  "language": "python",
  "kind": "function",           // function, class, method, module
  "signature": "def forward(self, x: Tensor) -> Tensor",
  "start_line": 45,
  "end_line": 89,
  "imports": ["torch", "torch.nn"],
  "git_branch": "feature/attention"
}

// Note
{
  "format": "markdown",
  "word_count": 450,
  "tags": ["attention", "thesis"],     // auto-extracted
  "headings": ["Introduction", "Method", "Results"]
}

// Task (supplemented by tasks table)
{
  "source_text": "Need to implement gradient accumulation",
  "extraction_confidence": 0.92
}

// GitEvent
{
  "event_type": "commit",
  "commit_hash": "abc123def",
  "author": "JT",
  "files_changed": ["train.py", "config.yaml"],
  "insertions": 34,
  "deletions": 12
}

// Experiment
{
  "run_id": "run-042",
  "framework": "pytorch",
  "metrics": { "loss": 0.234, "accuracy": 0.891 },
  "hyperparameters": { "lr": 0.001, "batch_size": 32, "epochs": 50 },
  "duration_seconds": 3600,
  "status": "completed"
}

// Reference
{
  "ref_type": "arxiv",          // arxiv, url, book, doi
  "url": "https://arxiv.org/abs/2401.12345",
  "authors": ["Author A", "Author B"],
  "year": 2024,
  "abstract_snippet": "First 200 chars of abstract"
}

// ChatThread
{
  "message_count": 15,
  "models_used": ["ollama/llama3:8b", "claude-sonnet-4-5-20250929"],
  "topic_summary": "Debugging CUDA OOM error in training loop"
}

// TerminalSession
{
  "shell": "zsh",
  "command_count": 12,
  "cwd": "/home/jt/projects/thesis",
  "duration_seconds": 1800
}
```

---

### entity_links

Bidirectional relationships between entities in the knowledge graph.

```sql
CREATE TABLE entity_links (
    id TEXT PRIMARY KEY,                    -- UUID v4
    source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,        -- See relationship types below
    confidence REAL DEFAULT 1.0,           -- 0.0 to 1.0 (1.0 = exact match, <0.7 = suggestion only)
    auto_generated BOOLEAN DEFAULT TRUE,   -- FALSE if user manually created/confirmed the link
    context TEXT,                           -- Optional: why this link exists ("mentioned in line 42", "co-occurred in session X")
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_links_source ON entity_links(source_entity_id);
CREATE INDEX idx_links_target ON entity_links(target_entity_id);
CREATE INDEX idx_links_type ON entity_links(relationship_type);
CREATE UNIQUE INDEX idx_links_unique ON entity_links(source_entity_id, target_entity_id, relationship_type);
```

**Relationship Types:**

| Type | Source → Target | Example |
|------|----------------|---------|
| `mentions` | Note → CodeUnit | Note discusses a function |
| `references` | Note → Reference | Note cites an ArXiv paper |
| `implements` | CodeUnit → Reference | Code implements a paper's algorithm |
| `blocked_by` | Task → any | Task is blocked by an error/issue |
| `targets` | Task → CodeUnit | Task targets a specific function/file |
| `triggered_by` | Experiment → TerminalSession | Experiment started by a terminal command |
| `uses_config` | Experiment → CodeUnit | Experiment uses a config file |
| `spawned_from` | Task → Note/ChatThread | Task was extracted from a note or chat |
| `co_occurred` | any → any | Entities active in the same session window |
| `depends_on` | CodeUnit → CodeUnit | Import/call dependency |
| `related_to` | any → any | Semantic similarity above threshold |

---

### tasks

Extended entity table for task-specific fields. Every task also has a row in the `entities` table.

```sql
CREATE TABLE tasks (
    entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'todo',            -- todo, in_progress, done, blocked, cancelled
    priority TEXT DEFAULT 'medium',        -- low, medium, high, critical
    due_date TIMESTAMP,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    source_type TEXT,                      -- note, commit, chat, terminal, manual
    assigned_to TEXT,                      -- Future: support for delegation
    completed_at TIMESTAMP
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_profile ON tasks(workspace_profile_id);
```

---

### chat_messages

Stores all AI chat interactions, scoped to workspace profiles.

```sql
CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,                    -- UUID v4
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    thread_id TEXT,                         -- Groups messages into conversation threads
    role TEXT NOT NULL,                     -- user, assistant, system
    content TEXT NOT NULL,
    model_used TEXT,                        -- LLM model identifier
    token_count_input INTEGER,
    token_count_output INTEGER,
    cost_usd REAL,
    latency_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chat_profile ON chat_messages(workspace_profile_id, created_at DESC);
CREATE INDEX idx_chat_thread ON chat_messages(thread_id, created_at ASC);
```

---

### terminal_commands

Logs every terminal command executed within the application.

```sql
CREATE TABLE terminal_commands (
    id TEXT PRIMARY KEY,                    -- UUID v4
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    session_entity_id TEXT REFERENCES entities(id),  -- Links to TerminalSession entity
    command TEXT NOT NULL,
    cwd TEXT,                              -- Working directory at time of execution
    exit_code INTEGER,
    stdout_preview TEXT,                   -- First N characters of stdout
    stderr_preview TEXT,                   -- First N characters of stderr
    stdout_size_bytes INTEGER,             -- Total stdout size (full output stored if under threshold)
    stderr_size_bytes INTEGER,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_terminal_profile ON terminal_commands(workspace_profile_id, created_at DESC);
CREATE INDEX idx_terminal_exit ON terminal_commands(exit_code);
```

---

### file_index

Tracks the indexing state of every watched file for differential updates.

```sql
CREATE TABLE file_index (
    file_path TEXT NOT NULL,               -- Absolute file path
    workspace_profile_id TEXT NOT NULL REFERENCES workspace_profiles(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,            -- SHA-256 of file contents
    language TEXT,                         -- Detected programming language
    chunk_count INTEGER,                   -- Number of chunks generated
    file_size_bytes INTEGER,
    last_indexed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (file_path, workspace_profile_id)
);

CREATE INDEX idx_fileindex_profile ON file_index(workspace_profile_id);
CREATE INDEX idx_fileindex_hash ON file_index(content_hash);
```

---

### git_events

Logs git activity detected via hooks or polling.

```sql
CREATE TABLE git_events (
    id TEXT PRIMARY KEY,                    -- UUID v4
    workspace_profile_id TEXT REFERENCES workspace_profiles(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,              -- commit, branch_create, branch_switch, branch_delete, merge, tag, push, pull
    repo_path TEXT,                         -- Repository root path
    ref_name TEXT,                         -- Branch or tag name
    commit_hash TEXT,
    parent_hashes TEXT,                    -- JSON array (for merge commits)
    message TEXT,                          -- Commit message or event description
    author TEXT,
    files_changed TEXT,                    -- JSON array of file paths
    insertions INTEGER,
    deletions INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_git_profile ON git_events(workspace_profile_id, created_at DESC);
CREATE INDEX idx_git_type ON git_events(event_type);
CREATE INDEX idx_git_branch ON git_events(ref_name);
```

---

### app_config

Application-wide settings that aren't workspace-profile-specific.

```sql
CREATE TABLE app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,                   -- JSON-encoded value
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Example entries:
-- ('theme', '"dark"')
-- ('sidecar_port', '9400')
-- ('periodic_snapshot_interval_minutes', '5')
-- ('max_stdout_capture_bytes', '10240')
-- ('embedding_batch_size', '32')
```

---

## LanceDB Schema

Each workspace profile gets its own LanceDB table, named `embeddings_{profile_id}`.

### Table Schema

```python
import lancedb
import pyarrow as pa

schema = pa.schema([
    pa.field("vector", pa.list_(pa.float32(), 384)),  # Embedding dimension (model-dependent)
    pa.field("text", pa.utf8()),                       # Original chunk text
    pa.field("source_type", pa.utf8()),                # code, note, terminal, chat
    pa.field("source_file", pa.utf8()),                # Absolute file path (nullable for non-file sources)
    pa.field("entity_id", pa.utf8()),                  # FK to SQLite entities table
    pa.field("chunk_type", pa.utf8()),                 # function, class, method, heading_section, command_output, message, etc.
    pa.field("chunk_index", pa.int32()),               # Position within the source file (for ordering)
    pa.field("language", pa.utf8()),                   # Programming language or 'markdown', 'plaintext'
    pa.field("git_branch", pa.utf8()),                 # Branch at time of indexing
    pa.field("token_count", pa.int32()),               # Approximate token count of the chunk
    pa.field("created_at", pa.utf8()),                 # ISO-8601 timestamp
    pa.field("updated_at", pa.utf8()),                 # ISO-8601 timestamp
])
```

### Indexing Strategy

- **On file change:** Re-embed only changed chunks (identified by comparing AST node hashes)
- **Batch processing:** Embed in batches of 32 chunks to optimize throughput
- **Metadata filtering:** Use LanceDB's `where` clause to filter by `source_type`, `language`, `git_branch` before vector similarity search
- **Hybrid search:** Combine vector similarity with keyword matching (LanceDB supports full-text search) for better recall

### Collection Naming

```
embeddings_{workspace_profile_id}
```

Example: `embeddings_550e8400-e29b-41d4-a716-446655440000`

---

## Migration Strategy

### Schema Versioning

```sql
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    description TEXT,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Migrations are numbered scripts (`001_initial.sql`, `002_add_thread_id.sql`, etc.) applied in order on startup. The application checks `schema_version` and applies any pending migrations.

### LanceDB Schema Changes

LanceDB tables can be recreated without data loss by re-indexing from source files (the file_index table tracks what needs re-embedding). For schema changes:
1. Create new table with updated schema
2. Re-index all files in the workspace profile
3. Drop old table

This is acceptable because re-indexing is an automated background process. For large codebases, it may take minutes — show progress in the UI.

---

## Open Questions for Future Iterations

- Should `entity_links` support weighted relationships (beyond confidence scores)?
- Should we add a `search_history` table to track what the user searches for (useful for improving search ranking)?
- Should `chat_messages` store the full context window sent to the LLM (for debugging/replay)?
- Should there be a `user_corrections` table to track when users correct auto-generated links (training data for improving the auto-linker)?
- What's the right `stdout_preview` length? 1 KB? 10 KB? Configurable?
- Should we store full stdout/stderr in LanceDB alongside the embedding, or only the preview in SQLite?
