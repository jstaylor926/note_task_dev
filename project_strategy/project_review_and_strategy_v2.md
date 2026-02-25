# Project Review & Strategy V2: AI-Augmented Workspace — Full Scope Build

## Philosophy

This document treats the project as a serious, long-horizon solo engineering effort. There are no scope cuts. Every module from the original spec is included — the IDE, the terminal, the note-taking system, the task manager, and the AI/agent orchestration layer. The strategy isn't about reducing ambition; it's about sequencing the build so that each phase produces a working, usable tool that compounds into the full vision over time.

Three architectural pillars anchor everything:

1. **Session State & Handoff** — the compressed context payload that lets you resume any work session with full LLM awareness of where you left off. This is the killer feature and the first thing that needs to work.
2. **Local-First Architecture** — all data, embeddings, and model inference can operate entirely offline. Cloud APIs are opt-in upgrades, never dependencies. Non-negotiable given aerospace/ITAR constraints.
3. **Automatic Semantic Linking** — the knowledge graph builds itself. Notes link to code, code links to tasks, tasks link to git branches — all without manual curation. If it requires you to manually tag or link things, it's failed.

---

## System Architecture

### High-Level Component Map

```
┌──────────────────────────────────────────────────────────────────┐
│                     Application Shell (Tauri)                     │
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
│  │  SQLite                          LanceDB                     │  │
│  │  ─────────                       ────────                    │  │
│  │  Session state                   Code embeddings             │  │
│  │  Workspace profiles              Note embeddings             │  │
│  │  Task metadata                   Terminal log embeddings     │  │
│  │  Entity relationships            File chunk vectors          │  │
│  │  Chat history                                                │  │
│  │  Git event log                                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Why This Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Application Shell | **Tauri v2** | 2-3 MB binaries, 30-40 MB idle memory, native Rust backend. Electron would bloat this to 100+ MB before you write a line of application code. Tauri's IPC between the frontend and Rust is type-safe and fast. |
| Frontend Framework | **SolidJS** | No virtual DOM overhead, compiles to direct DOM updates, tiny bundle. The JSX syntax is familiar from React but the reactivity model is better suited for a high-update UI (terminal output, live file trees, streaming LLM responses). If you're more comfortable with React, that works too — the difference matters less than shipping. |
| Code Editor | **CodeMirror 6** | Modular (300 KB core vs Monaco's 5-10 MB), excellent extension API, powers Chrome DevTools and Replit. You don't need full Monaco — you need a fast, extensible editor that you can deeply integrate with the context engine. CodeMirror's extension system lets you build custom features (inline AI suggestions, semantic annotations) without fighting the framework. |
| Terminal | **xterm.js + tauri-plugin-pty** | Proven combination. xterm.js handles rendering, the PTY plugin handles shell process management. Projects like Terminon have validated this exact stack in Tauri. |
| Backend Logic | **Rust (Tauri core) + Python sidecar** | Rust handles performance-critical paths: file watching, IPC, PTY management, SQLite access. Python sidecar handles ML/AI work: embeddings, LLM calls via litellm, tree-sitter AST parsing, entity extraction. Communication via local HTTP (FastAPI) or Tauri's sidecar command system. |
| Relational Storage | **SQLite** | Zero-config, single-file, portable across machines. Handles the deterministic state: session payloads, task metadata, entity relationships, chat threads. |
| Vector Storage | **LanceDB** | Embedded (import as library, no server), Apache Arrow-native for fast columnar operations, designed for local-first use. Handles all semantic embeddings. |
| LLM Routing | **litellm** | Unified API across 100+ providers. Route to Ollama for local/private work, Claude or Gemini for complex reasoning, with automatic fallbacks and cost tracking. |
| Code Intelligence | **tree-sitter** | Language-agnostic AST parsing, incremental re-parsing for real-time feedback, 30+ language grammars available. Powers the smart chunking pipeline and refactoring features. |
| Embeddings | **sentence-transformers (local)** | Run entirely offline via `all-MiniLM-L6-v2` or similar for general text. Use code-specific models like `codebert-base` for source files. Optional API embeddings (OpenAI, Voyage) for higher quality when online. |

### Process Architecture

The application runs as three cooperating processes:

1. **Tauri Main Process (Rust)** — owns the window, IPC, file system access, PTY management, SQLite reads/writes, and coordinates everything.
2. **Python Sidecar** — a FastAPI service running on a local port (e.g., `127.0.0.1:9400`). Handles LLM calls, embedding generation, tree-sitter parsing, entity extraction, and any ML workloads. Launched and managed by the Tauri process.
3. **Frontend (SolidJS)** — renders the UI, communicates with Rust via Tauri's `invoke()` IPC. Never talks to Python directly; all requests route through Rust for centralized state management.

```
Frontend (SolidJS) ──invoke()──► Tauri (Rust) ──HTTP──► Python Sidecar (FastAPI)
                                     │
                                     ├── SQLite (direct)
                                     ├── LanceDB (via Python sidecar)
                                     └── File System (direct)
