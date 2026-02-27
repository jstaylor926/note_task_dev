# Tech Stack: Cortex

## Frontend
- **Framework:** SolidJS (High-performance, fine-grained reactivity)
- **Bundler:** Vite
- **Styling:** TailwindCSS 4
- **Communication:** @tauri-apps/api (IPC with Rust backend)

## Backend (System Orchestration)
- **Core:** Tauri 2.0 (Rust)
- **State Management:** Rust `AppState` with Mutex-guarded resources
- **Database (Relational):** SQLite via `rusqlite` (Bundled)
- **Concurrency:** Tokio (Async runtime)

## Sidecar (AI/ML Services)
- **Framework:** FastAPI (Python)
- **Server:** Uvicorn
- **Database (Vector):** LanceDB (Local-first vector storage)
- **Environment Management:** `uv` (Fast dependency management)

## Shared Architecture
- **Protocol:** HTTP (between Rust and Python sidecar)
- **Health Monitoring:** Background health check loop in Rust
- **Platform:** Cross-platform (Windows, macOS, Linux)
