# Study Guide: Dev Environment & Toolchain Setup

> This guide explains the three toolchains (Rust, Node.js, Python) that need to coexist in this project, how their package managers work, and how to set up the development environment from scratch. This is the practical foundation for Phase 0.

---

## 1. Three Languages, Three Ecosystems

This project uses three languages, each with its own toolchain:

| Language | Role | Package Manager | Build Tool | Version Manager |
|----------|------|----------------|-----------|-----------------|
| Rust | Tauri backend | Cargo | Cargo (built-in) | rustup |
| JavaScript/TypeScript | SolidJS frontend | pnpm | Vite | Node via nvm/fnm |
| Python | AI/ML sidecar | uv (or pip) | setuptools/pyproject.toml | uv/pyenv |

They don't conflict because each manages its own dependencies independently. But they need to work together through Tauri's build system, which orchestrates all three.

---

## 2. Rust Toolchain

### rustup: The Version Manager

**rustup** manages Rust installations. It lets you install, update, and switch between Rust versions and toolchain channels:

```bash
# Install rustup (installs Rust too)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Check installed version
rustc --version    # e.g., rustc 1.76.0
cargo --version    # e.g., cargo 1.76.0

# Update to latest stable
rustup update stable
```

Rust has three **channels**: `stable` (recommended), `beta` (next release preview), and `nightly` (latest features, may break). Tauri v2 works on stable.

### Cargo: Package Manager + Build Tool

Unlike most languages where the package manager and build tool are separate (npm + webpack, pip + setuptools), Rust's **Cargo** does both:

```bash
cargo build          # Compile the project
cargo run            # Compile and run
cargo test           # Run tests
cargo add serde      # Add a dependency (like npm install)
cargo check          # Fast syntax/type check without full compilation
```

**Cargo.toml** is the manifest (like `package.json`):
```toml
[package]
name = "my-workspace"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["..."] }
rusqlite = { version = "0.31", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
```

**Cargo.lock** pins exact dependency versions (like `package-lock.json`). Always commit this file.

### Crates: Rust's Package Registry

