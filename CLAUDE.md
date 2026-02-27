# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cortex is an AI-augmented desktop workspace built with a three-process architecture:
- **Tauri 2.0 (Rust)** — Main process: state management, SQLite, file watching, PTY terminals, IPC
- **SolidJS (TypeScript)** — Frontend: reactive UI in a Tauri webview
- **FastAPI (Python)** — Sidecar: semantic search, LanceDB vector embeddings, LLM integration

## Commands

### Frontend (pnpm)
```bash
pnpm dev              # Vite dev server (port 1420)
pnpm build            # Production build
pnpm test             # Run Vitest once
pnpm test:watch       # Vitest watch mode
pnpm test -- src/components/__tests__/SearchPanel.test.tsx  # Single test file
```

### Tauri (full app)
```bash
pnpm tauri dev        # Launch full app (runs pnpm dev + cargo build + sidecar)
pnpm tauri build      # Production build
```

### Rust backend
```bash
cd src-tauri && cargo build          # Build Rust backend
cd src-tauri && cargo test           # Run Rust tests
cd src-tauri && cargo test db::      # Run tests in a specific module
```

### Python sidecar
```bash
cd sidecar && uv sync                        # Install/sync dependencies
cd sidecar && uv run pytest                  # Run all sidecar tests
cd sidecar && uv run pytest tests/test_chunking.py  # Single test file
cd sidecar && uv run pytest -x              # Stop on first failure
CORTEX_TEST_MODE=1 uv run pytest            # Skip loading ML model (uses zero vectors)
```

## Architecture

### IPC Pattern
Frontend calls Rust via `invoke()` mapped to `#[tauri::command]` handlers. Async events flow back via `app_handle.emit()` listened to with `listen()` on the frontend.

- **Commands** (request-response): defined in `src-tauri/src/commands.rs` and `pty_commands.rs`, registered in `main.rs` invoke_handler
- **Events** (one-way push): payload types in `src-tauri/src/events.rs`, constants like `indexing:progress`, `pty:output`, `pty:exit`
- **Frontend IPC clients**: `src/lib/tauri.ts` (search, health, indexing) and `src/lib/pty.ts` (terminal)

### Tauri Commands (complete list)
- `commands::health_check` — returns `HealthStatus {tauri, sidecar, sqlite, lancedb}`
- `commands::get_app_status` — sidecar process status string
- `commands::semantic_search` — proxies to sidecar `/search` with filters
- `commands::get_indexing_status` — returns current `IndexingState`
- `pty_commands::pty_create`, `pty_write`, `pty_resize`, `pty_kill` — terminal session management

### Sidecar API Endpoints
- `GET /health` — status + version + lancedb state
- `POST /embed` — embed single text into LanceDB
- `POST /ingest` — chunk + embed a full file (uses tree-sitter AST for code)
- `DELETE /embeddings?source_file=...` — remove embeddings for a file
- `GET /search?query=&limit=&language=&source_type=&chunk_type=&file_path_prefix=` — vector search with filters

### State Management
- **Rust**: `AppState` struct in `main.rs` with `Mutex<T>` fields (db, sidecar_manager, indexing, pty_manager), accessed via `tauri::State<'_, AppState>`
- **SolidJS**: `createSignal` for simple values, `createStore` + `produce()` for complex nested state (see `src/lib/terminalState.ts`)

