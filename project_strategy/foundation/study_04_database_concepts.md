# Study Guide: Database Concepts — SQLite WAL, Graph Modeling, and Migrations

> This guide covers the database layer of the workspace: how SQLite stores structured data, what WAL mode does and why it matters, how a knowledge graph is modeled in relational tables, and how schema migrations keep the database evolving safely.

---

## 1. SQLite: An Embedded Database

### What "Embedded" Means

Most databases you've heard of — PostgreSQL, MySQL, MongoDB — run as **separate server processes**. Your application connects to them over a network socket or local socket. The database manages its own memory, disk I/O, and access control.

SQLite is different. It's a **library** that gets compiled directly into your application. There's no separate server process, no network protocol, no configuration files. The entire database is a single file on disk (e.g., `workspace.db`).

```
PostgreSQL model:
  App Process ──TCP socket──► Database Server Process ──► Disk

SQLite model:
  App Process (with SQLite linked in) ──► Single file on disk
```

### Why This Matters for the Project

- **Zero configuration:** No database server to install, configure, or manage. The app creates the database file on first launch.
- **Single file = portable:** The entire database can be backed up by copying one file. It can be moved between machines.
- **No network overhead:** Database reads and writes are direct disk I/O, not network round-trips.
- **Embedded in Rust:** The `rusqlite` crate links SQLite into the Tauri binary. Database access is a function call, not an HTTP request.

### SQLite's Limitations

- **Single writer:** Only one process (or thread) can write at a time. Multiple readers can read concurrently. This is addressed by WAL mode (next section).
- **No built-in user management:** There's no concept of database users, roles, or permissions. Access control is file-system-level (whoever can read the file can read the database).
- **Not for high-write-throughput:** If thousands of concurrent writes per second are needed, PostgreSQL is a better choice. For a solo developer's workspace app, this limit is never approached.

---

## 2. WAL Mode: Solving the Concurrency Problem

### The Default: Rollback Journal Mode

By default, SQLite uses a **rollback journal**. When you start a write transaction:

1. SQLite copies the original page content to a journal file (`workspace.db-journal`)
2. It modifies the database file directly
3. On commit, it deletes the journal file
4. On crash/rollback, it restores the original content from the journal

The problem: while a write transaction is active, **no one else can read or write**. The database is locked. For an app with background indexing, periodic session snapshots, and a UI that queries data for display, this creates contention.

### WAL (Write-Ahead Logging) Mode

WAL flips the model:

1. Writes go to a separate **WAL file** (`workspace.db-wal`) instead of modifying the database file directly
2. Readers read from the database file and check the WAL for any newer versions of the pages they need
3. Periodically, the WAL is **checkpointed** — its contents are merged back into the database file

```
Default mode:
  Writer locks database → readers must wait

WAL mode:
  Writer appends to WAL → readers read from database + WAL simultaneously
  No waiting (except writer-writer contention)
```

### Why WAL Matters for This Project

The workspace has multiple concurrent activities:

| Activity | Type | Frequency |
|----------|------|-----------|
| Background file indexing | Write (entities, file_index) | Every file change |
| Session state snapshots | Write (session_states) | Every 5 minutes |
| Terminal command logging | Write (terminal_commands) | Every command |
| Chat history | Write (chat_messages) | Every message |
| UI data display | Read (entities, tasks, etc.) | Constant |
| Semantic search | Read (entities, file_index) | On-demand |

Without WAL, background writes would intermittently block UI reads, causing visible lag. With WAL, readers and the single writer can operate concurrently. Note that WAL still enforces **single-writer** — if two threads try to write simultaneously, one will wait. The design handles this by batching background writes (embedding results, entity updates) and keeping transactions short, so write contention stays minimal.

### Crash Safety with WAL

If the app crashes mid-write:
1. Uncommitted changes are in the WAL file
2. On next database open, SQLite detects the incomplete transaction
3. It rolls back the uncommitted changes by ignoring the incomplete WAL entries
4. The database is left in the last consistent committed state

This is why session state snapshots every 5 minutes are crash-safe: each snapshot is a committed transaction. Even if the app crashes, the most recent committed snapshot survives.

---

## 3. Modeling a Knowledge Graph in SQL

### What Is a Knowledge Graph?

A knowledge graph is a network of **entities** (things) connected by **relationships** (how they relate). For example:

