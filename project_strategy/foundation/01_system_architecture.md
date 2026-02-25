# System Architecture

> This document defines the high-level architecture, process model, and inter-component communication patterns. It is the structural blueprint that all module-specific documents reference. Future iterations should update this document when adding new components or changing communication patterns.

---

## Architecture Overview

The system is a desktop application built on a three-process model: a Rust-native application core (Tauri), a reactive frontend (SolidJS), and a Python sidecar for ML/AI workloads. All three processes run locally on the user's machine.

### High-Level Component Map

```
┌──────────────────────────────────────────────────────────────────┐
│                     Application Shell (Tauri v2)                  │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Code Editor  │  │  Terminal    │  │  Notes   │  │   Tasks   │  │
│  │ (CodeMirror) │  │  (xterm.js) │  │  (MD)    │  │  (Board)  │  │
│  └──────┬───────┘  └──────┬──────┘  └────┬─────┘  └─────┬─────┘  │
│         │                 │              │               │        │
│         └────────┬────────┴──────┬───────┴───────┬───────┘        │
│                  ▼               ▼               ▼                │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              Orchestration Layer (Rust + Python Sidecar)     │  │
│  │                                                              │  │
│  │  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │  │
│  │  │ Context      │  │ Knowledge     │  │ Agent            │  │  │
│  │  │ Engine       │  │ Graph Engine  │  │ Router           │  │  │
│  │  │              │  │               │  │                  │  │  │
│  │  │ File Watcher │  │ Entity Extract│  │ LLM Routing      │  │  │
│  │  │ AST Parser   │  │ Auto-Linker   │  │ Background Jobs  │  │  │
│  │  │ Session Mgr  │  │ Semantic Query│  │ Webhook Handler  │  │  │
│  │  └──────┬───────┘  └───────┬───────┘  └────────┬─────────┘  │  │
│  └─────────┼──────────────────┼────────────────────┼────────────┘  │
│            ▼                  ▼                    ▼               │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    Hybrid Storage Layer                      │  │
│  │                                                              │  │
│  │  SQLite (WAL mode)                 LanceDB (embedded)        │  │
│  │  ─────────────────                 ──────────────────        │  │
│  │  Session state                     Code embeddings           │  │
│  │  Workspace profiles                Note embeddings           │  │
│  │  Task metadata                     Terminal log embeddings   │  │
│  │  Entity graph                      File chunk vectors        │  │
│  │  Chat history                                                │  │
│  │  Terminal command log                                        │  │
│  │  Git event log                                               │  │
│  │  File index (hashes)                                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Process Model

### Process 1: Tauri Main Process (Rust)

**Role:** Application core, system coordinator, performance-critical operations.

**Responsibilities:**
- Window management and native OS integration
- IPC hub between frontend and Python sidecar
- File system access (read/write/watch via `notify` crate or delegated to sidecar)
- PTY management for terminal emulator (via `tauri-plugin-pty`)
- SQLite database access (direct, via `rusqlite` or `sqlx`)
- Python sidecar lifecycle management (start, health check, restart on crash)
- Git operations (via `git2` crate or shell commands)

**Why Rust:** File watching, PTY management, and SQLite access are performance-sensitive and benefit from Rust's zero-overhead abstractions. The Tauri framework provides the application shell natively.

### Process 2: Python Sidecar (FastAPI)

**Role:** ML/AI workloads, embedding generation, LLM routing, AST parsing, entity extraction.

**Responsibilities:**
- LLM call routing via litellm (Ollama, Claude, OpenAI, Gemini)
- Embedding generation via sentence-transformers (local) or API
- tree-sitter AST parsing and smart chunking
- Entity extraction (NER, task detection, reference extraction)
- LanceDB read/write operations
- Background agent execution (research daemon, pipeline monitor, digest agent)
- Webhook/API endpoint serving for external integrations

**Communication:** Local HTTP on `127.0.0.1:9400` (configurable port). The Rust process makes HTTP requests to the sidecar. The sidecar never initiates communication — it only responds to requests or runs scheduled background tasks.

**Lifecycle:** The Tauri process spawns the Python sidecar on startup using Tauri's sidecar command system or a managed subprocess. It performs periodic health checks (`GET /health`). If the sidecar crashes, Tauri restarts it automatically. The frontend shows a degraded-mode indicator while the sidecar is unavailable.

**Why Python:** The ML/AI ecosystem (sentence-transformers, litellm, tree-sitter bindings, spaCy/NER) is Python-native. Running these in Python avoids FFI complexity and gives access to the full ecosystem.

### Process 3: Frontend (SolidJS)

**Role:** UI rendering, user interaction, state presentation.

**Responsibilities:**
- Rendering all UI panels (editor, terminal, notes, tasks, chat, search)
- User input handling and event delegation
- Local UI state management (panel layouts, active tabs, scroll positions)
- Communication with Rust backend exclusively via Tauri's `invoke()` IPC

**Communication:** All data flows through Tauri IPC. The frontend never communicates directly with the Python sidecar. This ensures centralized state management and a single source of truth in the Rust layer.

**Why SolidJS:** No virtual DOM overhead — compiles to direct DOM updates. Better suited than React for high-frequency UI updates (terminal output streams, live file tree changes, streaming LLM responses). JSX syntax is familiar. Tiny bundle size pairs well with Tauri's small footprint.

---

## Communication Patterns

### Request-Response (Synchronous)

```
Frontend ──invoke("search", {query})──► Rust ──POST /search──► Python
Frontend ◄──result────────────────────── Rust ◄──JSON────────── Python
```

Used for: semantic search, session state retrieval, task CRUD, entity queries.

### Streaming (Server-Sent Events / Channels)

```
Frontend ──invoke("chat", {message})──► Rust ──POST /chat──► Python (litellm streaming)
Frontend ◄──Tauri event channel─────── Rust ◄──SSE stream── Python
```

Used for: LLM chat responses, long-running agent outputs, progress indicators for background tasks.

### Event-Driven (Fire and Forget)

```
Rust (file watcher) ──POST /index──► Python (async processing)
                                          │
                                          ▼
                                     LanceDB upsert + SQLite entity update
                                          │
                                          ▼
                                     Tauri event ──► Frontend (UI refresh)
