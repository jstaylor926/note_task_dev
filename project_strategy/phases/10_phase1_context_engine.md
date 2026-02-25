# Phase 1: Context Engine Core

> **Goal:** File watching, AST parsing, smart chunking, embedding, and semantic search work end-to-end. You can point the tool at a project directory and ask "where's the function that handles authentication?" and get a ranked answer.

**Prerequisite:** Phase 0 (skeleton) complete.

---

## Definition of Done

- [ ] File watcher monitors configured directories and detects changes
- [ ] tree-sitter parses Python files into AST and extracts function/class boundaries
- [ ] Smart chunking splits code by semantic boundaries (not arbitrary token windows)
- [ ] Embedding generates vectors for each chunk via local sentence-transformers model
- [ ] Differential updates: only re-processes files/chunks that actually changed (hash comparison)
- [ ] LanceDB stores embeddings with metadata (file path, language, chunk type, git branch)
- [ ] Semantic search endpoint works: query → embed → vector search → ranked results
- [ ] Search results are displayed in the frontend (basic results panel)
- [ ] SQLite file_index tracks indexed files with content hashes
- [ ] Entity extraction creates CodeUnit entities for functions and classes
- [ ] Performance: file change → embedding stored in < 5 seconds
- [ ] Performance: semantic search returns results in < 500ms

---

## Key Tasks

### 1. File Watcher (Python sidecar)

- Use `watchdog` library to monitor directories listed in the active workspace profile
- Implement debouncing (300ms) to avoid processing during rapid file saves
- Respect `.gitignore` and custom `.contextignore` patterns
- Emit events: `file_created`, `file_modified`, `file_deleted`
- On delete: remove corresponding embeddings from LanceDB and entities from SQLite

### 2. tree-sitter Integration (Python sidecar)

- Install `py-tree-sitter` and `tree-sitter-languages` (pre-compiled grammars)
- Implement Python grammar parsing first (primary language)
- Extract AST nodes: function definitions, class definitions, method definitions, module-level code
- For each node, capture: name, start line, end line, full text content, signature

### 3. Smart Chunking (Python sidecar)

- Code files: one chunk per function/class/method (from tree-sitter AST)
- Each chunk gets a context header: `"File: path/to/file.py | Class: ClassName | Method: method_name"`
- Markdown files: chunk by heading hierarchy
- Config files (YAML/JSON/TOML): chunk by top-level keys
- Fallback: sliding window (512 tokens, 128 overlap) for unsupported file types

### 4. Embedding Pipeline (Python sidecar)

- Load `all-MiniLM-L6-v2` model on sidecar startup
- Batch embedding: process up to 32 chunks at a time
- For each chunk: prepend context header, embed, store in LanceDB with metadata
- Track chunk-level hashes for granular differential updates

### 5. Semantic Search Endpoint (Python sidecar)

- `POST /api/v1/search` with query string and optional filters
- Embed the query using the same model
- Search LanceDB with cosine similarity
- Optional filters: `source_type`, `language`, `git_branch`
- Return top-K results with: text snippet, file path, line numbers, relevance score, metadata

### 6. Frontend Search UI

- Search bar in the UI (Cmd+K shortcut)
- Display results as a list: file path, function name, code snippet, relevance score
- Click a result to open the file (placeholder in this phase — editor comes in Phase 4)
- Show indexing status indicator (how many files indexed, whether indexing is in progress)

### 7. SQLite Entity Creation

- On file indexing, create/update CodeUnit entities for each function and class
- Store in `entities` table with metadata (language, kind, signature, line numbers)
- Update `file_index` table with content hash and chunk count

---

## API Endpoints Added

```
POST /api/v1/index/start    — start indexing for active workspace profile
POST /api/v1/index/stop     — stop the file watcher
GET  /api/v1/index/status   — indexing status (files indexed, in progress, errors)
POST /api/v1/search         — semantic search
GET  /api/v1/entities       — query entities by type, file, or profile
```

---

## Testing Strategy

- **Unit test:** tree-sitter parsing produces correct AST nodes for sample Python files
- **Unit test:** smart chunking produces expected chunks for a known code file
- **Integration test:** file save → watcher detects → indexing pipeline → embedding stored in LanceDB
- **Integration test:** search query returns relevant results from indexed codebase
- **Performance test:** index a 1,000-file Python project in < 5 minutes
- **Performance test:** search latency < 500ms on a 10,000-chunk collection

---

## Open Questions

- Should we support incremental re-parsing (tree-sitter supports this) or full re-parse on each file change?
- What should happen when a file is renamed? (Delete old embeddings, re-index under new path?)
- Should the search UI show a preview of the surrounding code context, or just the matching chunk?
