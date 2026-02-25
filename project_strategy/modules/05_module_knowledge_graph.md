# Module: Semantic Knowledge Graph & Task Management

> The knowledge graph is the memory layer. It stores every entity the system knows about — code units, notes, tasks, git events, experiments, references, chat threads, terminal sessions — and the relationships between them. The graph builds itself automatically through entity extraction and auto-linking. Future iterations should focus on improving auto-link accuracy, expanding entity types, and building richer query capabilities.

---

## Overview

This module has three sub-systems:

1. **Ontology Layer** — defines entity types, relationship types, and the rules for how entities connect.
2. **Auto-Linking Engine** — automatically discovers and creates relationships between entities without manual user intervention.
3. **Task Management** — treats tasks as knowledge graph entities with additional status/priority fields, auto-extracted from notes, chat, and commits.

A fourth capability, **Universal Semantic Search**, queries across the entire graph and all vector collections simultaneously.

---

## Sub-System 2A: The Ontology Layer

### Entity Types

Borrowing from Foundry's ontology model: everything in the system is an **entity** with a type, properties, and relationships.

| Entity Type | What It Represents | Created By | Lifecycle |
|-------------|-------------------|------------|-----------|
| `CodeUnit` | A function, class, method, or module | File ingestion pipeline (tree-sitter) | Auto-updated on file change; deleted when source code is removed |
| `Note` | A markdown document or voice transcript | User creates note in the notes panel | Persists until user deletes |
| `Task` | An action item with status and priority | Auto-extracted from notes/chat/commits, or manually created | Persists until completed or cancelled |
| `GitEvent` | A commit, branch, merge, or tag | Git hook integration or polling | Immutable once created |
| `Experiment` | An ML training run with metrics | Log file parsing, MLflow/W&B hooks, or terminal output parsing | Immutable once created (metrics may be appended) |
| `Reference` | An ArXiv paper, URL, book citation, or DOI | Auto-extracted from notes/chat, or research daemon | Persists indefinitely |
| `ChatThread` | A conversation thread with the AI assistant | Created when user starts a new chat thread | Persists until user deletes |
| `TerminalSession` | A sequence of terminal commands | Created when terminal session starts; finalized on session end | Immutable once finalized |

### Relationship Types

All relationships are stored in `entity_links` with bidirectional semantics (if A `mentions` B, then B is `mentioned_in` A).

| Relationship | Direction | Confidence Source | Example |
|-------------|-----------|-------------------|---------|
| `mentions` / `mentioned_in` | Note → CodeUnit | NER + fuzzy matching | Note discusses "the attention function" → links to `MultiHeadAttention.forward()` |
| `references` / `referenced_by` | Note → Reference | URL/DOI extraction | Note contains ArXiv link → links to Reference entity |
| `implements` / `implemented_by` | CodeUnit → Reference | Semantic similarity | `attention.py` embeddings similar to paper abstract |
| `blocked_by` / `blocks` | Task → any entity | Error detection + LLM synthesis | Task "fix OOM" blocked by GitEvent with OOM stack trace |
| `targets` / `targeted_by` | Task → CodeUnit | File path extraction from task context | Task mentions "train.py" → links to training loop function |
| `triggered_by` / `triggers` | Experiment → TerminalSession | Command matching | Experiment started by `python train.py --run 042` |
| `uses_config` / `config_for` | Experiment → CodeUnit | Config file reference in command args | `--config config.yaml` → links to config file entity |
| `spawned_from` / `spawns` | Task → Note/ChatThread | Entity extraction source tracking | Task extracted from note → links back to source note |
| `depends_on` / `depended_by` | CodeUnit → CodeUnit | Import analysis (tree-sitter) | `from model import Transformer` → dependency link |
| `co_occurred` / `co_occurred` | any → any | Temporal co-occurrence in session | Note written while `transformer.py` was active → temporal link |
| `related_to` / `related_to` | any → any | Embedding cosine similarity > threshold | Semantically similar entities discovered during search |
| `followed_by` / `preceded_by` | any → any | Temporal sequence | Commit A followed by Experiment B (within same session) |

---

## Sub-System 2B: Auto-Linking Engine

### Pipeline

Every new piece of content entering the system flows through the auto-linking pipeline:

