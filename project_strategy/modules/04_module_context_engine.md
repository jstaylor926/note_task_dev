# Module: Continuous Context Engine

> The context engine is the nervous system of the application. It maintains a live semantic index of the user's work, captures session state for handoff, and manages workspace profiles. Every other module depends on it. Future iterations should focus on improving indexing quality, reducing capture latency, and expanding the session state payload to include new signal sources.

---

## Overview

The context engine has three sub-systems:

1. **File Ingestion Pipeline** — watches project directories, parses code via AST, chunks intelligently, embeds into LanceDB, and extracts entities for the knowledge graph.
2. **Session State & Handoff** — captures the semantic state of a work session on exit, stores it, and hydrates it on resume so the LLM has full awareness of what the user was doing.
3. **Workspace Profiles** — isolates contexts for different areas of life (work, thesis, coursework, side projects) with independent watched directories, embedding spaces, and LLM routing rules.

---

## Sub-System 1A: File Ingestion Pipeline

### Pipeline Flow

```
File Change Detected (watchdog/notify)
    │
    ▼
Debounce (300ms) ── prevents rapid-fire re-indexing during active editing
    │
    ▼
Hash Check ── file content SHA-256 unchanged? ──► skip
    │
    ▼ changed
Ignore Check ── matches .gitignore or custom ignore patterns? ──► skip
    │
    ▼
Language Detection (file extension → tree-sitter grammar lookup)
    │
    ▼ supported language
AST Parse (tree-sitter)
    │
    ▼
Smart Chunking
    ├── Code files: chunk by function/class/method boundaries (AST node extraction)
    ├── Markdown: chunk by heading hierarchy (H1 > H2 > H3 sections)
    ├── Config (YAML/JSON/TOML): chunk by top-level keys
    ├── Notebooks (.ipynb): chunk by cell
    └── Other text: sliding window (512 tokens, 128 token overlap)
    │
    ▼
Chunk Hashing ── individual chunk content hash
    │
    ├── Chunk unchanged? ──► skip embedding (reuse existing vector)
    ▼ changed
Embedding Generation (sentence-transformers or code-specific model)
    │
    ▼
Upsert to LanceDB
    metadata: file_path, chunk_type, chunk_index, language, git_branch, token_count, timestamps
    │
    ▼
Entity Extraction (async, lower priority)
    ├── Function/class/method signatures → CodeUnit entities
    ├── Import statements → dependency links
    ├── TODO/FIXME/BUG comments → candidate Task entities
    ├── File path references → cross-file links
    └── URL references → Reference entities
    │
    ▼
SQLite Updates
    ├── Update file_index (new hash, chunk count, timestamp)
    ├── Upsert entities table (new/updated CodeUnit entities)
    └── Upsert entity_links (new dependency/reference links)
```

### Smart Chunking Strategy

The goal: every chunk should be a semantically complete unit that makes sense in isolation.

**Python example (tree-sitter):**

```python
# Input file: transformer.py

# Chunk 1: module-level imports and constants
import torch
import torch.nn as nn
HIDDEN_DIM = 256

# Chunk 2: complete class
class MultiHeadAttention(nn.Module):
    def __init__(self, d_model, n_heads):
        super().__init__()
        self.n_heads = n_heads
        # ... full __init__

    def forward(self, q, k, v):
        # ... full forward method

# Chunk 3: standalone function
def scaled_dot_product_attention(q, k, v, mask=None):
    scores = torch.matmul(q, k.transpose(-2, -1))
    # ... full function
```

Each chunk includes:
- The complete code unit (function, class, or module-level block)
- A context header prepended before embedding: `"File: transformer.py | Class: MultiHeadAttention | Method: forward"`
- This header improves embedding quality by grounding the chunk in its structural context

**Markdown example:**

```markdown
# Chapter 2: Attention Mechanisms          ← Chunk boundary (H1)

## 2.1 Scaled Dot-Product Attention        ← Chunk boundary (H2)
Content of section 2.1...

## 2.2 Multi-Head Attention                ← Chunk boundary (H2)
Content of section 2.2...

### 2.2.1 Implementation Notes             ← Sub-chunk under 2.2 (H3)
Content of subsection 2.2.1...
```