```

---

## Module Specifications

### Module 1: Continuous Context Engine

This is the nervous system. Everything else depends on it.

**1A. Local File Ingestion Pipeline**

The file watcher monitors designated project directories and maintains a live semantic index of your codebase.

Pipeline stages:

```
File Change Detected (watchdog/notify)
    │
    ▼
Hash Check ── file unchanged? ──► skip (differential updates)
    │
    ▼ changed
Language Detection (file extension + tree-sitter grammar lookup)
    │
    ▼
AST Parse (tree-sitter)
    │
    ▼
Smart Chunking
    ├── Code files: chunk by function/class/method boundaries (AST nodes)
    ├── Markdown: chunk by heading hierarchy
    ├── Config/YAML/JSON: chunk by top-level keys
    └── Other text: sliding window with overlap
    │
    ▼
Embedding Generation (sentence-transformers or code-specific model)
    │
    ▼
Upsert to LanceDB (with metadata: file_path, chunk_type, language, last_modified, git_branch)
    │
    ▼
Entity Extraction (background)
    ├── Function signatures, class names, imports
    ├── TODOs, FIXMEs, BUGs in comments
    └── References to other files or external URLs
    │
    ▼
Update SQLite entity graph (link extracted entities to their source chunks)
```

Key design decisions:
- **Differential updates via content hashing.** Store SHA-256 of each file. On change event, compare hashes. Only re-parse and re-embed chunks that actually changed. This keeps compute overhead minimal even on large codebases.
- **AST-aware chunking is non-negotiable.** Naive token-window chunking splits functions in half and produces garbage embeddings. tree-sitter gives you exact function/class boundaries. A chunk should be a semantically complete unit: one function, one class, one markdown section.
- **Metadata-rich vectors.** Every embedding in LanceDB carries metadata (source file, language, git branch, timestamp, chunk type). This enables filtered searches like "find Python functions modified this week on the `feature/auth` branch."

**1B. Session State & Handoff**

This is the killer feature. It gives the LLM full awareness of what you were doing, what was blocking you, and what comes next — without you explaining anything on session resume.

Session state payload schema:

```json
{
  "session_id": "uuid",
  "workspace_profile": "thesis-research",
  "timestamp": "2026-02-24T14:30:00Z",
  "duration_minutes": 47,

  "focus": {
    "last_active_file": "src/models/transformer.py",
    "last_cursor_position": { "line": 142, "col": 8 },
    "open_files": ["transformer.py", "train.py", "config.yaml"],
    "active_terminal_cwd": "/home/jt/thesis/experiments",
    "active_git_branch": "feature/multi-head-attention"
  },

  "context": {
    "recent_file_edits": [
      { "file": "transformer.py", "summary": "Added positional encoding layer", "lines_changed": 34 }
    ],
    "recent_terminal_commands": [
      { "command": "python train.py --epochs 50 --lr 0.001", "exit_code": 1, "stderr_summary": "CUDA OOM at batch 128" },
      { "command": "nvidia-smi", "exit_code": 0 }
    ],
    "recent_notes": [
      { "id": "note-uuid", "title": "Attention scaling investigation", "snippet": "Need to test sqrt(d_k) vs learned scaling..." }
    ],
    "active_chat_summary": "Discussed batch size reduction strategies for OOM error. Suggested gradient accumulation as alternative."
  },

  "state": {
    "blockers": [
      "CUDA OOM when training with batch_size=128. Need to either reduce batch size or implement gradient accumulation."
    ],
    "next_steps": [
      "Implement gradient accumulation in train.py",
      "Re-run experiment with effective batch_size=128 via 4x32 accumulation",
      "Compare loss curves with direct batch_size=128 baseline"
    ],
    "git_status": {
      "branch": "feature/multi-head-attention",
      "uncommitted_changes": 3,
      "ahead_of_main": 7
    }
  }
}
```

Lifecycle:

1. **Capture (on session pause/exit):** A state summarization agent ingests the current working tree status (`git diff --stat`), the last N terminal commands with outputs, the active file set from the editor, and the recent chat log. It compresses this into the payload above. For the `blockers` and `next_steps` fields, it uses a local LLM (or Claude API) to synthesize from raw signals — the OOM error + the subsequent nvidia-smi command + the chat about batch sizes = "CUDA OOM blocker, gradient accumulation next step."
2. **Store:** The payload is written to SQLite, keyed by workspace profile and timestamp. Historical payloads are retained (you can query "what was I working on last Thursday").
3. **Hydrate (on session resume):** The most recent payload for the selected workspace profile is retrieved. Relevant code chunks are pulled from LanceDB based on `active_files` and `recent_file_edits`. This combined context is injected into the LLM system prompt as structured data.
4. **LLM greeting on resume:** The assistant opens with a context-aware summary: *"Welcome back. You were working on multi-head attention in transformer.py. You hit a CUDA OOM at batch 128. Your plan was to implement gradient accumulation in train.py. Want me to help with that, or has something changed?"*

**1C. Workspace Profiles**

Multiple contexts for multiple lives:

- **"Thesis Research"** — indexes your thesis repo, ML experiment logs, ArXiv notes
- **"Work — Digital Solutions"** — indexes your work projects (local only, never cloud)
- **"Masters Coursework"** — indexes course materials, assignments, study notes
- **"Side Projects"** — personal repos, learning experiments

Each profile has its own:
- Set of watched directories
- LanceDB collection (isolated embedding spaces)
- Session state history
- Task board
- LLM system prompt customizations (e.g., work profile might say "always suggest Foundry-compatible patterns")

Profile switching triggers a session state capture on the outgoing profile and a hydration on the incoming one. The transition should feel like switching desks in a well-organized office.

---

### Module 2: Semantic Knowledge Graph & Task Management

**2A. The Ontology Layer**

Borrowing from Foundry's ontology approach: everything in the system is an **entity** with a type, properties, and relationships to other entities. The entity types:

| Entity Type | Examples | Auto-Extracted From |
|-------------|----------|---------------------|
| `CodeUnit` | function, class, module | tree-sitter AST parsing |
| `Note` | markdown document, voice transcript | User-created notes |
| `Task` | action item, deadline, milestone | Entity extraction from notes, commits, chat |
| `GitEvent` | commit, branch, merge, tag | Git hook integration |
| `Experiment` | ML training run, hyperparameter set | Log file parsing, MLflow/W&B hooks |
| `Reference` | ArXiv paper, URL, book citation | Entity extraction from notes and chat |
| `ChatThread` | conversation with AI assistant | Chat history |
| `TerminalSession` | command sequence with outputs | Terminal capture |

Relationships are **bidirectional** and **auto-generated**:

```
Note("attention scaling") ──mentions──► CodeUnit("MultiHeadAttention.forward()")
                          ◄──referenced_in──

