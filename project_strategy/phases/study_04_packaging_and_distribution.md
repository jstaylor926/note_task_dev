# Study Guide: Packaging, Distribution, and Cross-Platform Concerns

> This guide covers how to turn three separate codebases into a single distributable application — building the Tauri binary, bundling the Python sidecar, and handling the differences between macOS, Linux, and Windows.

---

## 1. What Gets Shipped?

The final deliverable is a native application installer. The user double-clicks it, and the workspace app installs like any other desktop app. They shouldn't need to install Rust, Node.js, or Python.

The installer contains:

```
My Workspace.app (or .exe or .AppImage)
├── Main binary (Tauri/Rust)
│   ├── Rust runtime + application logic
│   ├── Embedded frontend assets (SolidJS bundle, ~200 KB)
│   └── Statically linked SQLite
│
├── Python sidecar (bundled separately)
│   ├── Python interpreter (embedded or system)
│   ├── All Python dependencies (FastAPI, litellm, sentence-transformers, etc.)
│   └── ML models (all-MiniLM-L6-v2, ~80 MB)
│
└── Resources
    ├── Default configuration files
    ├── tree-sitter grammars
    └── Icons and assets
```

---

## 2. Building the Tauri Binary

### Development Build

```bash
pnpm tauri dev
# Compiles Rust in debug mode (fast compilation, slower runtime)
# Starts Vite dev server (frontend hot-reloads)
# Opens the app window
```

### Production Build

```bash
pnpm tauri build
```

This command:

1. **Builds the frontend:** Runs `pnpm build` (Vite production build). Output: optimized JS/CSS in `dist/`.
2. **Compiles Rust:** Runs `cargo build --release`. The `--release` flag enables optimizations (slower to compile, much faster to run). The compiled binary embeds the `dist/` contents.
3. **Creates an installer:** Packages the binary into a platform-specific installer.

### Platform-Specific Outputs

| Platform | Output | Size (approximate) |
|----------|--------|-------------------|
| macOS | `.dmg` containing `.app` bundle | 10-15 MB (main binary) |
| Windows | `.msi` or `.exe` installer | 10-15 MB |
| Linux | `.deb`, `.rpm`, or `.AppImage` | 10-15 MB |

These sizes are for the Tauri binary alone. The Python sidecar adds significantly more (see below).

---

## 3. Bundling the Python Sidecar

### The Challenge

The Tauri binary is self-contained — Rust compiles to a native executable with no runtime dependencies. But the Python sidecar needs a Python interpreter and hundreds of MB of packages (sentence-transformers alone is ~400 MB with PyTorch).

### Option 1: PyInstaller (Self-Contained Binary)

**PyInstaller** packages a Python application into a single executable that includes:
- A Python interpreter
- All imported packages
- Data files

```bash
# In the sidecar directory
pip install pyinstaller
pyinstaller --onefile --name workspace-sidecar main.py
# Output: dist/workspace-sidecar (single executable, ~200-500 MB)
```

**Pros:** Users don't need Python installed. Single file to distribute.
**Cons:** Large binary size. Startup time can be slow (unpacking). Some packages (especially ML/CUDA) have compatibility issues.

### Option 2: Bundled Virtual Environment

Ship a pre-created virtual environment alongside the main binary:

```
MyWorkspace.app/
├── Contents/
│   ├── MacOS/
│   │   └── my-workspace     (Tauri binary)
│   └── Resources/
│       └── sidecar/
│           ├── .venv/        (pre-built Python venv)
│           └── main.py
```

The Rust code spawns: `{app_dir}/sidecar/.venv/bin/python {app_dir}/sidecar/main.py`

**Pros:** Simpler than PyInstaller, no unpacking overhead.
**Cons:** Requires Python to be installed (or bundled). Platform-specific (venv compiled for one OS).

### Option 3: Require Python + pip install

The simplest approach for early development: require the user to have Python 3.11+ installed, and the app installs sidecar dependencies on first launch.

```rust
// On first launch:
// 1. Check if Python 3.11+ exists: python3 --version
// 2. Create virtual environment: python3 -m venv sidecar/.venv
// 3. Install dependencies: sidecar/.venv/bin/pip install -r requirements.txt
// 4. Download models: python -c "from sentence_transformers import ..."
```

**Pros:** Smallest installer. Always gets latest packages.
**Cons:** Requires Python pre-installed. First launch is slow (downloading 500+ MB of packages).

### Recommendation for Phases 0-5

Start with Option 3 (require Python) during development. This avoids the complexity of packaging until you're ready for distribution. Switch to Option 1 or 2 when preparing for release.

---

## 4. ML Model Distribution

### The Model Size Problem

| Model | Size | Purpose |
|-------|------|---------|
| all-MiniLM-L6-v2 (chosen default) | ~80 MB | Text embedding |
| codebert-base (optional alternative) | ~440 MB | Code embedding |
| Ollama models (llama3:8b) | ~4.7 GB | LLM inference |

The project uses **all-MiniLM-L6-v2** as the default embedding model (good balance of speed, size, and quality). codebert-base is a potential alternative for code-specific embeddings but adds significant size. Bundling any of these in the installer would make it enormous. Instead:

### Download on First Use

