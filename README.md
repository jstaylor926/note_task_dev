# Cortex: AI-Augmented Workspace

Cortex is an AI-native workspace designed for developers. It integrates persistent semantic memory, a functional terminal, an agentic IDE, and an auto-linking knowledge graph into a local-first application.

## 🚀 Current Status: Phase 2 Complete

We are currently implementing **Phase 1: Context Engine Core**. 

### Completed
- **Phase 1: Sidecar Foundation & Vector DB**
  - Python FastAPI sidecar initialized.
  - LanceDB integration for local vector storage.
  - `/embed` and `/search` API endpoints functional.
- **Phase 2: Rust File Watcher & Ingestion**
  - Cross-platform file watcher (using `notify`) implemented in Rust.
  - Automatic word-aware text chunking.
  - Background ingestion pipeline from Rust to Python sidecar.

### In Progress
- **Phase 3: Integration & UI**
  - Implementing indexing status indicators in the frontend.
  - Basic semantic search interface in the workspace layout.

## 🛠 Tech Stack

- **Frontend:** SolidJS, Vite, TailwindCSS 4
- **Backend:** Tauri 2.0 (Rust)
- **Sidecar:** FastAPI (Python), LanceDB (Vector DB)
- **Relational DB:** SQLite

## 📖 Getting Started

### Prerequisites
- Node.js (v20+) & pnpm
- Rust toolchain
- Python 3.12+ & uv

### Development
1. **Sidecar Setup:**
   ```bash
   cd sidecar
   uv sync
   ```
2. **Run App:**
   ```bash
   pnpm dev
   ```

## 🧠 Documentation

Detailed project strategy and implementation plans can be found in:
- `project_strategy/`: Architectural vision and modular breakdown.
- `conductor/`: Management, tracks, and development workflow.