```
New Content Arrives
    ├── Note saved
    ├── File indexed (new CodeUnit entities)
    ├── Terminal command executed
    ├── Git event detected
    ├── Chat message sent/received
    └── Experiment logged
    │
    ▼
Stage 1: Entity Extraction (NER)
    ├── Code symbol detection (function names, class names, file paths)
    │   Method: regex patterns + tree-sitter symbol table matching
    │   Confidence: HIGH (exact matches)
    │
    ├── Date/time extraction
    │   Method: regex + dateutil parsing
    │   Confidence: HIGH
    │
    ├── URL/DOI/ArXiv ID extraction
    │   Method: regex patterns
    │   Confidence: HIGH
    │
    ├── Person name detection
    │   Method: NER model (spaCy or local LLM)
    │   Confidence: MEDIUM
    │
    └── Domain-specific term detection
        Method: embedding similarity against entity title index
        Confidence: VARIABLE (depends on similarity score)
    │
    ▼
Stage 2: Entity Resolution (Fuzzy Matching)
    For each extracted reference:
    │
    ├── Exact match against entity titles/file paths
    │   Confidence: 1.0
    │   Action: auto-commit link
    │
    ├── Fuzzy string match (Levenshtein distance < threshold)
    │   Confidence: 0.8-0.95
    │   Action: auto-commit link
    │
    ├── Semantic match (embed reference text, search LanceDB for similar entities)
    │   Confidence: cosine similarity score (0.0-1.0)
    │   Action: auto-commit if > 0.85, suggest if 0.7-0.85, discard if < 0.7
    │
    └── No match found
        Action: create new entity if appropriate (e.g., new Reference from URL)
    │
    ▼
Stage 3: Temporal Linking
    Based on session context (what was active when this content was created):
    │
    ├── Active file at time of note creation → `co_occurred` link
    ├── Recent terminal commands near a note/commit → `co_occurred` link
    ├── Chat messages near a code change → `co_occurred` link
    └── Sequential events in same session → `followed_by` / `preceded_by` links
    │
    ▼
Stage 4: Link Storage
    Write to entity_links table with:
    - relationship_type
    - confidence score
    - auto_generated = TRUE
    - context (brief explanation: "mentioned in line 42 of note X")
```

### Confidence Scoring

| Score Range | Meaning | UI Treatment |
|-------------|---------|-------------|
| 0.95 - 1.0 | Exact or near-exact match | Auto-committed, shown as solid link |
| 0.85 - 0.95 | High-confidence semantic match | Auto-committed, shown as solid link |
| 0.70 - 0.85 | Plausible but uncertain | Shown as suggested link (dashed line, user can confirm/dismiss) |
| < 0.70 | Unlikely match | Discarded, not shown |

### User Corrections

When a user confirms a suggested link or dismisses one:
- The link's `auto_generated` field is set to `FALSE` (user-validated)
- The correction is logged for potential future use in improving the auto-linker
- Confirmed links boost future confidence for similar matches
- Dismissed links reduce future confidence for similar matches

---

## Sub-System 2C: Task Management

### Tasks as Graph Entities

Tasks are not a separate system — they are entities in the knowledge graph with additional structured fields (status, priority, due date). This means every task has:
- Full knowledge graph connectivity (linked to code, notes, experiments, etc.)
- Vector embeddings (searchable semantically)
- Automatic relationship discovery (new code changes can auto-link to relevant tasks)

### Auto-Extraction Pipeline

```
Raw Text Input
    ├── Note content
    ├── Commit message
    ├── Chat message
    ├── Terminal error output
    └── Code comment (TODO/FIXME/BUG)
    │
    ▼
Pattern Detection
    ├── Explicit markers: TODO, FIXME, BUG, HACK, XXX
    ├── Action language: "need to", "should", "must", "have to", "plan to"
    ├── Imperative sentences: "Implement X", "Fix Y", "Refactor Z"
    └── Error-derived: non-zero exit code + stack trace → "Fix [error description]"
    │
    ▼
Task Field Extraction
    ├── Title: extracted action phrase (e.g., "Implement gradient accumulation")
    ├── Priority: inferred from language ("critical" → high, "nice to have" → low, default → medium)
    ├── Due date: extracted from date references ("by Friday", "before the demo")
    ├── Workspace profile: inferred from active profile at extraction time
    └── Source type: note, commit, chat, terminal, code_comment
    │
    ▼
Confidence Assessment
    ├── Explicit markers (TODO/FIXME): confidence = 0.95+
    ├── Action language with clear verb: confidence = 0.80-0.95
    ├── Ambiguous phrasing: confidence = 0.60-0.80
    └── Error-derived: confidence = 0.70-0.85
    │
    ▼
Task Creation
    ├── High confidence (>0.85): auto-create task, mark as "todo"
    ├── Medium confidence (0.70-0.85): create as suggestion, user confirms
    └── Low confidence (<0.70): discard
    │
    ▼
Auto-Link to Source
    └── spawned_from → source entity (note, commit, chat thread)
```