Task("implement grad accum") ──blocked_by──► GitEvent("OOM error commit abc123")
                              ──targets──► CodeUnit("train.py:training_loop()")

Experiment("run-042") ──uses_config──► CodeUnit("config.yaml")
                      ──triggered_by──► TerminalSession("python train.py --run 042")
```

**How auto-linking works:**

The entity extraction pipeline runs as a background process on every new piece of content:

1. **Text enters the system** (note saved, commit made, terminal command executed, chat message sent).
2. **Named entity recognition** identifies references to code symbols (function names, file paths, class names), people, dates, URLs, and domain-specific terms.
3. **Fuzzy matching** against existing entities in the SQLite graph. "the attention function" matches `MultiHeadAttention.forward()` via embedding similarity.
4. **Link creation** with a confidence score. High-confidence links (exact file path match) are auto-committed. Low-confidence links (fuzzy semantic match) are surfaced as suggestions in the UI.
5. **Temporal linking** automatically connects entities that co-occur within the same session window (e.g., a note written while `transformer.py` was the active editor tab gets linked to that file).

**2B. Universal Semantic Search**

A single search bar that queries everything:

```
┌──────────────────────────────────────────────────────────┐
│ 🔍 "that function where we normalize the attention weights" │
└──────────────────────────────────────────────────────────┘
    │
    ▼