### Differential Update Logic

```python
def should_reindex(file_path: str, profile_id: str) -> bool:
    """Determine if a file needs re-indexing."""
    current_hash = sha256(read_file(file_path))
    stored = db.query("SELECT content_hash FROM file_index WHERE file_path = ? AND workspace_profile_id = ?",
                      file_path, profile_id)
    if not stored:
        return True  # New file, never indexed
    return current_hash != stored.content_hash
```

For chunk-level differential updates (more granular):
1. Parse the file into chunks
2. Hash each chunk's content
3. Compare against stored chunk hashes (stored as metadata in LanceDB)
4. Only re-embed chunks whose hashes changed
5. Delete embeddings for chunks that no longer exist (function was removed)
6. Add embeddings for new chunks (function was added)

### Resource Management

- **CPU throttling:** Embedding generation runs at lower priority than UI operations. Use a bounded thread pool (default: 2 threads) to prevent background indexing from making the editor sluggish.
- **Batch processing:** Queue file changes and process them in batches (every 2 seconds or when 10 changes accumulate, whichever comes first).
- **Memory cap:** Limit the embedding model's batch size to control peak memory usage. Default: 32 chunks per batch.
- **Ignore patterns:** Respect `.gitignore`, plus a custom `.contextignore` file for excluding large generated files, binary assets, etc.

### Configuration

```yaml
# context_engine.yaml (per workspace profile)
file_watcher:
  debounce_ms: 300
  batch_interval_seconds: 2
  max_batch_size: 50
  ignore_patterns:
    - "node_modules/**"
    - "*.pyc"
    - "__pycache__/**"
    - ".git/**"
    - "*.min.js"
    - "dist/**"
    - "build/**"

chunking:
  max_chunk_tokens: 512
  overlap_tokens: 128          # For sliding window fallback
  include_context_header: true  # Prepend file/class context to chunks

embedding:
  model: "all-MiniLM-L6-v2"    # Local default
  code_model: "codebert-base"   # Used for code files specifically
  batch_size: 32
  max_threads: 2

indexing:
  full_reindex_on_startup: false  # Only reindex changed files
  chunk_level_diff: true          # Granular chunk-level differential updates
```

---

## Sub-System 1B: Session State & Handoff

### Capture Triggers

| Trigger | When | Priority |
|---------|------|----------|
| App exit | User closes the application | Highest — must complete before process exits |
| Profile switch | User switches workspace profile | High — capture outgoing, hydrate incoming |
| Periodic snapshot | Every N minutes (default: 5) | Medium — background, crash recovery |
| Manual save | User explicitly triggers "save session" | Medium — user-initiated |
| Inactivity timeout | No user activity for N minutes | Low — captures "stepped away" state |

### Capture Process

```
Capture Triggered
    │
    ▼
Gather Raw Signals (parallel)
    ├── Editor: active file, cursor position, open files, unsaved changes
    ├── Terminal: last N commands with exit codes and stderr previews
    ├── Git: current branch, uncommitted changes count, ahead/behind main
    ├── Notes: recently modified notes (last 30 minutes)
    ├── Tasks: tasks modified this session
    └── Chat: recent chat messages (last 10)
    │
    ▼
Synthesize via LLM (if available) or Rule-Based Fallback
    ├── Generate `blockers` list from error signals (non-zero exit codes, stderr content)
    ├── Generate `next_steps` from chat context, TODO comments, and task board
    ├── Generate `active_chat_summary` from recent conversation
    └── Generate file edit summaries from git diff
    │
    ▼
Compose Payload (JSON)
    │
    ▼
Write to SQLite (atomic, WAL mode)
    │
    ▼
Emit Event (notify frontend of successful capture)
```

### Hydration Process (Session Resume)

