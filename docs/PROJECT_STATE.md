# Cortex: Complete Project State Document

> **Generated:** 2026-02-27
> **Purpose:** Comprehensive reference for any AI agent or developer working on this project. Covers architecture, implementation status, known bugs, conventions, and the full roadmap.

---

## Table of Contents

1. [Project Identity](#1-project-identity)
2. [Architecture Overview](#2-architecture-overview)
3. [Build & Run Requirements](#3-build--run-requirements)
4. [Directory Structure](#4-directory-structure)
5. [Rust Backend (src-tauri/)](#5-rust-backend-src-tauri)
6. [Python Sidecar (sidecar/)](#6-python-sidecar-sidecar)
7. [Frontend (src/)](#7-frontend-src)
8. [Data Layer](#8-data-layer)
9. [IPC Contract (Frontend <-> Rust <-> Sidecar)](#9-ipc-contract)
10. [Test Infrastructure](#10-test-infrastructure)
11. [Known Bugs & Issues](#11-known-bugs--issues)
12. [What Is Complete](#12-what-is-complete)
13. [What Is Not Yet Built](#13-what-is-not-yet-built)
14. [Design Principles & Conventions](#14-design-principles--conventions)
15. [Key Technical Decisions & Deviations](#15-key-technical-decisions--deviations)
16. [Project Strategy Documentation Map](#16-project-strategy-documentation-map)

---

## 1. Project Identity

**Name:** Cortex
**Tagline:** AI-native, local-first workspace for developers
**Package/Bundle ID:** `com.cortex.app`

Cortex is a Tauri v2 desktop application that integrates a terminal emulator, code editor, semantic search, knowledge graph, and LLM-powered agents into a single workspace. The "killer feature" is **Session State & Handoff** -- the system continuously captures your working context and can reconstitute your mental state when you return.

**Target audience:** Solo developers juggling multiple projects, students/researchers managing vast information, privacy-conscious users needing local-first data sovereignty (including ITAR/aerospace compliance).

**Three architectural pillars:**
1. **Session State & Handoff** -- never lose context across work sessions
2. **Local-First Architecture** -- all core functionality works offline; cloud APIs are opt-in upgrades
3. **Automatic Semantic Linking** -- the knowledge graph builds itself from your work activity

---

## 2. Architecture Overview

Cortex is a three-process system:

```
Frontend (SolidJS + Vite)         Rust Backend (Tauri v2)           Python Sidecar (FastAPI)
 WebView on localhost:1420         Native process                    HTTP on 127.0.0.1:9400

 WorkspaceLayout                   main.rs (AppState)                main.py (FastAPI app)
 +-- NotesPanel (stub)             +-- db.rs (SQLite/WAL)            +-- /health
 +-- EditorPanel (stub)            +-- watcher.rs (notify crate)     +-- /ingest (POST)
 +-- SearchPanel       <--invoke--> +-- ingest.rs (HTTP to sidecar)  +-- /embed (POST)
 +-- ChatPanel (stub)   --events--> +-- sidecar.rs (process mgr)     +-- /embeddings (DELETE)
 +-- TaskPanel (stub)              +-- commands.rs (Tauri IPC)       +-- /search (GET)
 +-- IndexingStatus                +-- pty.rs (portable-pty)         +-- chunking.py
 +-- TerminalPanel                 +-- pty_commands.rs                   (tree-sitter AST)
     +-- Tab bar                   +-- osc_parser.rs                 +-- LanceDB (vector store)
     +-- PaneContainer             +-- shell_hooks.rs                +-- sentence-transformers
     +-- SplitContainer            +-- events.rs                        (all-MiniLM-L6-v2)
     +-- XtermInstance (xterm.js)
```

**Communication rules:**
- Frontend NEVER talks to the Python sidecar directly -- all requests route through Rust via `invoke()`
- Rust is the authority for all state (SQLite, sidecar lifecycle, PTY sessions, file watching)
- Python sidecar is a pure servant -- it only responds, never initiates
- Binary data (PTY output) travels as base64 through Tauri's JSON event system

**Data stores:**
- **SQLite** (`cortex.db`) -- relational data: file index, entities, terminal commands, profiles, config
- **LanceDB** (`lancedb/`) -- vector embeddings for semantic search
- Both stored in platform app data dir: `~/Library/Application Support/com.cortex.app/` (macOS)

---

## 3. Build & Run Requirements

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | v20+ | Frontend tooling |
| pnpm | 10.19.0 | Pinned in `package.json` `packageManager` field |
| Rust | 2021 edition (stable) | No pinned toolchain; uses whatever stable is installed |
| Python | 3.12+ | For the sidecar |
| uv | latest | Python package manager (replaces pip/poetry) |
| Xcode CLI Tools | latest | macOS requirement for Tauri compilation |

### Commands

| Action | Command | Notes |
|---|---|---|
| Install JS deps | `pnpm install` | From project root |
| Install Python deps | `cd sidecar && uv sync` | Creates `.venv` in sidecar/ |
| Dev mode (full app) | `pnpm tauri dev` | Starts Vite + compiles Rust + launches app |
| Frontend only | `pnpm dev` | Vite dev server on localhost:1420 |
| Build release | `pnpm tauri build` | Produces native binary |
| Run frontend tests | `pnpm test` | Vitest with jsdom |
| Watch frontend tests | `pnpm test:watch` | |
| Run Rust tests | `cd src-tauri && cargo test` | |
| Run Python tests | `cd sidecar && uv run pytest` | |

### Important: Sidecar Startup

The Rust backend spawns the sidecar via `uv run --directory {sidecar_dir} python -m cortex_sidecar.main --port 9400 --host 127.0.0.1`. The sidecar loads the `all-MiniLM-L6-v2` sentence transformer model (~80 MB, MPS/CUDA/CPU), which takes 1-3 seconds. A health monitor loop checks `/health` every 10 seconds after a 3-second initial wait.

---

## 4. Directory Structure

```
note_task_dev/
+-- package.json                  # Frontend config (SolidJS + Vite + xterm.js)
+-- pnpm-lock.yaml
+-- tsconfig.json                 # strict, ESNext, path alias ~/\* -> src/\*
+-- vite.config.ts                # TailwindCSS v4 + SolidJS plugins
+-- vitest.config.ts              # jsdom env, globals, SolidJS plugin
+-- index.html                    # SPA entry point
+-- README.md                     # Quick-start guide (slightly outdated)
+-- GEMINI.md                     # Full project description for LLM consumption
+--
+-- src/                          # Frontend source (SolidJS + TypeScript)
|   +-- index.tsx                 # Entry point: render(<App />, root)
|   +-- App.tsx                   # Health polling -> WorkspaceLayout
|   +-- styles/app.css            # Tailwind v4 + CSS custom properties (dark theme)
|   +-- layouts/
|   |   +-- WorkspaceLayout.tsx   # CSS Grid: 3-col, 2-row fixed layout
|   +-- components/
|   |   +-- IndexingStatus.tsx    # Header: green dot (idle) or blue spinner (indexing)
|   |   +-- SearchPanel.tsx       # Cmd+K semantic search with filters
|   |   +-- ChatPanel.tsx         # Placeholder + health check debug widget
|   |   +-- NotesPanel.tsx        # Placeholder
|   |   +-- EditorPanel.tsx       # Placeholder
|   |   +-- TaskPanel.tsx         # Placeholder
|   |   +-- TerminalPanel.tsx     # Tab bar + keyboard shortcuts + state management
|   |   +-- PaneContainer.tsx     # Recursive pane/split renderer
|   |   +-- SplitContainer.tsx    # Flex layout with draggable dividers
|   |   +-- XtermInstance.tsx     # xterm.js terminal wired to PTY
|   |   +-- __tests__/            # Component tests
|   +-- lib/
|   |   +-- tauri.ts              # Tauri invoke/listen wrappers (search, health, indexing)
|   |   +-- pty.ts                # Tauri invoke/listen wrappers (PTY operations)
|   |   +-- terminalState.ts      # SolidJS store for tabs + recursive split pane tree
|   |   +-- __tests__/            # Library tests
|   +-- test/
|       +-- setup.ts              # Vitest global setup: mocks for @tauri-apps/api
+--
+-- src-tauri/                    # Rust backend
|   +-- Cargo.toml                # tauri 2, tokio, rusqlite, notify, portable-pty, etc.
|   +-- build.rs                  # tauri_build::build()
|   +-- tauri.conf.json           # App config: "Cortex", 1400x900, dev on :1420
|   +-- src/
|       +-- main.rs               # Entry point: AppState, setup, background tasks
|       +-- db.rs                 # SQLite schema (11 tables) + CRUD functions
|       +-- events.rs             # Event name constants + payload structs
|       +-- commands.rs           # Tauri IPC: health_check, semantic_search, indexing_status
|       +-- sidecar.rs            # SidecarManager: spawn, stop, health monitor, restart
|       +-- watcher.rs            # File system watcher, .gitignore, debounce, ingest orchestration
|       +-- ingest.rs             # SHA-256 hashing, language detection, HTTP to sidecar
|       +-- pty.rs                # PtyManager + PtySession, reader thread, OSC event routing
|       +-- pty_commands.rs       # Tauri commands: pty_create/write/resize/kill
|       +-- osc_parser.rs         # Streaming OSC 633 state machine
|       +-- shell_hooks.rs        # Shell hook script generation (zsh, bash)
+--
+-- sidecar/                      # Python sidecar (FastAPI)
|   +-- pyproject.toml            # Dependencies: fastapi, lancedb, sentence-transformers, tree-sitter
|   +-- uv.lock
|   +-- cortex_sidecar/
|   |   +-- main.py               # App, endpoints, LanceDB schema, lifespan
|   |   +-- chunking.py           # 4 strategies: text, code (tree-sitter), markdown, config
|   |   +-- routes/health.py      # GET /health
|   +-- tests/
|       +-- test_api.py           # 2 tests
|       +-- test_chunking.py      # 25 tests
|       +-- test_db.py            # 4 tests (1 is broken -- see bugs)
|       +-- test_ingest.py        # 14 tests
+--
+-- project_strategy/             # Design documents (the project "brain")
|   +-- README.md                 # Master index
|   +-- project_review_and_strategy_v2.md  # The most comprehensive single design doc
|   +-- foundation/               # Philosophy, architecture, tech stack, data schema, study guides
|   +-- modules/                  # Module specs: context engine, knowledge graph, IDE, terminal, agents
|   +-- phases/                   # Phase specs: 0 (skeleton) through 7 (advanced)
|   +-- reference/                # Risk register, vision document
+--
+-- conductor/                    # Project management
|   +-- workflow.md               # Dev workflow protocol (TDD, commit conventions, quality gates)
|   +-- product.md                # Product definition
|   +-- product-guidelines.md     # Brand/UX guidelines
|   +-- tech-stack.md             # Condensed tech stack reference
|   +-- code_styleguides/         # TypeScript, Python, HTML/CSS style guides
|   +-- tracks/                   # Active work tracks with spec/plan/metadata
+--
+-- docs/
    +-- feb_27_updates.md         # Most current session log (terminal work)
    +-- PROJECT_STATE.md          # This file
```

---

## 5. Rust Backend (src-tauri/)

### 5.1 Module Map

| File | Purpose | Key Types |
|---|---|---|
| `main.rs` | App entry, `AppState`, setup, background task spawning | `AppState`, `IndexingState` |
| `db.rs` | SQLite schema (11 tables), all CRUD functions | `initialize()`, `upsert_file_index()`, `upsert_entity()` |
| `events.rs` | Event name constants + payload structs | `INDEXING_PROGRESS`, `PTY_OUTPUT`, etc. |
| `commands.rs` | Tauri IPC command handlers | `health_check`, `semantic_search`, `get_indexing_status`, `get_app_status` |
| `sidecar.rs` | Python process lifecycle + health monitor | `SidecarManager`, `SidecarStatus`, `health_monitor_loop` |
| `watcher.rs` | File watching, .gitignore, debounce, ingest orchestration | `start_watcher()`, `process_file_with_events()` |
| `ingest.rs` | SHA-256, language detection, HTTP client to sidecar | `process_file()`, `delete_file_embeddings()`, `compute_sha256()` |
| `pty.rs` | PTY session pool, reader threads, OSC event routing | `PtyManager`, `PtySession` |
| `pty_commands.rs` | Tauri commands wrapping PtyManager | `pty_create`, `pty_write`, `pty_resize`, `pty_kill` |
| `osc_parser.rs` | Streaming OSC 633 parser (state machine) | `OscParser`, `OscEvent`, `ParseResult` |
| `shell_hooks.rs` | Shell hook script generation (zsh/bash) | `setup_hook_dir()`, `build_shell_command()` |

### 5.2 AppState (the global singleton)

```rust
pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub sidecar_manager: Mutex<sidecar::SidecarManager>,
    pub sidecar_url: String,                       // "http://127.0.0.1:9400"
    pub indexing: Mutex<IndexingState>,
    pub git_branch: String,                        // detected once at startup
    pub pty_manager: Mutex<pty::PtyManager>,
    pub shell_hooks_dir: Option<std::path::PathBuf>,
}

pub struct IndexingState {
    pub total_queued: usize,   // monotonically increasing
    pub completed: usize,      // monotonically increasing
    pub current_file: Option<String>,
}
```

### 5.3 Startup Sequence (main.rs)

1. Resolve app data dir
2. Open SQLite at `{data_dir}/cortex.db` (WAL mode, foreign keys)
3. Resolve sidecar directory (`../sidecar` relative to Cargo manifest)
4. Spawn Python sidecar via `uv run`
5. Detect git branch (one-time `git rev-parse`)
6. Write shell hook scripts to `{data_dir}/shell_hooks/`
7. Construct AppState
8. Spawn background tasks: `health_monitor_loop` + `start_watcher`
9. Register 8 Tauri IPC commands
10. On `RunEvent::Exit`: stop sidecar + kill all PTY sessions

### 5.4 File Ingestion Pipeline (watcher.rs + ingest.rs)

```
File change detected (notify crate)
         |
    300ms debounce (group by path)
         |
    Extension check (18 types: rs, py, ts, tsx, js, jsx, md, txt, toml, json, yaml, yml, html, css, sql, sh, bash, zsh)
         |
    .gitignore + .contextignore filter
         |
    Read file -> SHA-256 hash
         |
    Compare with stored hash in SQLite -> SKIP if unchanged
         |
    DELETE old embeddings from sidecar (DELETE /embeddings?source_file=...)
    DELETE old entities from SQLite
         |
    POST /ingest to sidecar (content + language + source_type + git_branch)
         |
    Sidecar: chunk file (tree-sitter AST or fallback) -> embed chunks -> store in LanceDB
         |
    Response: { chunk_count, entities: [{name, type, start_line, end_line}] }
         |
    Rust: upsert_file_index + upsert_entity for each extracted entity
         |
    Emit: indexing:file-complete + indexing:progress events
```

### 5.5 PTY Architecture (pty.rs + osc_parser.rs + shell_hooks.rs)

```
pty_create Tauri command
    |
    +-- Build shell command with hooks:
    |     zsh: set ZDOTDIR -> custom .zshrc sources user's + adds precmd/preexec
    |     bash: --rcfile -> custom .bashrc sources user's + adds PROMPT_COMMAND/DEBUG trap
    |
    +-- Spawn PTY pair (portable-pty, 24x80 initial size)
    |
    +-- Spawn OS reader thread (std::thread, NOT tokio):
          Loop: read 4096 bytes from PTY
            |
            +-- Parse through OscParser (streaming state machine)
            |     Strips OSC 633 sequences, passes everything else through
            |     Emits: CommandStart, CommandEnd, CommandText, CwdChange
            |
            +-- Base64-encode clean output bytes
            |
            +-- Emit pty:output Tauri event
            |
            +-- For CommandEnd: emit terminal:command-end with command, exit_code, cwd, duration_ms
```

### 5.6 Sidecar Manager (sidecar.rs)

- Spawns via `uv run --directory {sidecar_dir} python -m cortex_sidecar.main --port 9400 --host 127.0.0.1`
- Health monitor: waits 3s, then checks every 10s
- Restart policy: max 3 consecutive failures, exponential backoff (1s, 2s, 4s)
- `restart_count` resets to 0 when marked healthy (allows infinite total restarts across healthy->unhealthy cycles)
- `Drop` impl calls `stop()` (SIGKILL + wait)

### 5.7 Registered Tauri Commands

| Command | Handler | Async | Description |
|---|---|---|---|
| `health_check` | `commands::health_check` | yes | Checks tauri + SQLite + sidecar + LanceDB |
| `get_app_status` | `commands::get_app_status` | no | Returns `SidecarStatus` as debug string |
| `semantic_search` | `commands::semantic_search` | yes | Proxies GET to sidecar `/search` |
| `get_indexing_status` | `commands::get_indexing_status` | no | Snapshot of IndexingState |
| `pty_create` | `pty_commands::pty_create` | yes | Creates PTY session with shell hooks |
| `pty_write` | `pty_commands::pty_write` | yes | Writes base64-decoded data to PTY |
| `pty_resize` | `pty_commands::pty_resize` | yes | Resizes PTY dimensions |
| `pty_kill` | `pty_commands::pty_kill` | yes | Kills PTY session and reader thread |

---

## 6. Python Sidecar (sidecar/)

### 6.1 Overview

FastAPI app running on `127.0.0.1:9400`. Handles all ML workloads: text chunking (tree-sitter AST), embedding generation (`all-MiniLM-L6-v2`, 384-dim vectors), and vector search (LanceDB). Managed by `uv`.

### 6.2 API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Returns `{status, version, lancedb}` |
| `POST` | `/ingest` | Chunks file, embeds, stores in LanceDB. Body: `{file_path, content, language, source_type, git_branch}`. Returns: `{chunk_count, entities}` |
| `POST` | `/embed` | Embeds a single text snippet. Body: `{text, metadata}`. Returns: `{status, entity_id}` |
| `DELETE` | `/embeddings?source_file=X` | Deletes all embeddings for a file |
| `GET` | `/search?query=X&limit=N&language=&source_type=&chunk_type=&file_path_prefix=` | Vector similarity search. Returns: `{results, query}` |

### 6.3 Chunking Strategies (chunking.py)

| Strategy | Languages | Method |
|---|---|---|
| `chunk_code` | python, javascript, typescript, rust | Tree-sitter AST: top-level definitions as chunks. Preamble captured separately. Nodes >8000 chars fall back to word-window. |
| `chunk_markdown` | markdown | Split on `#` headings. Each section = one chunk. |
| `chunk_config` | toml, yaml, json | Heuristic line-based: top-level keys as section boundaries. |
| `chunk_text` | everything else | Sliding window: 500 words, 50-word overlap. |

**Important:** `tsx` is listed as a code language but has no entry in `_CODE_NODE_TYPES`, so TSX files always fall through to word-window chunking. This is a known gap.

### 6.4 Embedding Details

- **Model:** `sentence-transformers/all-MiniLM-L6-v2` (384-dim float32 vectors, ~80 MB)
- **Device:** MPS (Apple Silicon), CUDA, or CPU auto-detected
- **Context header:** Each chunk gets a header prepended before embedding (e.g., `"File: main.rs | Function: process_event"`) but only the raw text (without header) is stored
- **Token count:** Actually a word count (`len(text.split())`), not real BPE tokens
- **Relevance score:** `max(0.0, 1.0 - L2_distance)` -- approximate for normalized vectors but can produce 0.0 for distant results

### 6.5 LanceDB Schema

```python
pa.schema([
    pa.field("vector",      pa.list_(pa.float32(), 384)),
    pa.field("text",        pa.utf8()),
    pa.field("source_type", pa.utf8()),        # "code", "docs", "test", "config", "unknown"
    pa.field("source_file", pa.utf8()),
    pa.field("entity_id",   pa.utf8()),        # UUID
    pa.field("chunk_type",  pa.utf8()),        # "function", "class", "struct", "section", "text", etc.
    pa.field("chunk_index", pa.int32()),
    pa.field("language",    pa.utf8()),
    pa.field("git_branch",  pa.utf8()),
    pa.field("token_count", pa.int32()),
    pa.field("created_at",  pa.utf8()),        # ISO datetime
    pa.field("updated_at",  pa.utf8()),
])
```

Table name: `"embeddings"` (single table, not per-profile as the design doc envisioned).

### 6.6 Test Mode

Set `CORTEX_TEST_MODE=1` and `CORTEX_DATA_DIR=./test_data` for tests. In test mode:
- Embedding model is `None`
- Mock vectors `[0.1]*384` are used instead
- Tests run fast without GPU/model

---

## 7. Frontend (src/)

### 7.1 Stack

| Technology | Version | Purpose |
|---|---|---|
| SolidJS | 1.9 | UI framework (**NOT React** -- uses signals, not VDOM) |
| Vite | 6 | Bundler/dev server |
| Tailwind CSS | 4 | Styling (uses `@import "tailwindcss"` v4 syntax) |
| TypeScript | 5.6 | Type system (strict mode) |
| xterm.js | 6 | Terminal emulator widget |
| @xterm/addon-fit | 0.11 | Auto-resize terminal to container |
| @xterm/addon-web-links | 0.12 | Clickable URLs in terminal |
| @xterm/addon-search | 0.16 | Terminal text search |
| Vitest | 4 | Test runner (jsdom environment) |
| @solidjs/testing-library | 0.8 | SolidJS component test utilities |

### 7.2 Component Tree

```
App.tsx
  |-- Health polling (1s interval until all subsystems ok)
  |-- Loading screen: "Cortex" title + status message
  |-- Ready: WorkspaceLayout
        |
        WorkspaceLayout.tsx (CSS Grid: 3 cols [260px|1fr|300px], 2 rows [1fr|200px])
        |
        +-- Header (h-10): "Cortex" + IndexingStatus
        |
        +-- Left sidebar (col 1, row-span-2):
        |   +-- NotesPanel (flex-1) [STUB]
        |   +-- TaskPanel (h-[200px]) [STUB]
        |
        +-- Center top (col 2, row 1):
        |   +-- EditorPanel [STUB]
        |
        +-- Center bottom (col 2, row 2):
        |   +-- TerminalPanel
        |       +-- Tab bar (h-8): For each tab, "+" button
        |       +-- Active tab content:
        |           +-- PaneContainer (recursive)
        |               +-- type 'pane': XtermInstance (with active ring)
        |               +-- type 'split': SplitContainer
        |                   +-- Flex row/col of PaneContainers + draggable dividers
        |
        +-- Right sidebar (col 3, row-span-2):
            +-- SearchPanel (flex-1) [FUNCTIONAL]
            +-- ChatPanel (h-[200px]) [STUB + health check debug widget]
```

### 7.3 State Management

- **No global store** -- each component manages its own state via SolidJS `createSignal`
- **Terminal state:** `createTerminalStore()` in `terminalState.ts` uses `createStore` + `produce` (immer-style mutations). Instantiated locally in `TerminalPanel`, not provided via context.
- **Terminal state shape:**
  ```typescript
  type PaneNode =
    | { type: 'pane'; id: string; sessionId: string }
    | { type: 'split'; id: string; direction: 'horizontal'|'vertical'; children: PaneNode[]; sizes: number[] }

  type TerminalTab = { id: string; title: string; layout: PaneNode }
  type TerminalState = { tabs: TerminalTab[]; activeTabIndex: number; activePaneId: string | null }
  ```

### 7.4 Keyboard Shortcuts (Global)

| Shortcut | Component | Action |
|---|---|---|
| `Cmd/Ctrl+K` | SearchPanel | Focus search input |
| `Cmd/Ctrl+T` | TerminalPanel | New terminal tab |
| `Cmd/Ctrl+W` | TerminalPanel | Close active pane (removes tab if last pane) |
| `Cmd/Ctrl+D` | TerminalPanel | Split active pane vertically |
| `Cmd/Ctrl+Shift+D` | TerminalPanel | Split active pane horizontally |

### 7.5 Tauri API Abstraction Layer

All Tauri `invoke()` and `listen()` calls are centralized in `src/lib/tauri.ts` and `src/lib/pty.ts`. Components never call Tauri APIs directly.

### 7.6 Theme (CSS Custom Properties)

Defined in `src/styles/app.css`:
```css
:root {
  --color-bg-primary: #0f1117;      /* Dark navy-black */
  --color-bg-secondary: #1a1d27;
  --color-bg-panel: #1e2130;
  --color-border: #2a2d3a;
  --color-text-primary: #e1e4ed;
  --color-text-secondary: #8b8fa3;
  --color-accent: #6366f1;          /* Indigo */
  --color-accent-hover: #818cf8;
  --color-success: #22c55e;
  --color-error: #ef4444;
}
```

Terminal uses hardcoded Tokyo Night Dark theme in `XtermInstance.tsx` (not reading CSS vars).

---

## 8. Data Layer

### 8.1 SQLite Schema (11 Tables)

WAL mode enabled, `synchronous=NORMAL`, `foreign_keys=ON`.

| Table | Status | Purpose |
|---|---|---|
| `schema_version` | Implemented | Migration tracking (currently version 1) |
| `workspace_profiles` | Implemented | Named workspaces with watched dirs, LLM settings |
| `file_index` | Implemented | Per-file indexing state: hash, chunk_count, language, file_size |
| `entities` | Implemented | Extracted code symbols (functions, classes, structs) |
| `terminal_commands` | Schema + write fn exists | Shell command history (write fn exists but never called from non-test code) |
| `app_config` | Schema only | Key-value config store (no CRUD functions) |
| `session_states` | Schema only | Periodic session snapshots (no CRUD functions) |
| `entity_links` | Schema only | Relationships between entities (no CRUD functions) |
| `tasks` | Schema only | Task entities with status/priority (no CRUD functions) |
| `chat_messages` | Schema only | LLM conversation history (no CRUD functions) |
| `git_events` | Schema only | Git hook events (no CRUD functions) |

**Default seed data:**
- Schema version 1
- One active "Default" workspace profile
- App config: `theme=dark`, `sidecar_port=9400`, `periodic_snapshot_interval_minutes=5`, `max_stdout_capture_bytes=10240`, `embedding_batch_size=32`

### 8.2 Implemented Rust DB Functions

| Function | Purpose |
|---|---|
| `initialize(db_path)` | Create/open DB, apply schema, seed defaults |
| `get_active_profile_id(conn)` | Get the `is_active=TRUE` profile ID |
| `get_file_hash(conn, path, profile_id)` | Get stored SHA-256 for dedup check |
| `upsert_file_index(conn, path, profile_id, hash, lang, chunks, size)` | Insert/update file index entry |
| `upsert_entity(conn, type, title, source, profile_id, metadata_json)` | Insert/update extracted entity |
| `delete_entities_by_source_file(conn, source)` | Bulk delete all entities for a file |
| `delete_file_index(conn, path, profile_id)` | Remove file from index |
| `insert_terminal_command(conn, profile_id, cmd, cwd, exit_code, duration)` | Insert command record (DEAD CODE -- never called outside tests) |

---

## 9. IPC Contract

### 9.1 Frontend -> Rust (Tauri invoke)

| Command | Args | Returns | Used By |
|---|---|---|---|
| `health_check` | none | `HealthStatus` | `App.tsx`, `ChatPanel.tsx` |
| `get_app_status` | none | `string` (debug repr) | **Dead -- never called** |
| `semantic_search` | `{query, limit, language?, source_type?, chunk_type?, file_path_prefix?}` | `SearchResponse` | `SearchPanel.tsx` |
| `get_indexing_status` | none | `IndexingProgressPayload` | **Dead -- never called from frontend** |
| `pty_create` | `{sessionId, cwd?}` | `()` | `XtermInstance.tsx` |
| `pty_write` | `{sessionId, data: base64}` | `()` | `XtermInstance.tsx` |
| `pty_resize` | `{sessionId, cols, rows}` | `()` | `XtermInstance.tsx` |
| `pty_kill` | `{sessionId}` | `()` | `XtermInstance.tsx` |

### 9.2 Rust -> Frontend (Tauri events)

| Event | Payload | Emitted By | Listened By |
|---|---|---|---|
| `indexing:progress` | `{completed, total, current_file, is_idle}` | `watcher.rs` | `IndexingStatus.tsx` |
| `indexing:file-complete` | `{file_path, chunk_count, completed, total}` | `watcher.rs` | (not listened) |
| `indexing:file-error` | `{file_path, error, completed, total}` | `watcher.rs` | (not listened) |
| `indexing:file-deleted` | `{file_path}` | `watcher.rs` | (not listened) |
| `pty:output` | `{session_id, data: base64}` | `pty.rs` reader thread | `XtermInstance.tsx` |
| `pty:exit` | `{session_id, exit_code}` | `pty.rs` reader thread | `XtermInstance.tsx` |
| `terminal:command-start` | `{session_id, command}` | `pty.rs` reader thread | (not listened) |
| `terminal:command-end` | `{session_id, command, exit_code, cwd, duration_ms}` | `pty.rs` reader thread | (not listened) |

### 9.3 Rust -> Sidecar (HTTP)

| Method | URL | Used By |
|---|---|---|
| `GET` | `{sidecar_url}/health` | `sidecar.rs` (health monitor), `commands.rs` (health_check) |
| `POST` | `{sidecar_url}/ingest` | `ingest.rs` (file processing) |
| `DELETE` | `{sidecar_url}/embeddings?source_file=X` | `ingest.rs` (pre-ingest cleanup), `watcher.rs` (file deletion) |
| `GET` | `{sidecar_url}/search?query=X&limit=N&...` | `commands.rs` (semantic_search) |

---

## 10. Test Infrastructure

### 10.1 Test Counts (as of Feb 27, 2026)

| Layer | Framework | Count | Command |
|---|---|---|---|
| Rust | `cargo test` | 50 | `cd src-tauri && cargo test` |
| Frontend | Vitest | 34 | `pnpm test` |
| Python | pytest | 45 | `cd sidecar && uv run pytest` |
| **Total** | | **129** | |

### 10.2 Frontend Test Setup (src/test/setup.ts)

- **ResizeObserver polyfill** -- jsdom lacks it; a no-op class is registered on `globalThis`
- **`@tauri-apps/api/core` mock** -- `invoke` is `vi.fn()`, configurable per test via `mockResolvedValue()`
- **`@tauri-apps/api/event` mock** -- real in-memory pub/sub:
  - `listen(event, handler)` registers handler, returns unlisten fn
  - `emit(event, payload)` fires all handlers synchronously
  - `__getListeners()` / `__clearListeners()` for test inspection/cleanup

### 10.3 Test Coverage by Area

| Area | Coverage | Notes |
|---|---|---|
| `db.rs` | Thorough | 8 tests, all CRUD paths, in-memory SQLite |
| `osc_parser.rs` | Very thorough | 14 tests, edge cases, split-across-chunks |
| `shell_hooks.rs` | Good | 8 tests |
| `watcher.rs` | Good | 7 tests (unit + file creation detection) |
| `events.rs` | Basic | 4 serialization tests |
| `ingest.rs` | Basic | 3 tests (hash, language, source_type detection) |
| `pty.rs` | Minimal | 5 tests (all negative/empty cases, no integration) |
| `chunking.py` | Very thorough | 25 tests, all strategies and edge cases |
| `test_ingest.py` | Good | 14 tests, round-trip ingestion, filters, deletion |
| `SearchPanel.tsx` | Good | 7 tests, filters, invoke args, results |
| `IndexingStatus.tsx` | Good | 5 tests, event-driven states |
| `terminalState.ts` | Good | 9 tests, all public API functions |
| `TerminalPanel.tsx` | Minimal | 3 tests, structural only |

---

## 11. Known Bugs & Issues

### 11.1 Critical

| # | Location | Description |
|---|---|---|
| **B1** | `pty.rs` `PtyManager::write()` | **`take_writer()` called on every `write()` call.** `portable-pty` docs state this can only be called once per PTY master. After the first `pty_write`, every subsequent write for the same session will fail. **The fix:** store the writer in `PtySession` and reuse it. |
| **B2** | `main.rs:88-97` | **Production sidecar path identical to dev path.** Both branches of `cfg!(debug_assertions)` compute `../sidecar` relative to Cargo manifest. Release builds will fail to find the sidecar unless the source tree is present. |
| **B3** | `sidecar.rs` (port 9400) | **No stale-process cleanup.** If a previous app session left a sidecar running on port 9400, new instances repeatedly fail with `[Errno 48] address already in use` and hit the restart limit. The manager only kills its own child process, not leftover processes from previous sessions. |

### 11.2 High

| # | Location | Description |
|---|---|---|
| **B4** | `sidecar/main.py` DELETE + search | **Filter predicate injection.** All filter conditions use f-strings with unsanitized user input: `table.delete(f"source_file = '{source_file}'")`. A crafted value could inject arbitrary LanceDB predicates. |
| **B5** | `db.rs` | **6 schema tables have no Rust CRUD functions.** `session_states`, `entity_links`, `tasks`, `chat_messages`, `git_events`, `app_config` -- tables exist but are completely unimplemented from the application side. |
| **B6** | `db.rs` `insert_terminal_command` | **Dead code.** Defined and tested but never called from any non-test code path. Terminal commands are parsed via OSC 633 and emitted as events but never persisted. |
| **B7** | `chunking.py` TSX | **TSX falls through to word-window.** `"tsx"` is in `_CODE_LANGUAGES` and its grammar loads, but there's no entry in `_CODE_NODE_TYPES` for it. All TSX files get chunked as plain text. |

### 11.3 Medium

| # | Location | Description |
|---|---|---|
| **B8** | `main.rs` IndexingState | Counters never reset -- `total_queued` and `completed` grow forever. Progress percentage becomes meaningless after initial scan. |
| **B9** | `commands.rs` semantic_search | Never filters by `git_branch`. Results from all branches are returned. |
| **B10** | `ingest.rs` process_file | No HTTP timeout on `/ingest` POST. If the sidecar hangs, the async task blocks forever. |
| **B11** | `ingest.rs` + `watcher.rs` | File read twice per change: once in watcher (for hash), once in `process_file` (for POST body). |
| **B12** | `pty.rs` PtySession | PTY initial size hardcoded to 24x80. Should accept dimensions from frontend on creation. |
| **B13** | `pty.rs` exit code | Exit code always `None` on EOF. `child.wait()` is never called to get the real exit code. |
| **B14** | `sidecar.rs` restart_count | Resets to 0 in `mark_healthy()`, allowing unbounded total restarts if the sidecar keeps cycling healthy/unhealthy. |
| **B15** | `sidecar.rs` max_restarts | After exceeding max restarts, the health monitor loops forever logging errors with no frontend notification. |
| **B16** | `SplitContainer.tsx` | `localSizes` never writes back to the store. Resize state is lost on tab switch. |
| **B17** | `sidecar/main.py` | No ANN index created on LanceDB table. Every search is a full table scan. |
| **B18** | `sidecar/main.py` /ingest | No upsert/dedup. Re-ingesting a file without deleting first doubles all embeddings. Caller must `DELETE /embeddings` before re-ingesting. |
| **B19** | `tests/test_db.py` test_db_initialization | Broken test: `async def run_lifespan()` is defined but never called. Test passes vacuously. |
| **B20** | `shell_hooks.rs` Fish | Fish shell detected by `detect_shell_type` but no hooks are implemented -- falls through to unknown (no OSC 633). |

### 11.4 Low

| # | Location | Description |
|---|---|---|
| **B21** | `commands.rs` get_app_status | Returns raw Rust debug string instead of properly serialized enum. |
| **B22** | `db.rs` get_active_profile_id | Called per file event instead of being cached in AppState. |
| **B23** | `main.rs` detect_git_branch | Detected once at startup, never refreshed on branch switch. |
| **B24** | `osc_parser.rs` osc_buf | Unbounded growth on malformed/unterminated OSC sequences. |
| **B25** | `watcher.rs` | Delete events bypass .gitignore filter (only check extension). |
| **B26** | `XtermInstance.tsx` | SearchAddon loaded but no keyboard binding to invoke it. |
| **B27** | `IndexingStatus.tsx` | No initial poll on mount -- if component mounts mid-indexing, won't know until next event. `getIndexingStatus()` exists for this but is never called. |
| **B28** | `PaneContainer.tsx` | `onExit` prop not wired. Terminal process exit triggers no auto-close or visual indicator. |
| **B29** | `sidecar/pyproject.toml` | `pytest-cov` is in main dependencies instead of dev group. |

---

## 12. What Is Complete

### Phase 0: Skeleton -- DONE
- Tauri v2 app launches with SolidJS frontend
- Python sidecar spawns automatically
- Health check round-trip (frontend -> Rust -> Python -> Rust -> frontend)
- SQLite initialized with 11 tables
- LanceDB initialized
- Sidecar crash recovery (max 3 retries, exponential backoff)
- Basic workspace layout (CSS Grid, 6 panels)

### Phase 1: Context Engine -- DONE
- Rust file watcher using `notify` crate with 300ms debounce
- .gitignore and .contextignore support (via `ignore` crate)
- Tree-sitter AST chunking for Python, JavaScript, TypeScript, Rust
- Markdown heading-based chunking
- Config file chunking (TOML, YAML, JSON)
- Word-window fallback for unsupported languages
- Embedding via local `all-MiniLM-L6-v2` (384-dim vectors)
- Differential updates via SHA-256 content hashing (skip unchanged files)
- LanceDB storage with full metadata
- Entity extraction (functions, classes, structs -> SQLite `entities` table)
- Semantic search endpoint with filters (language, source_type, chunk_type, file_path_prefix)
- Frontend search UI with Cmd+K shortcut, language/type filters, result cards
- Indexing status indicator in header (idle/active with progress)

### Phase 3 (Partial): Terminal -- Core DONE
- Rust PTY backend using `portable-pty` 0.8
- Frontend xterm.js v6 integration (Tokyo Night Dark theme)
- FitAddon (auto-resize), WebLinksAddon (clickable URLs), SearchAddon (loaded but no UI)
- Shell hook injection for zsh (precmd/preexec via ZDOTDIR) and bash (PROMPT_COMMAND + DEBUG trap)
- Streaming OSC 633 parser in Rust (strips sequences before xterm.js)
- Command capture: start/end events with exit code, CWD, duration
- Multi-tab support (Cmd+T new, Cmd+W close)
- Recursive split pane model (Cmd+D vertical, Cmd+Shift+D horizontal)
- Draggable dividers with percentage-based sizing (10% minimum)
- Base64 binary transport through Tauri JSON events
- ResizeObserver-based terminal resize with PTY size sync
- Proper cleanup on unmount (unlisten events, dispose terminal, kill PTY)

### Test Coverage
- 50 Rust tests passing
- 34 Frontend tests passing (Vitest + jsdom)
- 45 Python tests passing (pytest)
- Total: 129 tests

---

## 13. What Is Not Yet Built

Listed in rough priority order per the project roadmap:

### Phase 3 Remaining: Terminal LLM Features
- Natural language command translation (toggle mode, NL -> shell, confirmation panel)
- Error resolution agent (non-zero exit + stderr -> LLM -> inline fix suggestions)
- Pipeline monitoring (long-running process detection, metrics parsing, notifications)
- stdout/stderr embedding in LanceDB for semantic search
- Terminal command persistence to SQLite (write path exists but isn't wired)

### Phase 2: Session Handoff (the "killer feature")
- litellm integration (Ollama connection, model routing, streaming SSE)
- Session state capture (triggers: exit, periodic, profile_switch, manual, inactivity)
- Raw signal gathering (editor, terminal, git, notes, tasks, chat)
- LLM synthesis for blockers/next_steps/summaries
- Rule-based fallback when LLM unavailable
- Session state SQLite storage (table exists, CRUD needed)
- Hydration on app start (load session, fetch relevant chunks, compose LLM prompt, restore UI)
- Chat panel with streaming LLM display + history
- Workspace profile CRUD + switching UI
- Historical session queries

### Phase 4: Code Editor
- CodeMirror 6 setup (not even a dependency yet)
- File tree browser (Cmd+P fuzzy finder)
- File open/edit/save operations
- Syntax highlighting (CodeMirror + tree-sitter)
- Multiple editor tabs in split panes
- Git gutter (modified/added/deleted indicators)
- LSP integration for Python (pyright/pylsp: autocomplete, hover, go-to-definition)
- Editor <-> Terminal integration (click file paths, "Run file" Cmd+Enter)
- Inline AI suggestions (ghost text)
- Refactoring agent panel

### Phase 5: Knowledge Graph & Tasks
- Full entity extraction pipeline on all content types
- Auto-linking with confidence scores (exact, fuzzy, semantic)
- Temporal co-occurrence linking
- Link suggestion UI (dashed suggested links for 0.70-0.85 confidence)
- Task auto-extraction from code comments and terminal errors
- Task board (Kanban/list view, filter by profile/priority/status)
- Notes panel (create/edit/view markdown, indexed and linked)
- Universal search (all entity types, all vector collections, hybrid)
- Bidirectional links in editor (hover function -> see notes/tasks)

### Phase 6: Background Agents & Polish
- Research daemon (ArXiv RSS monitoring)
- Pipeline monitor agent (metric parsing, experiment tracking)
- Digest agent (morning briefing: overdue tasks, stale branches, overnight results)
- Webhook/REST API endpoints
- Model routing rules UI
- Settings panel
- Keyboard shortcut customization
- Theme support (dark/light/custom)
- Desktop notifications
- Additional LSP servers (TypeScript, Rust)

### Phase 7: Advanced
- Multi-file context-aware refactoring
- Voice notes + local whisper.cpp transcription
- ML experiment tracking (MLflow/W&B integration)
- Foundry API integration
- Multi-device sync (SQLite + LanceDB)
- Plugin system (Python plugin interface)
- Additional language support (Go, Java, C/C++, Ruby, PHP, Swift, Kotlin)

---

## 14. Design Principles & Conventions

### Core Principles (from project_strategy/foundation/00_philosophy_and_principles.md)

1. **Session state is sacred** -- crash-safe SQLite WAL, 5-minute snapshots, append-only history
2. **Automatic over manual** -- if it requires remembering, it will be forgotten
3. **Local-first, cloud-optional** -- non-negotiable (ITAR/export control)
4. **Knowledge graph is emergent** -- it builds itself from your activity
5. **Each phase ships a usable tool** -- no phase depends on future phases
6. **Composable internals** -- swap LanceDB, Ollama, or CodeMirror without rewriting other modules

### Development Workflow (from conductor/workflow.md)

- **TDD required:** Write failing tests first, implement to pass, then refactor
- **Coverage target:** >80%
- **Plan tracking:** `conductor/tracks/*/plan.md` is the source of truth for task status
- **Task markers:** `[ ]` open, `[~]` in progress, `[x]` complete (with commit SHA)
- **Commit format:** `conductor(plan): Mark task '<name>' as complete`
- **Phase completion:** Requires explicit user confirmation ("yes") before marking complete

### Code Style

- **TypeScript:** Google TS Style Guide. `const`/`let` only, named exports, no `any`, single quotes, semicolons. `UpperCamelCase` for types, `lowerCamelCase` for functions, `CONSTANT_CASE` for constants.
- **Python:** Google Python Style Guide. Type annotations on all public APIs, 80-char lines, docstrings on every public function with Args/Returns/Raises.
- **Rust:** Standard Rust conventions. `snake_case` for functions/variables, `PascalCase` for types.
- **General:** Readability over cleverness, consistency with existing patterns, simplicity first.

### SolidJS-Specific Patterns

- Use `createSignal` for simple reactive state
- Use `createStore` + `produce` for complex nested state (terminal pane tree)
- Use `<For>` for reactive lists, `<Show>` for conditional rendering, `<Switch>/<Match>` for multi-branch
- `onMount` for side effects, `onCleanup` for teardown
- Components never call `invoke()`/`listen()` directly -- always through `src/lib/tauri.ts` or `src/lib/pty.ts`

---

## 15. Key Technical Decisions & Deviations

| Decision | Original Plan | Actual Implementation | Rationale |
|---|---|---|---|
| PTY library | `tauri-plugin-pty` | `portable-pty` 0.8 (direct Rust crate) | More control over PTY lifecycle |
| PTY reader thread | tokio async | `std::thread` (OS thread) | `portable-pty` returns synchronous reader; OS thread bridges to Tauri events |
| Binary transport | Not specified | Base64 encoding through JSON events | Tauri events are JSON; raw bytes need encoding |
| File watcher (Rust) | `watchdog` (Python) or `notify` (Rust) | `notify` 8.2 (Rust) | Keep watcher in Rust process for performance, avoid Python GIL |
| Tree-sitter | Python-only | Python (via sidecar) | Works well with sentence-transformers pipeline |
| Embedding table | Per-profile (`embeddings_{profile_id}`) | Single table (`embeddings`) | Simpler initial implementation |
| xterm.js version | v5 | v6 | Newer release available at implementation time |
| Terminal theme | Match CSS vars | Hardcoded Tokyo Night Dark | Quicker to implement; CSS var integration planned later |

---

## 16. Project Strategy Documentation Map

### Where to Find Design Decisions

| Topic | Document |
|---|---|
| Overall architecture & vision | `project_strategy/project_review_and_strategy_v2.md` |
| Philosophy & principles | `project_strategy/foundation/00_philosophy_and_principles.md` |
| System architecture (3-process model) | `project_strategy/foundation/01_system_architecture.md` |
| Tech stack with swap conditions | `project_strategy/foundation/02_tech_stack.md` |
| Data schema (SQLite + LanceDB) | `project_strategy/foundation/03_data_schema.md` |
| Context engine spec | `project_strategy/modules/04_module_context_engine.md` |
| Knowledge graph spec | `project_strategy/modules/05_module_knowledge_graph.md` |
| IDE/Editor spec | `project_strategy/modules/06_module_ide.md` |
| Terminal spec | `project_strategy/modules/07_module_terminal.md` |
| Agent layer spec | `project_strategy/modules/08_module_agent_layer.md` |
| Phase definitions (0-7) | `project_strategy/phases/09_phase0_skeleton.md` through `16_phase7_advanced.md` |
| Risk register | `project_strategy/reference/17_risk_register.md` |
| Vision scenarios | `project_strategy/reference/18_vision.md` |
| Current execution state | `conductor/tracks/context_engine_20260226/plan.md` |
| Session log (Feb 27) | `docs/feb_27_updates.md` |
| Dev workflow protocol | `conductor/workflow.md` |
| Product definition | `conductor/product.md` |
| Brand/UX guidelines | `conductor/product-guidelines.md` |
| Code style guides | `conductor/code_styleguides/` |

### Study Guides (Educational Background)

| Guide | Topic |
|---|---|
| `foundation/study_01` | System architecture concepts (processes, IPC, WebViews) |
| `foundation/study_02` | Embeddings and semantic search (vectors, ANN, LanceDB) |
| `foundation/study_03` | AST parsing and code intelligence (tree-sitter) |
| `foundation/study_04` | Database concepts (SQLite, WAL, B-trees) |
| `foundation/study_05` | Rust, Tauri, and reactive frontends (SolidJS) |
| `modules/study_01` | File watching and event pipelines |
| `modules/study_02` | NER, fuzzy matching, auto-linking |
| `modules/study_03` | Terminal emulation and PTY |
| `modules/study_04` | LLM routing and context windows |
| `modules/study_05` | CodeMirror 6 extension architecture |
| `phases/study_01-05` | Dev environment, testing, delivery, packaging, git integration |