┌─ Results ────────────────────────────────────────────────┐
│                                                          │
│  📄 transformer.py:scaled_dot_product_attention()        │
│     line 89: weights = F.softmax(scores / sqrt_dk, -1)   │
│     Relevance: 0.94 │ Modified: 2h ago │ Branch: feature/ │
│                                                          │
│  📝 Note: "Attention scaling investigation"              │
│     "Need to test sqrt(d_k) vs learned scaling..."       │
│     Relevance: 0.87 │ Created: yesterday                 │
│                                                          │
│  💬 Chat thread from Feb 22                              │
│     "The standard approach is dividing by sqrt(d_model)…"│
│     Relevance: 0.81                                      │
│                                                          │
│  🖥️ Terminal output from run-041                         │
│     "NaN loss detected at step 450 — attention weights…" │
│     Relevance: 0.73                                      │
└──────────────────────────────────────────────────────────┘
```

Implementation: the query is embedded, then searched against all LanceDB collections (code, notes, terminal, chat) in parallel. Results are ranked by cosine similarity, boosted by recency and relevance to the active workspace profile.

**2C. Task Management**

Tasks aren't a separate app — they're entities in the knowledge graph that happen to have deadlines and status fields.

Auto-triage pipeline:

```
Raw Input (note text, commit message, chat message, terminal error)
    │
    ▼
Entity Extraction
    ├── "need to" / "should" / "TODO" / "FIXME" → candidate task
    ├── Date/time references → deadline extraction
    ├── Priority signals ("critical", "blocker", "nice to have") → priority tag
    └── Project/context signals → workspace profile assignment
    │
    ▼
Task Creation (pending user confirmation for low-confidence extractions)
    │
    ▼