### Key Subsystems
- **File watcher** (`watcher.rs`, `ingest.rs`): notify crate → 300ms debounce → gitignore + `.contextignore` filter → SHA256 diff → sidecar embed → SQLite update. Indexed extensions: `rs, py, ts, tsx, js, jsx, md, txt, toml, json, yaml, yml, html, css, sql, sh, bash, zsh`
- **Terminal** (`pty.rs`, `pty_commands.rs`, `osc_parser.rs`, `shell_hooks.rs`): portable-pty sessions with base64-encoded I/O over Tauri events. Shell hooks use OSC 633 sequences (installed via `ZDOTDIR`/`ENV` override) to emit `terminal:command-start` and `terminal:command-end` events
- **Sidecar** (`sidecar.rs`): spawned via `uv run --directory {sidecar_dir} python -m cortex_sidecar.main --port 9400 --host 127.0.0.1`. Health monitor waits 3s initially, checks every 10s, auto-restarts with exponential backoff
- **Database** (`db.rs`): SQLite in WAL mode, schema in `SCHEMA_SQL` constant, single connection behind Mutex. Key tables: `entities`, `entity_links`, `tasks`, `chat_messages`, `terminal_commands`, `file_index`, `git_events`, `workspace_profiles`, `session_states`
- **Chunking** (`sidecar/cortex_sidecar/chunking.py`): tree-sitter AST for code (Rust/Python/JS/TS), heading-based for Markdown, top-level key for config (YAML/TOML/JSON), word-window fallback (500 words, 50-word overlap, max 8000 chars)
- **Embedding model**: `all-MiniLM-L6-v2` (sentence-transformers), 384-dimensional vectors stored in LanceDB

### Frontend Layout
`WorkspaceLayout.tsx` renders a 3-column grid. **Functional panels**: SearchPanel, IndexingStatus, TerminalPanel (with PaneContainer, SplitContainer, XtermInstance). **Stub/placeholder panels**: ChatPanel, EditorPanel, NotesPanel, TaskPanel.

`App.tsx` polls health every 1s until all subsystems are ready, then renders `WorkspaceLayout`. In browser-only mode (`"__TAURI_INTERNALS__" not in window`), health checks are skipped.

## Tech Stack Details

| Layer | Key Libraries |
|-------|--------------|
| Frontend | SolidJS 1.9, Vite 6, TailwindCSS 4, xterm.js 6 |
| Backend | Tauri 2, Tokio, rusqlite 0.31 (bundled), notify 8, portable-pty 0.8, anyhow, sha2, ignore |
| Sidecar | FastAPI, LanceDB, sentence-transformers, tree-sitter (Python/JS/TS/Rust grammars) |
| Testing | Vitest 4, @solidjs/testing-library, jsdom, pytest, httpx |

## Testing

- **Vitest globals**: `globals: true` in vitest.config.ts — no need to import `describe`, `it`, `expect`
- Frontend tests use jsdom with Tauri IPC mocked in `src/test/setup.ts` (mocks `@tauri-apps/api/core` and `@tauri-apps/api/event`). The mock also polyfills `ResizeObserver` for xterm.js and exposes `__getListeners()`/`__clearListeners()` helpers
- Component tests use `@solidjs/testing-library` with `render()` and `screen` queries
- Rust tests use inline `#[cfg(test)]` modules in each source file; `db.rs` tests use in-memory SQLite (`:memory:`)
- Python sidecar tests: set `CORTEX_TEST_MODE=1` to skip loading the ML model (uses zero vectors). `CORTEX_DATA_DIR` env var overrides the data directory
- Path alias: `~/*` maps to `src/*` (tsconfig)
- `resolve.conditions: ['development', 'browser']` in vitest config is required for SolidJS

## Conventions

- JSX import source is `solid-js` (not React) — use SolidJS reactive primitives, not React hooks
- No routing — the app is a single-view workspace (no `@solidjs/router`)
- Sidecar runs on port 9400 in dev
- App identifier: `com.cortex.app`
- Database lives at the Tauri app data directory as `cortex.db`
- PTY data is base64-encoded for transport over IPC
- `.contextignore` files (in addition to `.gitignore`) control what gets indexed
- No linting/formatting tooling is configured (no ESLint, Prettier, Biome, rustfmt.toml)
- No CI/CD pipeline configured
- Dark theme defined via CSS custom properties in `src/styles/app.css` (accent: indigo `#6366f1`)
- Commit messages follow conventional format: `feat(scope):`, `fix(scope):`, `test(scope):`, `chore(scope):`, `conductor(plan):`, `conductor(checkpoint):`
- Project strategy/design docs in `project_strategy/` — consult for architectural intent
- Current project state documented in `docs/PROJECT_STATE.md`
- Conductor workflow (`conductor/workflow.md`) mandates TDD (Red-Green-Refactor) and >80% coverage target