Rust packages are called **crates** and published to [crates.io](https://crates.io). Key crates for this project:

| Crate | Purpose |
|-------|---------|
| `tauri` | Desktop app framework (core runtime) |
| `rusqlite` | SQLite bindings (with `bundled` feature to compile SQLite from source) |
| `serde` / `serde_json` | Serialization/deserialization (JSON ↔ Rust structs) |
| `tokio` | Async runtime (event loop, thread pool) |
| `notify` | Cross-platform file system watching |
| `reqwest` | HTTP client (for calling the Python sidecar) |

### Compilation: Why It's Slow (and Why That's OK)

Rust compilation is notoriously slower than Go, JavaScript, or Python. A full build of a Tauri app might take 2-5 minutes. This is because Rust performs extensive compile-time analysis (borrow checking, monomorphization, optimization).

However, **incremental builds** are fast — after the first full build, changing a single Rust file and recompiling takes 5-15 seconds because Cargo only recompiles what changed.

During development, use `cargo check` instead of `cargo build` for fast feedback (checks types without producing a binary).

---

## 3. Node.js / Frontend Toolchain

### Node.js and Version Management

Node.js runs JavaScript outside the browser. The frontend build tool (Vite) and package manager (pnpm) need Node.js installed.

Use a version manager to avoid conflicts:
```bash
# Install fnm (Fast Node Manager) - recommended over nvm
curl -fsSL https://fnm.vercel.app/install | bash

# Install and use Node 20 LTS
fnm install 20
fnm use 20
node --version   # v20.x.x
```

### pnpm: Efficient Package Manager

**pnpm** is a Node.js package manager like npm or yarn, but faster and more disk-efficient. It stores packages globally and symlinks them into projects, so installing the same package in multiple projects doesn't duplicate it on disk.

```bash
# Install pnpm
npm install -g pnpm

# Install dependencies from package.json
pnpm install

# Add a dependency
pnpm add solid-js
pnpm add -D @tauri-apps/cli   # -D = dev dependency

# Run a script
pnpm dev       # Start development server
pnpm build     # Production build
```

**package.json** is the manifest:
```json
{
  "name": "my-workspace-frontend",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "solid-js": "^1.8",
    "@tauri-apps/api": "^2.0"
  },
  "devDependencies": {
    "vite": "^5.0",
    "vite-plugin-solid": "^2.0",
    "@tauri-apps/cli": "^2.0",
    "tailwindcss": "^4.0"
  }
}
```

### Vite: Frontend Build Tool

**Vite** handles the frontend development experience:

**Development mode** (`pnpm dev`): Starts a local dev server with hot module replacement (HMR). When you save a SolidJS file, the browser updates instantly without a full page reload. Vite doesn't bundle in dev mode — it serves individual modules directly to the browser, which makes startup near-instant.

**Production build** (`pnpm build`): Bundles, minifies, and tree-shakes your frontend code into optimized static files in `dist/`. Tauri embeds these files into the final binary.

```
Development:
  Browser ←→ Vite dev server ←→ Source files (serves on the fly)

Production:
  Source files → Vite bundler → dist/ → Tauri embeds in binary
```

---

## 4. Python Toolchain

### uv: The Modern Python Package Manager

**uv** is a fast Python package manager written in Rust (by the Astral team). It replaces pip, virtualenv, and pip-tools with a single fast tool:

```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Create a new Python project
uv init sidecar
cd sidecar

# Add dependencies
uv add fastapi uvicorn litellm sentence-transformers lancedb

# Run a script in the project's virtual environment
uv run python main.py

# Sync dependencies (like npm install)
uv sync
```

uv automatically creates and manages a virtual environment in `.venv/`. You never need to manually activate it — `uv run` handles it.

### Virtual Environments: Why They Exist

Python installs packages globally by default. If Project A needs `numpy==1.24` and Project B needs `numpy==2.0`, they'd conflict. A **virtual environment** is an isolated Python installation per project:

```
System Python: /usr/bin/python3
  └── numpy 1.24 (global — shared by everything)

Virtual env for sidecar: sidecar/.venv/bin/python
  └── numpy 2.0 (isolated — only for this project)
```

uv handles this automatically. Every `uv add` and `uv run` uses the project's `.venv`.

### pyproject.toml: The Modern Python Manifest

```toml
[project]
name = "workspace-sidecar"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110",
    "uvicorn[standard]>=0.27",
    "litellm>=1.30",
    "sentence-transformers>=2.5",
    "lancedb>=0.5",
    "tree-sitter>=0.22",
    "tree-sitter-languages>=1.10",
    "spacy>=3.7",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "httpx>=0.27"]  # test dependencies
```

**uv.lock** pins exact versions (like Cargo.lock). Commit this file.

---

## 5. How Tauri Orchestrates Everything

### The Tauri Development Flow

When you run `pnpm tauri dev` (the main development command), Tauri orchestrates all three toolchains:

```
pnpm tauri dev
    │
    ├── 1. Start Vite dev server (frontend)
    │      → Serves SolidJS app at http://localhost:1420
    │
    ├── 2. Compile Rust backend (cargo build)
    │      → Produces a binary that includes Tauri runtime
    │
    └── 3. Launch the app
           → Opens a window with WebView pointing at Vite dev server
           → Rust backend starts
           → (Your code spawns the Python sidecar)
```

In development mode, the frontend uses Vite's dev server (with HMR). In production, the frontend is bundled and embedded.

### tauri.conf.json: The Configuration Hub

```json
{
  "productName": "My Workspace",
  "version": "0.1.0",
  "identifier": "com.myworkspace.app",
  "build": {
    "frontendDist": "../dist",       // Where Vite outputs the build
    "devUrl": "http://localhost:1420", // Vite dev server URL
    "beforeDevCommand": "pnpm dev",    // Start Vite before launching
    "beforeBuildCommand": "pnpm build" // Build frontend before packaging
  },
  "app": {
    "windows": [
      {
        "title": "My Workspace",
        "width": 1400,
        "height": 900,
        "resizable": true
      }
    ]
  },
  "plugins": {
    "shell": { "open": true }       // Enable shell plugin for sidecar
  }
}
```

### Directory Structure Revisited

```
project-root/
├── src-tauri/              # Rust backend (Cargo project)
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── commands.rs     # Tauri IPC command handlers
│   │   ├── sidecar.rs      # Python process management
│   │   └── db.rs           # SQLite initialization
│   ├── Cargo.toml          # Rust dependencies
│   ├── Cargo.lock          # Pinned Rust dependency versions
│   └── tauri.conf.json     # Tauri configuration
│
├── src/                    # SolidJS frontend (Vite project)
│   ├── App.tsx             # Root component
│   ├── components/         # UI components
│   ├── lib/                # Utility code
│   └── styles/             # CSS/Tailwind
│
├── sidecar/                # Python sidecar (uv project)
│   ├── main.py             # FastAPI entry point
│   ├── routes/             # API route handlers
│   ├── services/           # Business logic
│   ├── pyproject.toml      # Python dependencies
│   └── uv.lock             # Pinned Python dependency versions
│
├── package.json            # Node.js project manifest
├── pnpm-lock.yaml          # Pinned Node dependency versions
├── vite.config.ts          # Vite build configuration
└── tailwind.config.ts      # Tailwind CSS configuration
```

Each subdirectory is its own ecosystem. They share nothing except IPC calls across the boundaries.

---

## 6. First-Time Setup Checklist

Here's the full setup sequence for a new machine:

```bash
# 1. Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 2. Install Tauri prerequisites (OS-specific)
# macOS: Xcode Command Line Tools
xcode-select --install
# Linux: see https://v2.tauri.app/start/prerequisites/

# 3. Install Node.js via fnm
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 20

# 4. Install pnpm
npm install -g pnpm

# 5. Install uv (Python)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 6. Install Ollama (local LLM)
# macOS: brew install ollama
# Linux: curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3:8b
ollama pull codellama:13b

# 7. Clone and set up the project
git clone <repo-url>
cd project-root

# 8. Install all dependencies
pnpm install                  # Node.js/frontend dependencies
cd sidecar && uv sync && cd .. # Python sidecar dependencies
# Rust dependencies are fetched automatically on first build

# 9. Run in development mode
pnpm tauri dev
```

---

## Key Takeaways

1. **Three independent toolchains.** Rust/Cargo, Node/pnpm, Python/uv each manage their own dependencies. They don't conflict because they're completely separate.

2. **Tauri orchestrates them.** `pnpm tauri dev` starts Vite, compiles Rust, and launches the app. The Python sidecar is managed by your Rust code.

3. **Lock files pin exact versions.** `Cargo.lock`, `pnpm-lock.yaml`, and `uv.lock` ensure reproducible builds. Always commit them.

4. **Incremental compilation matters.** First Rust build is slow (2-5 min). Subsequent builds are fast (5-15 sec). Use `cargo check` for quick feedback.

5. **Virtual environments isolate Python.** uv automatically creates `.venv` per project. Never install sidecar dependencies globally.

---

## Further Reading

- [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/) — OS-specific setup requirements
- [The Rust Book: Getting Started](https://doc.rust-lang.org/book/ch01-01-installation.html) — Installing Rust and first project
- [pnpm Documentation](https://pnpm.io/) — Package manager reference
- [uv Documentation](https://docs.astral.sh/uv/) — Python package manager reference
- [Vite Guide](https://vitejs.dev/guide/) — Frontend build tool documentation