```
App Starts / Profile Switches
    │
    ▼
Load Latest Session State from SQLite
    │
    ▼
Fetch Relevant Chunks from LanceDB
    ├── Embed `active_files` as search queries → retrieve related code context
    ├── Retrieve chunks from `recent_file_edits` files
    └── Retrieve note chunks from `recent_notes`
    │
    ▼
Compose LLM System Prompt
    ├── Base system prompt (from workspace profile config)
    ├── Session state payload (structured JSON)
    └── Relevant code/note chunks (as context)
    │
    ▼
Restore UI State
    ├── Open files from `focus.open_files`
    ├── Set cursor to `focus.last_cursor_position`
    ├── Set terminal CWD to `focus.active_terminal_cwd`
    └── Display task board for workspace profile
    │
    ▼
LLM Greeting
    "Welcome back. You were working on [last_focus]. [blockers summary]. Your plan was [next_steps]. Want to continue, or has something changed?"
```

### Fallback for LLM-Unavailable State

If the LLM (local Ollama or cloud API) is unavailable during capture:
- `blockers`: populated by rule-based extraction (commands with non-zero exit codes)
- `next_steps`: populated from TODO comments in recently modified files and uncompleted tasks
- `active_chat_summary`: last 3 chat messages concatenated (truncated to 500 chars)
- `file_edit_summary`: raw git diff stat output

The rule-based fallback is less intelligent but ensures session state is never lost due to LLM unavailability.

---

## Sub-System 1C: Workspace Profiles

### Profile Isolation

Each workspace profile is a self-contained work environment:

| Resource | Isolation Level | Shared? |
|----------|----------------|---------|
| Watched directories | Fully isolated | No |
| LanceDB table | Fully isolated (separate table per profile) | No |
| Session state history | Fully isolated | No |
| Task board | Fully isolated | No |
| Chat history | Fully isolated | No |
| SQLite entities | Scoped by `workspace_profile_id` | No |
| LLM routing rules | Per-profile overrides + global defaults | Global defaults shared |
| App settings (theme, keybindings) | Global | Yes |
| Embedding model | Per-profile configurable | Default shared |

### Profile Switching Flow

```
User Selects New Profile
    │
    ▼
Capture Current Session State (outgoing profile)
    │
    ▼
Deactivate File Watchers (for outgoing profile directories)
    │
    ▼
Set is_active = FALSE on outgoing profile, TRUE on incoming
    │
    ▼
Activate File Watchers (for incoming profile directories)
    │
    ▼
Hydrate Session State (incoming profile)
    │
    ▼
Restore UI State + LLM Greeting
```

### Security Profiles

A workspace profile can be marked with security flags:

```yaml
# Example: work profile
security:
  block_cloud_apis: true        # All LLM/embedding calls must use local models
  block_clipboard_export: false  # Allow copy-paste (too restrictive if true)
  log_api_calls: true           # Audit log of any API calls made (if cloud APIs are ever enabled)
```

The `block_cloud_apis` flag overrides global LLM routing rules for this profile. Even if Claude API is configured globally, it will never be used when this profile is active.

---

## Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| File change → embedding stored | < 5 seconds | From file save to LanceDB upsert complete |
| Session state capture | < 3 seconds | From trigger to SQLite write complete |
| Session hydration (resume) | < 2 seconds | From profile load to LLM greeting displayed |
| Semantic search latency | < 500ms | From query to results rendered |
| Profile switch | < 5 seconds | From selection to new profile fully active |
| Background CPU usage (idle) | < 5% | During active coding with no file changes |
| Memory overhead (embedding model loaded) | < 500 MB | Model + batch buffer |

---

## Open Questions for Future Iterations

- Should the file watcher support remote filesystems (NFS, SSHFS)? This could be useful for watching files on a remote dev server.
- Should session state capture include browser tabs (if the user has a research browser open)? This would require a browser extension integration.
- Can we detect and chunk Jupyter notebooks (`.ipynb`) intelligently (by cell)?
- Should the context header for code chunks include the file's docstring/module docstring for additional context?
- How should we handle very large files (>10,000 lines)? Skip them, or chunk them with a larger overlap?
- Should the periodic snapshot interval be adaptive (more frequent during active work, less frequent during idle)?
- Can we pre-compute "likely next queries" during idle time to warm the LanceDB cache?