Auto-Link to source entity (the note, commit, or chat that spawned it)
```

The task board view is a kanban or list within the workspace, but each task card shows its full lineage: which note created it, which code files it relates to, which git branch it lives on.

---

### Module 3: Agentic IDE

This isn't VS Code. It's not trying to be. It's a code editor that is **natively integrated with the context engine** in ways that a VS Code extension never could be.

**3A. Editor Core (CodeMirror 6)**

Base capabilities:
- Syntax highlighting (via tree-sitter grammars mapped to CodeMirror themes)
- Split panes (horizontal and vertical)
- File tree with fuzzy finder
- Git gutter (inline diff markers)
- Minimap
- Find and replace (with regex)
- Multi-cursor editing

Extensions that are unique to this project:
- **Semantic annotations.** Inline decorations showing knowledge graph connections — hover a function to see linked notes, related tasks, and recent chat discussions about it.
- **Context-aware autocomplete.** Instead of just LSP completions, the autocomplete also draws from the LanceDB index. If you're writing a function similar to one elsewhere in your codebase, it surfaces that as a reference.
- **Inline AI suggestions.** Ghost text completions powered by the LLM router, with full session context injected. The model knows what you were working on, what's broken, and what you planned to do.
- **Refactoring agent panel.** Select a code block, open the refactoring panel, describe what you want in natural language. The agent receives the selected code + AST-parsed surrounding context + relevant notes and tasks. Example: "migrate this Pandas pipeline to PySpark" — the agent sees the full data flow, not just the highlighted block.

**3B. LSP Integration Strategy**

Rather than implementing LSP from scratch, leverage existing language servers:

- **Python:** pylsp or pyright (via subprocess)
- **TypeScript/JavaScript:** typescript-language-server
- **Rust:** rust-analyzer
- **Go:** gopls

CodeMirror 6 has LSP client packages. The Tauri backend can manage language server processes and proxy LSP messages between the editor and the servers. This gives you go-to-definition, hover docs, diagnostics, and rename refactoring for free.

Start with Python LSP support (your primary language), add others incrementally.

---

### Module 4: Functional Terminal

**4A. Terminal Emulator (xterm.js + PTY)**

The terminal is a first-class citizen, not a panel you hide at the bottom. It's fully integrated with the context engine.

Base capabilities:
- Full PTY emulation via xterm.js + tauri-plugin-pty
- Split panes (tile terminals horizontally/vertically)
- Scrollback buffer with search
- Clickable URLs and file paths
- Shell integration (bash, zsh, fish, PowerShell)
- Configurable themes and fonts

**4B. Terminal Intelligence Layer**

Everything that happens in the terminal feeds the context engine:

- **Command capture.** Every command and its exit code are logged to SQLite. stdout/stderr are captured (with a configurable buffer size) and optionally embedded into LanceDB for semantic search.
- **Natural language mode.** Toggle a mode where the input line accepts natural language. "show me the largest files in this directory sorted by size" → translated to the appropriate shell command via the LLM router. The translated command is shown for confirmation before execution.
- **Error detection & resolution agent.** When a command exits with a non-zero code and stderr contains a stack trace or error message, the terminal automatically:
  1. Bundles: the command, the error output, the current working directory, relevant environment variables, and the source file that was referenced (if any).
  2. Sends this bundle to the debugging agent.
  3. Displays an inline suggestion panel below the error with: root cause analysis, suggested fix, and a one-click "apply fix" button.
- **Pipeline monitoring hooks.** Long-running commands (training scripts, data pipelines, builds) are detected by heuristic (command still running after N seconds) or explicit annotation. The terminal can background these and alert you on completion or failure.

**4C. Terminal ↔ Editor Integration**

- Click a file path in terminal output to open it in the editor at the referenced line number.
- Terminal errors referencing a file automatically highlight the relevant code in the editor.
- "Run this file" button in the editor executes the file in the terminal with the appropriate interpreter.
- Terminal commands are part of the session state payload — the LLM knows what you ran and what happened.

---

### Module 5: Pluggable ML/AI/Agent Layer

**5A. Model Router**

The LLM router (powered by litellm) manages model selection with configurable routing rules:

```yaml
routing_rules:
  - name: "proprietary_code"
    condition: "workspace_profile == 'work' OR contains_file_content == true"
    model: "ollama/codellama:13b"
    reason: "Never send work code to cloud APIs"

  - name: "complex_reasoning"
    condition: "task_type == 'architecture' OR task_type == 'debugging'"
    model: "claude-sonnet-4-5-20250929"
    fallback: "ollama/llama3:70b"
    reason: "Use best available model for hard problems"

  - name: "quick_tasks"
    condition: "task_type == 'formatting' OR task_type == 'simple_question'"
    model: "ollama/llama3:8b"
    reason: "Fast local model for lightweight work"

  - name: "embeddings"
    condition: "task_type == 'embed'"
    model: "local/all-MiniLM-L6-v2"
    reason: "Always embed locally"