```python
from sentence_transformers import SentenceTransformer

def get_embedding_model():
    model_path = get_data_dir() / "models" / "all-MiniLM-L6-v2"
    if not model_path.exists():
        # Downloads to cache on first call
        model = SentenceTransformer("all-MiniLM-L6-v2", cache_folder=str(model_path))
    else:
        model = SentenceTransformer(str(model_path))
    return model
```

The UI shows a progress indicator: "Downloading embedding model (80 MB)... This only happens once."

### Ollama Models

Ollama handles its own model management. The app checks if the required model is available:

```python
import httpx

async def ensure_model_available(model_name: str):
    try:
        response = await httpx.get("http://localhost:11434/api/tags")
        installed = [m["name"] for m in response.json()["models"]]
        if model_name not in installed:
            # Prompt user to pull the model
            notify_user(f"Model {model_name} not found. Run: ollama pull {model_name}")
    except httpx.ConnectError:
        notify_user("Ollama not running. Please start Ollama first.")
```

---

## 5. Cross-Platform Differences

### File Paths

| OS | Home Directory | App Data | Config |
|----|---------------|----------|--------|
| macOS | `/Users/name` | `~/Library/Application Support/MyWorkspace` | `~/Library/Application Support/MyWorkspace/config` |
| Linux | `/home/name` | `~/.local/share/myworkspace` | `~/.config/myworkspace` |
| Windows | `C:\Users\name` | `%APPDATA%\MyWorkspace` | `%APPDATA%\MyWorkspace\config` |

Tauri provides platform-aware path resolution:
```rust
use tauri::api::path::app_data_dir;
let data_dir = app_data_dir(&config).expect("failed to get data dir");
// Returns the correct path for each OS
```

**Never hardcode paths.** Always use Tauri's path resolver or Rust's `dirs` crate.

### Shell Differences

| OS | Default Shell | Shell Integration |
|----|--------------|-------------------|
| macOS | zsh | `precmd`/`preexec` hooks |
| Linux | bash (usually) | `PROMPT_COMMAND` + `trap DEBUG` |
| Windows | PowerShell | `$PSDefaultParameterValues`, prompt function |

The terminal module detects the shell from the `$SHELL` environment variable (Unix) or registry (Windows) and injects the appropriate hooks.

### WebView Engine

| OS | Engine | Concerns |
|----|--------|----------|
| macOS | WebKit (Safari) | Generally good, but some CSS grid edge cases differ from Chromium |
| Windows | WebView2 (Edge/Chromium) | Closest to Chrome DevTools behavior |
| Linux | WebKitGTK | Oldest engine — test carefully. Some CSS features may render differently |

**Development tip:** Develop primarily on your main OS, but periodically test on others. The most common rendering differences are in: CSS grid/flexbox edge cases, font rendering, and scrollbar styling.

---

## 6. Auto-Updates

Tauri includes a built-in updater plugin:

```json
// tauri.conf.json
{
  "plugins": {
    "updater": {
      "endpoints": ["https://releases.myworkspace.com/{{target}}/{{arch}}/{{current_version}}"],
      "pubkey": "your-public-key-here"
    }
  }
}
```

When the app launches, it checks the endpoint for a newer version. If found, it downloads and applies the update. Updates are signed with a private key and verified with the public key to prevent tampering.

For a solo project, the simplest update channel is **GitHub Releases**: upload build artifacts to a GitHub release, and point the updater endpoint at the GitHub Releases API.

---

## 7. Development vs. Production Configuration

```yaml
# config.dev.yaml (development)
sidecar:
  command: "uv run python sidecar/main.py"
  port: 9400
  auto_restart: true
debug:
  verbose_logging: true
  show_ipc_messages: true

# config.prod.yaml (production)
sidecar:
  command: "{app_dir}/sidecar/workspace-sidecar"  # PyInstaller binary
  port: 9400
  auto_restart: true
debug:
  verbose_logging: false
  show_ipc_messages: false
```

Tauri's build system can set environment variables that your code reads to determine which configuration to use:

```rust
#[cfg(debug_assertions)]
const CONFIG_PATH: &str = "config.dev.yaml";

#[cfg(not(debug_assertions))]
const CONFIG_PATH: &str = "config.prod.yaml";
```

`debug_assertions` is true for `cargo build` (dev) and false for `cargo build --release` (production).

---

## Key Takeaways

1. **The Tauri binary is easy to ship.** Rust compiles to a small, self-contained native binary. Vite bundles the frontend into ~200 KB of static assets embedded in the binary.

2. **The Python sidecar is the packaging challenge.** Start with "require Python installed" during development. Move to PyInstaller or bundled venv for distribution.

3. **ML models are downloaded on first use.** Don't bundle gigabytes of models in the installer. Download them on demand with progress indicators.

4. **Cross-platform differences are mostly in paths and shells.** Use Tauri's path resolver. Detect the shell and inject appropriate hooks. Test WebView rendering on each platform.

5. **Auto-updates via GitHub Releases.** Tauri's updater plugin makes this straightforward for a solo project.

---

## Further Reading

- [Tauri Build & Distribution](https://v2.tauri.app/distribute/) — Official packaging guide
- [PyInstaller Documentation](https://pyinstaller.org/) — Bundling Python applications
- [Tauri Updater Plugin](https://v2.tauri.app/plugin/updater/) — Auto-update system
- [Cross-Platform Rust](https://doc.rust-lang.org/reference/conditional-compilation.html) — Platform-specific compilation