### Task Board Features

The task board is a UI view over the task subset of the knowledge graph:

- **Views:** Kanban (columns: todo, in_progress, done, blocked) or flat list with sort/filter
- **Filters:** By workspace profile, priority, due date, source type, linked entity
- **Task cards display:** Title, priority badge, due date, source link, related entity count
- **Drill-down:** Click a task card to see its full knowledge graph neighborhood — which note created it, which code files it targets, which experiments relate to it
- **Bulk actions:** Mark multiple tasks done, re-prioritize, move to different profile
- **Archiving:** Completed tasks are archived (not deleted) and remain in the knowledge graph for historical context

---

## Universal Semantic Search

### Search Architecture

```
User Query: "that function where we normalize attention weights"
    │
    ▼
Query Embedding (sentence-transformers)
    │
    ▼
Parallel Search (across all sources for active workspace profile)
    ├── LanceDB: code chunks (source_type = 'code')
    ├── LanceDB: note chunks (source_type = 'note')
    ├── LanceDB: terminal output chunks (source_type = 'terminal')
    ├── LanceDB: chat message chunks (source_type = 'chat')
    └── SQLite: FTS5 keyword search on entity titles + content
    │
    ▼
Result Merging & Ranking
    ├── Base score: cosine similarity (vector) or BM25 (keyword)
    ├── Recency boost: +0.05 for items modified in last 24h, +0.02 for last week
    ├── Profile relevance: +0.03 for items in the active workspace profile
    ├── Entity connectivity: +0.02 for items with many knowledge graph links
    └── Source diversity: ensure results aren't all from one source type
    │
    ▼
Deduplification
    └── If multiple chunks from the same file match, group them under the file
    │
    ▼
Result Display
    ├── Code results: file path, function name, relevant code snippet, relevance score
    ├── Note results: note title, matching section, relevance score
    ├── Chat results: thread summary, matching message, relevance score
    ├── Terminal results: command, output snippet, relevance score
    └── Entity results: entity title, type, relationship count
```

### Search Modes

- **Semantic search** (default): vector similarity across all collections
- **Keyword search:** SQLite FTS5 for exact term matching
- **Hybrid search:** combine vector + keyword scores (recommended for best recall)
- **Graph traversal:** "show me everything linked to [entity]" — walks the knowledge graph from a starting entity
- **Temporal search:** "what was I working on last Thursday" — filter by timestamp range, then rank by relevance

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Entity extraction per note | < 2 seconds |
| Auto-linking per new entity | < 1 second |
| Task auto-extraction | < 500ms per candidate |
| Semantic search (hybrid) | < 500ms end-to-end |
| Graph traversal (2 hops) | < 200ms |
| Knowledge graph total entities | Support 100,000+ without degradation |

---

## Open Questions for Future Iterations

- Should the ontology support user-defined entity types (custom types beyond the 8 built-in ones)?
- How should entity merging work? (Two entities that turn out to represent the same thing)
- Should the auto-linker learn from user corrections over time (active learning)?
- Can we integrate with external knowledge bases (e.g., company wiki, Confluence) as entity sources?
- Should tasks support subtasks (hierarchical task decomposition)?
- How should the graph handle entity staleness? (A CodeUnit for a deleted function should be marked as stale, not deleted, to preserve historical links)
- Should we support natural language graph queries? ("What notes mention functions that were changed this week?")
- Can the temporal linking be made more sophisticated — e.g., detecting that a sequence of terminal commands forms a coherent workflow and grouping them?