```

The router also handles:
- **Automatic fallback** when a model is unavailable or rate-limited.
- **Cost tracking** across API calls (litellm provides this natively).
- **Context window management** — if the session context + query exceeds the model's window, the router truncates oldest context or switches to a larger-context model.
- **Streaming responses** for real-time display in the chat and editor panels.

**5B. Background Agents**

Agents are long-running autonomous processes that operate without direct user interaction:

**Research Daemon:**
- Monitors ArXiv RSS feeds filtered by configurable keywords (e.g., "transformer attention", "federated learning", "MLOps").
- On new paper match: downloads the abstract, generates an embedding, stores it in LanceDB, and creates a `Reference` entity in the knowledge graph.
- Optionally generates a 3-paragraph summary note using the LLM router.
- Runs on a configurable interval (e.g., daily at 6 AM, or on-demand).

**Pipeline Monitor:**
- Watches for specific process names or log files (e.g., `tensorboard`, `mlflow`, training script PIDs).
- Parses log output for metrics (loss, accuracy, epoch count).
- On completion: creates an `Experiment` entity with metrics, links it to the triggering command and config files.
- On failure: triggers the error resolution agent and creates a `Task` with the failure context.

**Digest Agent:**
- Runs at session start or on schedule.
- Compiles: unresolved tasks nearing deadline, unread research paper summaries, git branches with stale uncommitted changes, experiments that completed overnight.
- Presents a "morning briefing" in the chat panel.

**5C. Webhook & API Extensibility**

The Python sidecar exposes a local REST API for external integrations:

```
POST /api/v1/ingest     — push text/file content into the vector store
POST /api/v1/trigger    — trigger an agentic workflow by name
GET  /api/v1/search     — semantic search across the knowledge graph
GET  /api/v1/session    — retrieve current or historical session state
POST /api/v1/task       — create a task programmatically
```

Use cases:
- **CI/CD hook** fires `POST /api/v1/ingest` with build failure logs → automatically creates a task and links to the relevant code.
- **Foundry webhook** pushes pipeline status → pipeline monitor agent updates the knowledge graph.
- **Calendar integration** (via script) pushes upcoming meetings → digest agent includes prep context.

---

## Data Schema

### SQLite Tables

```sql
-- Workspace profiles
CREATE TABLE workspace_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    watched_directories TEXT NOT NULL,  -- JSON array
    llm_routing_overrides TEXT,         -- JSON (optional per-profile routing rules)
    system_prompt_additions TEXT,       -- Custom LLM prompt context
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Session state payloads
CREATE TABLE session_states (
    id TEXT PRIMARY KEY,
    workspace_profile_id TEXT NOT NULL REFERENCES workspace_profiles(id),
    payload TEXT NOT NULL,              -- JSON (the full session state object)
    duration_minutes INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Knowledge graph entities
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,          -- CodeUnit, Note, Task, GitEvent, Experiment, Reference, ChatThread, TerminalSession
    title TEXT NOT NULL,
    content TEXT,                       -- Full text content (for notes, chat messages)
    metadata TEXT,                      -- JSON (type-specific fields)
    source_file TEXT,                   -- File path if applicable
    workspace_profile_id TEXT REFERENCES workspace_profiles(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Knowledge graph relationships
CREATE TABLE entity_links (
    id TEXT PRIMARY KEY,
    source_entity_id TEXT NOT NULL REFERENCES entities(id),
    target_entity_id TEXT NOT NULL REFERENCES entities(id),
    relationship_type TEXT NOT NULL,    -- mentions, references, blocked_by, targets, uses_config, etc.
    confidence REAL DEFAULT 1.0,        -- 0.0 to 1.0 (1.0 = exact match, <0.7 = suggestion)
    auto_generated BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tasks (extended entity with task-specific fields)
CREATE TABLE tasks (
    entity_id TEXT PRIMARY KEY REFERENCES entities(id),
    status TEXT DEFAULT 'todo',         -- todo, in_progress, done, blocked
    priority TEXT DEFAULT 'medium',     -- low, medium, high, critical
    due_date TIMESTAMP,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id),
    source_type TEXT,                   -- note, commit, chat, terminal, manual
    completed_at TIMESTAMP
);

-- Chat history
CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id),
    role TEXT NOT NULL,                 -- user, assistant, system
    content TEXT NOT NULL,
    model_used TEXT,                    -- which LLM handled this message
    token_count INTEGER,
    cost_usd REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Terminal command log
CREATE TABLE terminal_commands (
    id TEXT PRIMARY KEY,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id),
    command TEXT NOT NULL,
    cwd TEXT,
    exit_code INTEGER,
    stdout_preview TEXT,               -- First N characters
    stderr_preview TEXT,               -- First N characters
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- File index (for differential update tracking)
CREATE TABLE file_index (
    file_path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,         -- SHA-256
    language TEXT,
    chunk_count INTEGER,
    last_indexed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id)
);

