# Cortex: AI-Augmented Workspace

Cortex is an AI-native workspace designed for developers, integrating persistent semantic memory, a functional terminal, an agentic IDE, and an auto-linking knowledge graph into a local-first application.

## Project Overview

- **Architecture**: A three-process model consisting of a **Tauri** shell (Rust), a reactive frontend (**SolidJS**), and a specialized AI/ML sidecar (**Python**).
- **Frontend**: Built with **SolidJS**, **Vite**, and **TailwindCSS 4**. It provides a high-performance UI for the workspace.
- **Backend (Tauri/Rust)**: Acts as the system orchestrator, managing the Python sidecar lifecycle, IPC, and the primary **SQLite** database.
- **Sidecar (Python/FastAPI)**: Handles heavy AI/ML workloads, including embedding services and managing **LanceDB** for vector-based semantic search.
- **Data Management**: 
  - **Relational**: SQLite (`cortex.db`) for configuration, sessions, and entity metadata.
  - **Vector**: LanceDB for document and code embeddings.
  - **Location**: Data is stored in the platform-specific app data directory (e.g., `~/Library/Application Support/com.cortex.app` on macOS).

## Project Structure

- `src/`: Frontend source code (SolidJS).
- `src-tauri/`: Rust backend source and Tauri configuration.
- `sidecar/`: Python sidecar source code (FastAPI + LanceDB).
- `project_strategy/`: Comprehensive documentation and design specs (The "Brain" of the project).

## Building and Running

### Prerequisites
- **Node.js** (v20+) & **pnpm** (v10+)
- **Rust** toolchain
- **Python** (v3.12+) & **uv** (recommended for sidecar management)

### Development
1. **Initialize Sidecar Environment**:
   ```bash
   cd sidecar
   uv venv
   source .venv/bin/activate
   uv sync
   ```
2. **Start the Application**:
   ```bash
   pnpm dev
   ```
   *The Tauri backend automatically spawns the Python sidecar in development mode.*

### Key Commands
- `pnpm dev`: Starts the Vite development server and the Tauri app.
- `pnpm build`: Builds the production-ready frontend and Tauri bundle.
- `pnpm tauri`: Access to Tauri CLI commands.

## Development Conventions

- **Documentation First**: Major architectural changes should be updated in the `project_strategy/` documents first.
- **Safety**: Use TypeScript for the frontend and strictly typed Rust for system-critical logic.
- **State Management**: Leverage SolidJS signals for local UI state and Tauri IPC for backend-synchronized state.
- **Local-First**: Prioritize local execution and storage. External LLM routing is managed through the Python sidecar.

## Implementation Roadmap
- **Phase 0**: Skeleton & Scaffolding (Current)
- **Phase 1**: Context Engine Core (Embeddings & Semantic Search)
- **Phase 2**: Session Handoff & LLM Integration
- **Phase 3**: Terminal Integration
- **Phase 4**: Editor (CodeMirror 6)
- **Phase 5**: Knowledge Graph & Task Board
