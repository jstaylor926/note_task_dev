# Phase 0: Skeleton

> **Goal:** Tauri app opens, renders a window with a basic layout, Python sidecar starts and responds to health checks, SQLite and LanceDB are initialized. This phase validates the three-process architecture.

---

## Definition of Done

- [ ] Tauri v2 app launches and shows a window
- [ ] SolidJS frontend renders placeholder panels (editor, terminal, notes, chat, tasks)
- [ ] Python sidecar (FastAPI) starts automatically on app launch
- [ ] Health check round-trip works: frontend → Rust → Python → Rust → frontend
- [ ] SQLite database is created on first launch with all tables from the schema
- [ ] LanceDB is initialized with an empty collection
- [ ] Sidecar crash recovery: if the Python process dies, Rust restarts it
- [ ] Basic IPC pattern is validated (at least one invoke + response works end to end)
- [ ] App closes cleanly (sidecar is terminated, no orphan processes)

---

## Key Tasks

### 1. Project Scaffolding

```bash
# Create Tauri project with SolidJS frontend
pnpm create tauri-app --template solid-ts

# Project structure
project-root/
├── src-tauri/           # Rust backend
│   ├── src/
│   │   ├── main.rs      # Tauri entry point
│   │   ├── commands.rs   # IPC command handlers
│   │   ├── sidecar.rs    # Python sidecar management
│   │   └── db.rs         # SQLite initialization
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                 # SolidJS frontend
│   ├── App.tsx          # Root component
│   ├── layouts/
│   │   └── WorkspaceLayout.tsx  # Main panel layout
│   ├── components/
│   │   ├── EditorPanel.tsx      # Placeholder
│   │   ├── TerminalPanel.tsx    # Placeholder
│   │   ├── NotesPanel.tsx       # Placeholder
│   │   ├── ChatPanel.tsx        # Placeholder
│   │   └── TaskPanel.tsx        # Placeholder
│   └── lib/
│       └── tauri.ts     # IPC helpers
├── sidecar/             # Python sidecar
│   ├── main.py          # FastAPI entry point
│   ├── routes/
│   │   └── health.py    # Health check endpoint
│   ├── requirements.txt
│   └── pyproject.toml
├── package.json
└── pnpm-lock.yaml
```

### 2. Rust Backend Setup

**main.rs:** Tauri entry point that:
- Initializes SQLite database (create tables if not exist)
- Spawns the Python sidecar
- Registers IPC commands
- Sets up sidecar health check timer (every 10 seconds)

**sidecar.rs:** Python process management:
- Spawn Python process: `python sidecar/main.py --port 9400`
- Health check: `GET http://127.0.0.1:9400/health`
- Restart on failure (max 3 retries with exponential backoff)
- Kill on app exit

**db.rs:** SQLite initialization:
- Create database file at app data directory
- Enable WAL mode
- Run migration scripts (all tables from `03_data_schema.md`)
- Create default workspace profile if none exists

### 3. Python Sidecar Setup

**main.py:** FastAPI server:
```python
from fastapi import FastAPI
import uvicorn

app = FastAPI()

@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9400)
```

### 4. Frontend Layout

A basic workspace layout with resizable panels:

```
┌────────────────────────────────────────────────────┐
│ [Menu Bar / Profile Selector]                       │
├──────────────┬─────────────────────────────────────┤
│              │                                      │
│  File Tree   │  Editor Panel (placeholder)          │
│  (placeholder│                                      │
│   )          │                                      │
│              │                                      │
│              ├──────────────────────────────────────┤
│              │  Terminal Panel (placeholder)         │
│              │                                      │
├──────────────┼──────────────────────────────────────┤
│  Notes/Tasks │  Chat Panel (placeholder)            │
│  (placeholder│                                      │
│   )          │                                      │
└──────────────┴──────────────────────────────────────┘
```

Use a SolidJS-compatible split pane library or a simple CSS grid with resize handles.

### 5. IPC Validation

Create a minimal IPC round-trip to validate the full communication chain:

```typescript
// Frontend: invoke Rust command
const result = await invoke("health_check");
// Expected: { tauri: "ok", sidecar: "ok", sqlite: "ok", lancedb: "ok" }
```

```rust
// Rust: handle command, call sidecar, check DB
#[tauri::command]
async fn health_check(state: State<AppState>) -> Result<HealthStatus, String> {
    let sidecar = check_sidecar(&state.sidecar_url).await?;
    let sqlite = check_sqlite(&state.db).await?;
    let lancedb = check_lancedb(&state.sidecar_url).await?;
    Ok(HealthStatus { tauri: "ok", sidecar, sqlite, lancedb })
}
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Tauri + SolidJS template doesn't work cleanly | Fallback: scaffold manually with Vite + SolidJS, add Tauri on top |
| Python sidecar port conflict | Use a random available port, pass it via command-line arg |
| SQLite WAL mode issues on some filesystems | Test on target platform early; fallback to DELETE journal mode |
| Sidecar startup time visible to user | Show loading indicator in frontend until health check passes |

---

## Dependencies to Install

**Rust/Tauri:**
```bash
cargo install create-tauri-app
# Tauri prerequisites: see https://v2.tauri.app/start/prerequisites/
```

**Node/Frontend:**
```bash
pnpm install
pnpm add -D @tauri-apps/cli @tauri-apps/api
pnpm add solid-js
```

**Python/Sidecar:**
```bash
uv init sidecar
uv add fastapi uvicorn
```

---

## Estimated Effort

This phase is straightforward scaffolding. Most time will be spent on environment setup (Rust toolchain, Tauri prerequisites, Python virtual environment). The IPC validation is the critical path — everything else in the project depends on this communication pattern working reliably.

---

## Open Questions

- What should the app be named? (Affects directory names, config paths, window title)
- Should we use Tauri's sidecar management (`tauri.conf.json` sidecar config) or manage the Python process manually from Rust?
- What OS are you primarily developing on? (Affects Tauri prerequisites and testing priority)