```
[Function: forward] ──implements──► [Paper: Attention Is All You Need]
[Note: attention_notes.md] ──mentions──► [Function: forward]
[Task: optimize attention] ──targets──► [Function: forward]
[Commit: abc123] ──modified──► [Function: forward]
```

Graph databases like Neo4j store this natively — nodes and edges are first-class primitives. But adding Neo4j would mean another server process, violating the local-first, zero-config philosophy.

### The Entity-Relationship Pattern in SQL

Instead, the knowledge graph is modeled with two tables:

**`entities` table:** Every thing is a row.
```sql
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,   -- CodeUnit, Note, Task, GitEvent, ...
    title TEXT NOT NULL,
    content TEXT,
    metadata TEXT,               -- JSON with type-specific fields
    source_file TEXT,
    ...
);
```

**`entity_links` table:** Every relationship is a row.
```sql
CREATE TABLE entity_links (
    id TEXT PRIMARY KEY,
    source_entity_id TEXT REFERENCES entities(id),
    target_entity_id TEXT REFERENCES entities(id),
    relationship_type TEXT,      -- mentions, implements, depends_on, ...
    confidence REAL,
    ...
);
```

This is sometimes called an **adjacency list** representation of a graph. Each link row represents one directed edge.

### Querying the Graph

**Find all entities related to a specific function:**
```sql
SELECT e.title, e.entity_type, el.relationship_type
FROM entity_links el
JOIN entities e ON e.id = el.source_entity_id
WHERE el.target_entity_id = 'uuid-of-forward-function'

UNION

SELECT e.title, e.entity_type, el.relationship_type
FROM entity_links el
JOIN entities e ON e.id = el.target_entity_id
WHERE el.source_entity_id = 'uuid-of-forward-function';
```

The `UNION` handles bidirectionality — finding links where the function is either the source or target.

**Find all tasks blocked by a specific entity:**
```sql
SELECT e.title, t.status, t.priority
FROM entity_links el
JOIN entities e ON e.id = el.source_entity_id
JOIN tasks t ON t.entity_id = e.id
WHERE el.target_entity_id = 'uuid-of-blocking-entity'
  AND el.relationship_type = 'blocked_by';
```

### Graph Traversal (Multi-Hop Queries)

"What notes mention functions that were modified in recent commits?"

This requires a multi-hop traversal:
```
Note ──mentions──► Function ◄──modified── Commit (recent)
```

In SQL:
```sql
SELECT DISTINCT n.title AS note_title, f.title AS function_name, g.message AS commit_message
FROM entities n
JOIN entity_links nl ON nl.source_entity_id = n.id AND nl.relationship_type = 'mentions'
JOIN entities f ON f.id = nl.target_entity_id AND f.entity_type = 'CodeUnit'
JOIN entity_links gl ON gl.target_entity_id = f.id AND gl.relationship_type = 'modified'
JOIN entities g ON g.id = gl.source_entity_id AND g.entity_type = 'GitEvent'
WHERE g.created_at > datetime('now', '-7 days');
```

This is where SQL-based graph modeling gets verbose compared to a graph database's Cypher query (`MATCH (n:Note)-[:mentions]->(f:Function)<-[:modified]-(c:Commit) WHERE c.date > ...`). But for the expected scale (tens of thousands of entities, not millions), SQL performance is fine.

---

## 4. JSON in SQLite: The Metadata Pattern

Several columns in the schema store JSON strings: `metadata`, `payload`, `watched_directories`, `files_changed`. This is a common pattern called **semi-structured data** — the column holds structured data, but the structure varies by row.

### Why JSON?

The `entities` table stores 8 different entity types. A CodeUnit's metadata includes `language`, `kind`, `signature`, `start_line`. A GitEvent's metadata includes `event_type`, `commit_hash`, `files_changed`. These fields are completely different.

Options:
1. **Separate tables per entity type:** 8 tables, complex joins. Already done for `tasks` (which extends `entities`).
2. **Wide table with nullable columns:** One table with every possible column. Lots of NULLs, hard to maintain.
3. **JSON column:** One `metadata` column that holds a JSON object. Each entity type stores its own structure.

Option 3 is the pragmatic choice for metadata that's frequently read but rarely queried by specific fields. SQLite 3.38+ has built-in JSON functions:

```sql
-- Find all Python functions
SELECT title FROM entities
WHERE entity_type = 'CodeUnit'
  AND json_extract(metadata, '$.language') = 'python'
  AND json_extract(metadata, '$.kind') = 'function';
```

