# Tech Stack

> This document catalogs every technology choice, the rationale behind it, known alternatives, and the conditions under which a swap should be considered. Future iterations should update this document when evaluating new tools or when a chosen tool's status changes.

---

## Stack Summary

| Layer | Choice | Version Target | Role |
|-------|--------|---------------|------|
| Application Shell | Tauri v2 | v2.4+ | Desktop app framework, Rust backend, native window management |
| Frontend Framework | SolidJS | v1.9+ | Reactive UI rendering, JSX components |
| UI Components | Kobalte / custom | — | Accessible component primitives |
| Styling | TailwindCSS | v4+ | Utility-first CSS |
| Code Editor | CodeMirror 6 | v6.x | Embeddable code editor with extension API |
| Terminal Emulator | xterm.js | v5.x | PTY-backed terminal rendering |
| Terminal Backend | tauri-plugin-pty | latest | Pseudo-terminal management for Tauri |
| Backend Language | Rust | 1.75+ | Performance-critical backend operations |
| Sidecar Language | Python | 3.11+ | ML/AI workloads, embedding, LLM routing |
| Sidecar Framework | FastAPI | 0.110+ | Async HTTP server for Python sidecar |
| Relational DB | SQLite | 3.40+ | Structured data, session state, entity graph |
| SQLite Driver (Rust) | rusqlite or sqlx | — | Rust-native SQLite access |
| Vector Store | LanceDB | 0.6+ | Embedded vector database for semantic search |
| LLM Routing | litellm | 1.40+ | Unified API for Ollama, Claude, OpenAI, Gemini |
| Local LLM Runtime | Ollama | latest | Local model serving (Llama 3, CodeLlama, Mistral) |
| Embeddings (Local) | sentence-transformers | latest | Local embedding generation |
| Embeddings (Code) | codebert-base / codellama | — | Code-specific embeddings |
| AST Parsing | tree-sitter + py-tree-sitter | v0.25+ | Language-agnostic code parsing |
| File Watching | watchdog (Python) or notify (Rust) | — | File system change detection |
| CLI Framework | Typer | 0.12+ | CLI commands for development/debugging |
| Package Manager (Python) | uv | latest | Fast Python dependency management |
| Package Manager (JS) | pnpm | v9+ | Node dependency management |
| Build Tool (Rust) | cargo | — | Rust build system |

---

## Detailed Rationale

### Tauri v2

**What it is:** A framework for building desktop applications with a Rust backend and web-based frontend. Uses native OS WebViews instead of bundling Chromium.

