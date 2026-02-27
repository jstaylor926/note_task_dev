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
cd sidecar && uv sync    # Install/sync dependencies
```

## Architecture

### IPC Pattern
Frontend calls Rust via `invoke()` mapped to `#[tauri::command]` handlers. Async events flow back via `app_handle.emit()` listened to with `listen()` on the frontend.

- **Commands** (request-response): defined in `src-tauri/src/commands.rs` and `pty_commands.rs`, registered in `main.rs` invoke_handler
- **Events** (one-way push): payload types in `src-tauri/src/events.rs`, constants like `indexing:progress`, `pty:output`, `pty:exit`
- **Frontend IPC clients**: `src/lib/tauri.ts` (search, health, indexing) and `src/lib/pty.ts` (terminal)

### State Management
- **Rust**: `AppState` struct in `main.rs` with `Mutex<T>` fields, accessed via `tauri::State<'_, AppState>`
- **SolidJS**: `createSignal` for simple values, `createStore` + `produce()` for complex nested state (see `src/lib/terminalState.ts`)

### Key Subsystems
- **File watcher** (`watcher.rs`, `ingest.rs`): notify crate → 300ms debounce → gitignore filter → SHA256 diff → sidecar embed → SQLite update
- **Terminal** (`pty.rs`, `pty_commands.rs`, `osc_parser.rs`, `shell_hooks.rs`): portable-pty sessions with base64-encoded I/O over Tauri events
- **Sidecar** (`sidecar.rs`): managed Python process with health monitoring every 10s, auto-restart with exponential backoff
- **Database** (`db.rs`): SQLite in WAL mode, schema in `SCHEMA_SQL` constant, single connection behind Mutex

### Frontend Layout
`WorkspaceLayout.tsx` renders a 3-column grid. Panels: Search, Indexing, Editor, Chat, Notes, Tasks, Terminal. Terminal supports tabbed panes with splits (`PaneContainer.tsx`, `SplitContainer.tsx`, `XtermInstance.tsx`).

## Tech Stack Details

| Layer | Key Libraries |
|-------|--------------|
| Frontend | SolidJS 1.9, Vite 6, TailwindCSS 4, xterm.js 6 |
| Backend | Tauri 2, Tokio, rusqlite 0.31 (bundled), notify 8, portable-pty 0.8 |
| Sidecar | FastAPI, LanceDB |
| Testing | Vitest 4, @solidjs/testing-library, jsdom |

## Testing

- Frontend tests use jsdom with Tauri IPC mocked in `src/test/setup.ts` (mocks `@tauri-apps/api/core` and `@tauri-apps/api/event`)
- Component tests use `@solidjs/testing-library` with `render()` and `screen` queries
- Rust tests use `#[cfg(test)]` modules; `db.rs` tests use `tempfile` for isolated SQLite instances
- Path alias: `~/*` maps to `src/*` (tsconfig)

## Conventions

- JSX import source is `solid-js` (not React) — use SolidJS reactive primitives, not React hooks
- Sidecar runs on port 9400 in dev
- Database lives at the Tauri app data directory as `cortex.db`
- PTY data is base64-encoded for transport over IPC
- Project strategy/design docs are in `project_strategy/` — consult these for architectural intent