### When NOT to Use JSON

Fields that are frequently filtered, sorted, or indexed should be proper columns. That's why `entity_type`, `title`, `source_file`, and `created_at` are columns, not JSON fields. You can create indexes on columns but not (easily) on JSON paths.

---

## 5. Indexes: Making Queries Fast

### What Is an Index?

An index is a data structure (typically a **B-tree**) that lets SQLite find rows matching a condition without scanning every row in the table.

Without an index on `entity_type`:
```sql
SELECT * FROM entities WHERE entity_type = 'CodeUnit';
-- SQLite must read EVERY row and check the type → O(n) time
```

With an index on `entity_type`:
```sql
CREATE INDEX idx_entities_type ON entities(entity_type);
SELECT * FROM entities WHERE entity_type = 'CodeUnit';
-- SQLite looks up 'CodeUnit' in the B-tree → O(log n) time
```

### B-Trees

A B-tree is a balanced tree structure optimized for disk access. Each node holds multiple keys and pointers:

```
                    [M]
                  /     \
            [D, H]      [R, V]
           /  |  \     /  |  \
        [A-C][E-G][I-L][N-Q][S-U][W-Z]
```

To find key "K":
1. Start at root: K < M → go left
2. At [D, H]: K > H → go right
3. At [I-L]: found K in this leaf node

This takes 3 disk reads regardless of how many millions of rows exist. Each level of the tree requires one disk read, and B-trees are typically only 3-4 levels deep.

### Composite Indexes

```sql
CREATE INDEX idx_sessions_profile ON session_states(workspace_profile_id, created_at DESC);
```

This composite index is ordered first by `workspace_profile_id`, then by `created_at` within each profile. It accelerates the query: "get the most recent session state for profile X" — SQLite can jump directly to the profile's entries and read them in reverse chronological order.

### Index Trade-offs

Every index speeds up reads but slows down writes (the index must be updated on every INSERT/UPDATE/DELETE). For this project, reads are far more frequent than writes for most tables, so the indexes in the schema are well-justified.

---

## 6. Foreign Keys and Referential Integrity

### What Are Foreign Keys?

A foreign key is a column that references the primary key of another table, creating a relationship:

```sql
CREATE TABLE tasks (
    entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    status TEXT,
    priority TEXT,
    ...
);
```

`REFERENCES entities(id)` means `entity_id` must correspond to an existing row in the `entities` table. You can't create a task that references a nonexistent entity.

### ON DELETE CASCADE

`ON DELETE CASCADE` means: if the parent entity is deleted, automatically delete the task too. Without this, deleting an entity would leave orphaned task rows.

`ON DELETE SET NULL` (used for `workspace_profile_id` in several tables) means: if the workspace profile is deleted, set the column to NULL rather than deleting the row. Chat messages and terminal commands survive even if the profile that created them is deleted.

### Why This Matters

The knowledge graph has many relationships: entities reference profiles, links reference entities, tasks reference entities. Foreign keys ensure that these relationships remain consistent — you can't accidentally create a "dangling pointer" in the graph.

---

## 7. Schema Migrations

### The Problem

Your database schema will change over time. You might add a column to `entities`, add a new table for experiment tracking, or change a column's data type. But the database already has data in it — you can't just drop and recreate tables.

### The Solution: Numbered Migration Scripts

```
migrations/
├── 001_initial.sql          -- Creates all initial tables
├── 002_add_thread_id.sql    -- Adds thread_id column to chat_messages
├── 003_add_experiments.sql  -- Adds experiments tracking table
└── 004_rename_column.sql    -- Renames a column
```

Each script is applied in order, exactly once. The `schema_version` table tracks which migrations have been applied:

```sql
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    description TEXT,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Migration Flow on App Startup

```
1. App starts
2. Open database
3. Read current version from schema_version
   ─ Current version: 2
4. Check migrations directory
   ─ Available migrations: 001, 002, 003, 004