**Why chosen:**
- Binary size: 2-3 MB (vs. Electron's 80-120 MB)
- Memory footprint: 30-40 MB idle (vs. Electron's 200-300 MB)
- Native Rust backend with type-safe IPC to the frontend
- Plugin ecosystem for PTY, file system, keychain, etc.
- Active development with growing community (35% YoY adoption growth post-v2)

**Known tradeoffs:**
- WebKit on Linux can have rendering differences from Chromium — test terminal and editor rendering early
- Smaller ecosystem than Electron — fewer third-party Tauri-specific packages
- Debugging is split across Rust (backend) and browser (frontend) — two debugger setups

**Alternatives considered:**
- **Electron:** More mature, larger ecosystem, but bloated. Unacceptable binary size and memory footprint for a tool that should feel lightweight.
- **Neutralinojs:** Even lighter than Tauri but less mature, no Rust backend.
- **Native (GTK/Qt via Rust):** Maximum performance but losing web-based UI flexibility. Would require building editor and terminal from scratch.

**Swap condition:** Swap to Electron only if a critical dependency (e.g., a specific CodeMirror plugin) requires Chromium-specific APIs that WebKit can't handle.

---

### SolidJS

**What it is:** A reactive UI framework that compiles JSX to direct DOM operations without a virtual DOM.

**Why chosen:**
- No virtual DOM overhead — critical for high-frequency updates (terminal output, streaming LLM responses)
- Tiny bundle size (pairs well with Tauri's small footprint)
- JSX syntax familiar from React
- Fine-grained reactivity model prevents unnecessary re-renders
- Growing ecosystem and strong documentation

**Known tradeoffs:**
- Smaller ecosystem than React — fewer off-the-shelf component libraries
- Some React patterns don't translate directly (e.g., `useEffect` behavior differs)
- Fewer developers have SolidJS experience (matters less for a solo project)

**Alternatives considered:**
- **React:** Largest ecosystem, most familiar. Larger bundle, virtual DOM overhead.
- **Svelte:** Similar compilation-based approach, but Svelte 5 (runes) is still maturing.
- **Preact:** React-compatible with smaller footprint, but still has virtual DOM.

**Swap condition:** Swap to React if you find yourself blocked by missing SolidJS component libraries or if a critical UI library (e.g., a complex data grid) only has a React implementation.

---

### CodeMirror 6

**What it is:** A modular code editor library for the browser, used by Chrome DevTools and Replit.

**Why chosen:**
- Modular architecture: ~300 KB core (vs. Monaco's 5-10 MB)
- Excellent extension API for building custom features (semantic annotations, AI suggestions)
- Active development, well-documented
- Tree-sitter integration is possible for enhanced syntax highlighting
- Mobile-friendly (future-proofing if a mobile companion is ever built)

**Known tradeoffs:**
- Less "batteries included" than Monaco — features like minimap, multi-cursor, and git gutter require extensions or custom implementation
- No built-in LSP client (need a community package or custom implementation)
- Smaller community than Monaco/VS Code ecosystem

**Alternatives considered:**
- **Monaco Editor:** Powers VS Code. Full-featured out of the box but 5-10 MB bundle, desktop-only, harder to customize deeply.
- **Ace Editor:** Mature but older architecture, less extensible than CodeMirror 6.

**Swap condition:** Swap to Monaco if CodeMirror's extension API proves insufficient for a critical feature (e.g., if LSP integration requires too much custom code).

---

### xterm.js + tauri-plugin-pty

**What it is:** xterm.js is a browser-based terminal emulator; tauri-plugin-pty manages pseudo-terminal processes in Tauri.

**Why chosen:**
- Proven combination — projects like Terminon validate this stack in Tauri
- xterm.js is the same terminal engine used in VS Code
- Clean separation: xterm.js handles rendering, PTY plugin handles process management
- Addons available: fit, web-links, search, unicode

**Known tradeoffs:**
- xterm.js + WebKit on Linux may have font rendering differences
- PTY management adds complexity (signal handling, process cleanup on app exit)

**Alternatives considered:**
- **Built-in Tauri terminal:** Doesn't exist as a native component — would require building from scratch.
- **Alacritty-based (Rust terminal):** Would require complex embedding; not designed as an embeddable library.

**Swap condition:** Unlikely to need swapping. If WebKit rendering issues are severe on Linux, consider wrapping Alacritty as a sidecar process with its own window.

---

### SQLite

**What it is:** Embedded relational database, single-file, zero-config.

**Why chosen:**
- No server process — embedded directly in the Rust binary
- Single file — easy to backup, move between machines, version
- WAL mode enables concurrent reads with single writer
- Handles the deterministic state needs (session payloads, entity graph, tasks, chat history)
- Incredibly mature and battle-tested

**Known tradeoffs:**
- Single-writer limitation — background processes must coordinate writes (WAL mode helps but doesn't eliminate contention)
- No built-in full-text search that rivals dedicated solutions (but FTS5 extension is good enough for keyword search alongside vector semantic search)

**Alternatives considered:**
- **PostgreSQL:** More powerful but requires a server process — violates the "zero-config" principle.
- **DuckDB:** Excellent for analytics but less suited for transactional CRUD workloads.

**Swap condition:** Swap to PostgreSQL only if the application needs multi-user access (e.g., a collaborative feature) or if write contention becomes a measurable bottleneck.

---

### LanceDB

**What it is:** Embedded vector database built on Apache Arrow, designed for local-first applications.

**Why chosen:**
- Truly embedded — import as a Python library, no server process
- Apache Arrow-native for fast columnar operations
- Designed for local-first use cases
- Supports metadata filtering alongside vector search
- Single-file storage per table

**Known tradeoffs:**
- Smaller community than ChromaDB or Pinecone
- Python-primary — Rust bindings exist but are less mature
- Mindshare declining slightly (6.9% from 9.3% YoY) but technical merits remain strong

**Alternatives considered:**
- **ChromaDB:** Simpler API, larger community. Slightly more overhead (runs as a separate service or embedded with more dependencies).
- **Milvus Lite:** Preview of enterprise Milvus, not optimized for embedded local use.
- **Qdrant (local mode):** Good option but heavier than LanceDB.

**Swap condition:** Swap to ChromaDB if LanceDB's Python SDK has stability issues, or if ChromaDB's ecosystem produces a killer feature (e.g., built-in re-ranking).

---

### litellm

**What it is:** Python SDK that provides a unified API for 100+ LLM providers.

**Why chosen:**
- Single interface for Ollama (local), Claude, OpenAI, Gemini, and more
- Built-in fallback routing, cost tracking, and rate limit handling
- Streaming support for real-time chat display
- Active development, comprehensive documentation
- Proxy server mode available if needed for multi-service access

**Known tradeoffs:**
- Adds a dependency layer between your code and the LLM providers
- Provider-specific features may not be fully exposed through the unified API
- Version updates can lag behind provider API changes

**Alternatives considered:**
- **Direct API calls:** Maximum control, no abstraction overhead. But requires maintaining separate client code for each provider.
- **LangChain:** Feature-rich but heavy, opinionated, and often criticized for unnecessary abstraction.

**Swap condition:** Swap to direct API calls if litellm's abstraction obscures a provider-specific feature you need (e.g., Claude's extended thinking mode), or if you settle on a single provider and the abstraction adds no value.

---

### tree-sitter

**What it is:** Incremental parsing library for building ASTs, supporting 30+ programming languages.

**Why chosen:**
- Language-agnostic — same API for Python, JavaScript, Rust, Go, etc.
- Incremental parsing — only re-parses changed regions (fast for real-time editor feedback)
- Powers VS Code's syntax highlighting and Sourcegraph's code intelligence
- Python bindings (py-tree-sitter v0.25+) are mature
- Pre-compiled grammar wheels available via `tree-sitter-languages` package

**Known tradeoffs:**
- Grammar quality varies by language (Python/JS excellent, niche languages may need custom grammars)
- Learning curve for writing custom queries (tree-sitter query language)
- Python bindings have some FFI overhead (acceptable for background processing, not ideal for real-time)

**Alternatives considered:**
- **Language-specific AST parsers (e.g., Python's `ast` module):** Zero dependencies for Python, but doesn't scale to multi-language support.
- **Regex-based parsing:** Fragile, language-specific, doesn't understand syntax.

**Swap condition:** No foreseeable swap. tree-sitter is the standard for this use case.

---

### Sentence-Transformers (Local Embeddings)

**What it is:** Python library for generating text embeddings using transformer models, running entirely locally.

**Why chosen:**
- Runs offline — no API calls needed
- `all-MiniLM-L6-v2` is small (80 MB) and fast while producing good-quality 384-dim embeddings
- Can be swapped to code-specific models (`codebert-base`) for better code chunk embeddings
- GPU acceleration available (CUDA/MPS) but CPU-only is acceptable for background indexing

**Known tradeoffs:**
- Quality ceiling compared to API embeddings (OpenAI, Voyage, Cohere)
- CPU embedding is slower (~50-100ms per chunk) — acceptable for async background processing
- Model loading time on first use (~2-3 seconds)

**Alternatives considered:**
- **OpenAI Embeddings API:** Higher quality, but requires cloud access (violates local-first for sensitive workspaces).
- **Voyage AI:** Best-in-class for code embeddings, but API-only.
- **ONNX Runtime:** Could speed up local inference, but adds deployment complexity.

**Swap condition:** Keep as the local default. Add API embedding as an opt-in quality upgrade for non-sensitive workspace profiles.

---

## Dependency Management

### Rust (Tauri)
- Managed via `cargo` and `Cargo.toml`
- Pin major versions, allow minor updates
- Audit dependencies periodically with `cargo audit`

### Python (Sidecar)
- Managed via `uv` (fast, resolves dependencies well)
- Pin all versions in `requirements.lock` or `pyproject.toml`
- Virtual environment isolated from system Python

### JavaScript (Frontend)
- Managed via `pnpm` (strict, efficient node_modules)
- Pin all versions in `pnpm-lock.yaml`

---

## Open Questions for Future Iterations

- Should we evaluate Tauri v3 when it releases? What would the migration path look like?
- Is there a Rust-native embedding solution (e.g., `candle` + ONNX) that could eliminate the Python sidecar for simple workloads?
- Should we benchmark CodeMirror vs. Monaco for specific use cases (large file performance, LSP response time)?
- What's the minimum viable local LLM for session state summarization? Can a 3B parameter model handle it, or do we need 7B+?
- Should the frontend use a state management library (e.g., SolidJS stores) or is plain signals/context sufficient?