```

Used for: file change indexing, terminal command logging, git event processing.

### Background Task Scheduling

```
Python sidecar (internal scheduler)
    ├── Research daemon: runs on cron schedule
    ├── Pipeline monitor: polls process list / log files
    ├── Digest agent: runs on session start
    └── Session state periodic snapshot: runs every N minutes
```

Background tasks write results to SQLite/LanceDB and optionally emit Tauri events to update the frontend.

---

## State Management Strategy

### Application State (Rust)

The Rust process holds the authoritative application state:
- Current workspace profile
- Active session ID
- Open file list and active file
- Terminal session metadata
- Sidecar health status

This state is accessible to the frontend via Tauri's state management APIs.

### UI State (SolidJS)

The frontend manages transient UI state:
- Panel layout (split positions, which panels are visible)
- Scroll positions
- Editor cursor position
- Search query input
- Dropdown/modal open states

UI state is not persisted — it's reconstructed on app start from the session state payload (which tracks `last_active_file`, `open_files`, etc.).

### Persistent State (SQLite + LanceDB)

All durable state lives in the storage layer:
- SQLite: structured data (session states, entities, tasks, chat history, terminal logs, git events)
- LanceDB: vector embeddings (code chunks, note chunks, terminal output chunks)

See `03_data_schema.md` for full schema definitions.

---

## Concurrency Model

### Rust Layer
- Tauri's async runtime (tokio) handles concurrent IPC calls
- File watcher runs on a dedicated thread
- SQLite access uses WAL mode for concurrent reads/single writer
- PTY management runs on dedicated threads per terminal instance

### Python Layer
- FastAPI runs with uvicorn (async event loop)
- Embedding generation is CPU-bound — use a thread pool executor for parallel embedding batches
- LLM calls are I/O-bound — async HTTP requests via litellm
- Background agents run as asyncio tasks with configurable intervals
- tree-sitter parsing is CPU-bound — offload to thread pool

### Frontend
- SolidJS's fine-grained reactivity handles UI updates without virtual DOM diffing
- Web Workers for expensive client-side operations (large file tree rendering, search result processing)
- xterm.js handles its own rendering pipeline

---

## Error Handling & Resilience

### Sidecar Crash Recovery
1. Rust detects sidecar health check failure
2. Frontend receives "sidecar unavailable" event → shows degraded mode indicator
3. Rust attempts restart (max 3 retries with exponential backoff)
4. After recovery, sidecar re-initializes from SQLite/LanceDB state (no in-memory state to lose)
5. Frontend receives "sidecar available" event → removes degraded mode indicator

### Session State Crash Safety
1. Periodic snapshots every 5 minutes write to SQLite
2. SQLite WAL mode ensures atomic writes
3. On crash recovery, the most recent snapshot is available for hydration
4. Maximum data loss: 5 minutes of session state delta

### Storage Corruption Recovery
1. SQLite: WAL mode provides built-in corruption recovery
2. LanceDB: if an embedding collection is corrupted, re-index from source files (the file index in SQLite tracks what needs re-embedding)
3. Backup strategy: periodic SQLite database backup to a user-configured location

---

## Security Model

### Local-Only Default
- No network requests unless the user has configured cloud API keys
- Python sidecar binds to `127.0.0.1` only (no external network access)
- Webhook endpoints (if enabled) bind to `127.0.0.1` only

### Workspace Profile Isolation
- "Work" profile can be configured to block all cloud API routing regardless of global settings
- LanceDB collections are isolated per workspace profile
- Session states are scoped to workspace profiles

### Sensitive Data Handling
- API keys stored in OS keychain (via Tauri's keychain plugin) or a local encrypted config file
- Chat history containing code snippets is stored locally in SQLite, never sent to analytics
- Git credentials are never stored — delegate to system git credential manager

---

## Open Questions for Future Iterations

- Should the Python sidecar be replaceable with a Rust-native ML stack (e.g., `candle` for inference, `ort` for ONNX embedding)? This would eliminate the Python dependency but lose ecosystem access.
- Should the Rust layer use an embedded HTTP server (e.g., `axum`) for the webhook API instead of routing through the Python sidecar?
- Is `127.0.0.1:9400` the right communication pattern, or should we use Unix domain sockets for lower overhead?
- Should the frontend use a service worker for offline caching of static assets?
- How should multi-monitor support work? (Multiple windows vs. single window with panel detach)