-- Git events
CREATE TABLE git_events (
    id TEXT PRIMARY KEY,
    workspace_profile_id TEXT REFERENCES workspace_profiles(id),
    event_type TEXT NOT NULL,           -- commit, branch_create, branch_switch, merge, tag
    ref_name TEXT,                      -- branch or tag name
    commit_hash TEXT,
    message TEXT,
    files_changed TEXT,                 -- JSON array
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### LanceDB Collections

Each workspace profile gets its own LanceDB table (collection):

```python
# Schema per workspace profile
{
    "vector": Vector(384),            # embedding dimension (all-MiniLM-L6-v2)
    "text": str,                      # the original chunk text
    "source_type": str,               # code, note, terminal, chat
    "source_file": str,               # file path if applicable
    "entity_id": str,                 # FK to SQLite entities table
    "chunk_type": str,                # function, class, heading_section, command_output, etc.
    "language": str,                  # python, javascript, markdown, etc.
    "git_branch": str,                # branch at time of indexing
    "created_at": str,                # ISO timestamp
    "updated_at": str,                # ISO timestamp
}
```

---

## Build Phases

These phases are sequential — each one produces a usable tool. No time pressure. Work at whatever pace fits around your job and masters program.

### Phase 0: Skeleton

**Goal:** Tauri app opens, renders a window, Python sidecar starts and responds to health checks.

What you build:
- Tauri project scaffolded with SolidJS frontend
- Python sidecar with FastAPI, launched by Tauri on startup
- Health check round-trip: frontend → Rust → Python → Rust → frontend
- SQLite database created on first launch with the schema above
- LanceDB initialized with an empty collection
- Basic window layout: placeholder panels for editor, terminal, notes, chat

This phase is pure plumbing. It's not exciting, but it validates that the three-process architecture works and that IPC is reliable.

### Phase 1: Context Engine Core

**Goal:** File watching, AST parsing, embedding, and semantic search work end-to-end.

What you build:
- File watcher (Python watchdog) monitoring a configured directory
- tree-sitter parsing for Python files (your primary language — add others later)
- Smart chunking by AST boundaries (function, class, module-level)
- Embedding via local sentence-transformers model
- Differential updates via content hashing
- Semantic search endpoint: query → embed → LanceDB search → ranked results
- CLI or minimal UI for triggering search and viewing results

After this phase, you can point the tool at a project directory and ask "where's the function that handles authentication?" and get an answer.

### Phase 2: Session State & Handoff

**Goal:** The session handoff mechanism works. You can close the app, reopen it, and the LLM knows what you were doing.

What you build:
- Session state capture on app exit (git status, open files, recent terminal commands)
- State summarization via LLM (local Ollama or Claude API)
- Context payload storage in SQLite
- Session hydration on app start (payload retrieval + relevant chunks from LanceDB)
- Chat panel with LLM integration (litellm routing)
- Context-aware greeting on session resume
- Workspace profile creation and switching

After this phase, you have the killer feature working. The tool remembers your context across sessions.

### Phase 3: Terminal

**Goal:** Functional terminal emulator integrated with the context engine.

What you build:
- xterm.js terminal with PTY backend
- Split pane support (multiple terminals)
- Command logging to SQLite
- stdout/stderr capture and embedding into LanceDB
- Terminal output → semantic search integration
- Natural language command translation (toggle mode)
- Error detection (non-zero exit codes, stack traces)
- Basic error resolution agent (bundles error context, queries LLM for fix suggestions)

### Phase 4: Code Editor

**Goal:** CodeMirror editor integrated with the context engine and terminal.

What you build:
- CodeMirror 6 with file tree sidebar
- Syntax highlighting via tree-sitter grammar mapping
- File open/save integrated with the file watcher
- Git gutter decorations
- LSP integration for Python (pylsp or pyright)
- Run file in terminal button
- Click file path in terminal → opens in editor
- Inline AI suggestions (ghost text from LLM with session context)

### Phase 5: Knowledge Graph & Tasks

**Goal:** The semantic knowledge graph auto-populates and tasks auto-extract.

What you build:
- Entity extraction pipeline (NER on notes, commits, chat, terminal output)
- Auto-linking engine (fuzzy matching entities, temporal co-occurrence)
- Entity relationship viewer (graph visualization)
- Task auto-extraction from notes and chat
- Task board view (kanban or list)
- Universal search bar (searches all entity types and vectors simultaneously)
- Bidirectional link display (hover a function → see related notes and tasks)

### Phase 6: Background Agents & Polish

**Goal:** Autonomous intelligence layer and UI polish.

What you build:
- Research daemon (ArXiv monitoring)
- Pipeline monitor (training job watcher)
- Digest agent (morning briefing)
- Webhook/API endpoints for external tools
- Model routing rules UI (configure which model handles what)
- Settings/preferences panel
- Keyboard shortcut customization
- Theme support (dark/light, custom colors)
- Notification system (desktop notifications for agent alerts)

### Phase 7: Advanced Features

**Goal:** The features that make this feel like a mature product.

What you build:
- Context-aware refactoring agent (select code → describe transformation → agent applies it with full context)
- Voice note capture and transcription (whisper.cpp local)
- ML experiment tracking integration (MLflow/W&B hooks → knowledge graph)
- Foundry API integration (push/pull context from Foundry pipelines)
- Multi-device sync (optional — sync SQLite and LanceDB between machines via file sync or git)
- Plugin system (let yourself or others extend functionality)

---

## Design Principles

1. **Session state is sacred.** Never lose context. Every session exit produces a state payload. Every session start hydrates from the latest payload. This is the one thing that must never break.

2. **Automatic over manual.** If it requires the user to remember to do something, it will be forgotten on a busy day. File watching, entity extraction, auto-linking, session capture — all automatic.

3. **Local-first, cloud-optional.** The entire system runs offline with Ollama and local embedding models. Cloud APIs (Claude, OpenAI, Gemini) are opt-in performance upgrades that can be toggled per workspace profile.

4. **The knowledge graph is an emergent property.** You don't "build" the graph manually. It emerges from the continuous ingestion of your work artifacts. Every file save, terminal command, note, commit, and chat message is a signal. The graph is the accumulated intelligence of all those signals linked together.

5. **Each phase ships a usable tool.** Phase 1 gives you semantic code search. Phase 2 gives you session memory. Phase 3 gives you an intelligent terminal. No phase depends on future phases to be useful.

6. **Composable internals.** The context engine, knowledge graph, and agent router are independent services communicating via defined interfaces. You can swap LanceDB for ChromaDB, or Ollama for vLLM, without rewriting the editor or terminal.

---

## Risk Awareness (Not Risk Aversion)

These aren't reasons to cut scope. They're things to watch for:

- **xterm.js + Tauri WebKit on Linux** can have rendering quirks. Test early on your target platform.
- **tree-sitter grammar quality varies by language.** Python and JavaScript are excellent. Niche languages may need custom grammars.
- **Local embedding models have a quality ceiling.** `all-MiniLM-L6-v2` is good but not great for code. Consider `codebert-base` or `codellama` embeddings for code-specific collections, and keep the option to swap in better models as they release.
- **LLM context window management** will need attention. As session state payloads grow, you'll need smart truncation or summarization to stay within model limits.
- **SQLite concurrent write access** from multiple processes needs WAL mode enabled. Not a problem, just configure it at init.
- **Python sidecar startup time** can lag behind the Tauri window. Handle this gracefully in the UI (show a loading state for AI features until the sidecar health check passes).

---

## What This Looks Like When It's Done

You open the app. It greets you: *"Welcome back. You were working on your thesis — the multi-head attention implementation. You hit a CUDA OOM yesterday. Your plan was to try gradient accumulation. Also: two new ArXiv papers matched your research interests overnight, and your coursework assignment for CS 689 is due Thursday."*

The editor has `transformer.py` open where you left off. The terminal shows your last few commands. The task board has "implement gradient accumulation" at the top. The knowledge graph shows a web of connections: your thesis notes link to your code, your code links to your experiments, your experiments link to the papers you've read.

You type a question in the chat: "how did I implement the scaling factor in the attention function?" It searches your codebase semantically, finds the function, surfaces the related note you wrote about sqrt(d_k) vs learned scaling, and shows the experiment run where you tested both approaches.

Everything is local. Everything persists. Nothing requires you to remember where you put things. The system remembers for you.