5. Apply migrations 003 and 004 (version > 2)
6. Update schema_version to 4
7. Continue normal operation
```

### Writing Safe Migrations

**Adding a column** (safe):
```sql
ALTER TABLE entities ADD COLUMN priority TEXT DEFAULT 'medium';
```
Existing rows get the default value. No data loss.

**Renaming a column** (SQLite doesn't support `ALTER TABLE RENAME COLUMN` before 3.25):
```sql
-- Create new table with desired schema
CREATE TABLE entities_new (...);
-- Copy data
INSERT INTO entities_new SELECT ... FROM entities;
-- Drop old table
DROP TABLE entities;
-- Rename new table
ALTER TABLE entities_new RENAME TO entities;
-- Recreate indexes
CREATE INDEX ...;
```

**Destructive changes** (dangerous — need data transformation):
```sql
-- Changing a column type or splitting a column
-- Always include a data migration step that transforms existing data
```

### LanceDB "Migrations"

LanceDB tables don't have the same schema migration problem. If the vector schema changes (adding a field, changing dimensions), the strategy is:

1. Create a new LanceDB table with the updated schema
2. Re-index all files from disk (the `file_index` table tracks what needs embedding)
3. Drop the old table

This works because embeddings are *derived data* — they're generated from source files, so they can always be regenerated. The `file_index` table in SQLite acts as the manifest of what needs re-embedding.

---

## 8. UUIDs as Primary Keys

Every table uses UUID v4 strings as primary keys instead of auto-incrementing integers.

### Why UUIDs?

**No coordination needed:** Multiple processes (Rust, Python) can generate IDs independently without a shared counter. A UUID v4 is a random 128-bit number — the chance of collision is negligible (1 in 2^122).

**Merge-friendly:** If the database is ever synced between devices (Phase 7's multi-device feature), UUIDs won't collide. Auto-incrementing integers from two separate databases would.

**Opaque:** An integer ID like `entity_id=42` reveals that there are at least 42 entities. A UUID like `550e8400-e29b-41d4-a716-446655440000` reveals nothing about the data's size or ordering.

### Trade-off

UUID strings are larger than integers (36 bytes vs. 4-8 bytes), making indexes slightly larger and comparisons slightly slower. For the expected data volumes (tens of thousands of rows, not millions), this overhead is negligible.

---

## 9. The Hybrid Storage Architecture

The workspace uses two databases for different purposes:

| Concern | SQLite | LanceDB |
|---------|--------|---------|
| Data type | Structured (rows and columns) | Vectors (high-dimensional numbers) |
| Query type | Exact match, range, JOIN, aggregate | Nearest-neighbor similarity |
| Example query | "Get all tasks with status='blocked'" | "Find code chunks similar to 'attention mechanism'" |
| Schema | Strict (tables, columns, types) | Flexible (schema defined at table creation) |
| ACID transactions | Full support | Limited (eventual consistency within append operations) |
| Persistence | Single `.db` file | Directory of Arrow/Parquet files per table |

**Why two databases?** SQLite is excellent for structured queries (filtering, joining, aggregating) but can't do vector similarity search efficiently. LanceDB is excellent for vector search but not for relational queries. The hybrid approach uses each for what it does best.

**How they connect:** The `entity_id` field in LanceDB vectors references the `id` field in SQLite's `entities` table. When a semantic search returns results, the system uses the `entity_id` to fetch rich metadata (title, type, source file, relationships) from SQLite.

---

## Key Takeaways

1. **SQLite is embedded, not client-server.** It's a library linked into your app, accessing a single file on disk. No installation, no configuration.

2. **WAL mode enables concurrency.** Writers append to a log; readers see consistent snapshots. Both can operate simultaneously.

3. **Knowledge graphs work in SQL.** Entities table + links table = adjacency list representation. More verbose than a graph database, but no extra infrastructure.

4. **JSON columns handle polymorphism.** When different entity types need different metadata fields, a JSON column is the pragmatic choice.

5. **Indexes make reads fast at the cost of slightly slower writes.** B-trees provide O(log n) lookup. Composite indexes serve common query patterns.

6. **Migrations keep the schema evolving safely.** Numbered scripts applied in order, tracked by a version table.

7. **Two databases, two strengths.** SQLite for structured data and relationships. LanceDB for vector similarity search. Connected by entity IDs.

---

## Further Reading

- [SQLite Documentation](https://www.sqlite.org/docs.html) — The canonical reference (exceptionally well-written)
- [SQLite WAL Mode](https://www.sqlite.org/wal.html) — Deep dive into Write-Ahead Logging
- [Use The Index, Luke](https://use-the-index-luke.com/) — The best resource for understanding database indexes
- [SQLite As An Application File Format](https://www.sqlite.org/appfileformat.html) — Why SQLite is ideal for desktop apps
- [LanceDB Documentation](https://lancedb.github.io/lancedb/) — The embedded vector database
