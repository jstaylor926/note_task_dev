# Phase 5: Knowledge Graph & Tasks

> **Goal:** The semantic knowledge graph auto-populates from all data sources, tasks auto-extract from notes and chat, and a universal search bar queries everything simultaneously. The intelligence layer that connects all your work artifacts becomes visible and navigable.

**Prerequisite:** Phase 4 (editor) complete.

---

## Definition of Done

- [x] Entity extraction pipeline runs on all new content (notes, commits, chat, terminal output) — *Phase 5a/5b: reference extraction from notes + code, TODO extraction from code comments, error extraction from terminal*
- [x] Auto-linking engine creates relationships between entities with confidence scores — *Phase 5b: `note_auto_link` with exact/fuzzy matching*
- [ ] Temporal co-occurrence linking works (entities active in same session are linked)
- [x] High-confidence links auto-committed; low-confidence links shown as suggestions — *Phase 5b: auto_generated flag + confidence scores*
- [ ] User can confirm or dismiss suggested links
- [ ] Entity relationship viewer (graph visualization or list view)
- [x] Task auto-extraction from notes, chat messages, commit messages, and TODO comments — *Phase 5c: notes, code comments, terminal errors*
- [x] Task board view (kanban or list) with filter by profile, priority, status — *Phase 5c: Kanban + list with filter/sort/group*
- [ ] Each task card shows its knowledge graph lineage (source note, related code, linked experiments)
- [ ] Universal search bar queries all entity types and vector collections simultaneously
- [ ] Hybrid search: vector similarity + keyword matching
- [ ] Bidirectional link display in editor: hover a function → see linked notes and tasks
- [x] Notes panel: create, edit, and view markdown notes (basic markdown editor) — *Phase 5a: NotesPanel with CodeMirror 6*
- [x] Notes are indexed, embedded, and linked into the knowledge graph — *Phase 5a/5b: auto-linking on save*

---

## Key Tasks

### 1. Notes Panel

- Markdown editor in the notes panel (CodeMirror with markdown mode, or a simpler markdown component)
- Create, edit, delete notes
- Notes stored as Note entities in SQLite with full content
- Notes embedded in LanceDB on save
- Auto-save with debounce

### 2. Entity Extraction Pipeline

- NER processing on all new text content entering the system
- Code symbol detection: regex + tree-sitter symbol table lookup
- Date/time extraction: regex + dateutil
- URL/DOI extraction: regex
- Action language detection: "need to", "should", "TODO", "FIXME"
- Run as background task with lower priority than UI operations

### 3. Auto-Linking Engine

- Exact match: entity titles, file paths → confidence 1.0
- Fuzzy match: Levenshtein distance → confidence 0.8-0.95
- Semantic match: embed reference text, search LanceDB → confidence = cosine similarity
- Temporal linking: entities created within same session window → `co_occurred` links
- Store all links in `entity_links` with confidence scores and auto_generated flag

### 4. Link Suggestion UI

- For links with confidence 0.70-0.85: show as "suggested" in the UI
- User can confirm (promotes to solid link) or dismiss (removes suggestion)
- Notification badge: "5 new suggested links" in status bar
- Suggested links panel: review all pending suggestions

### 5. Task Auto-Extraction

- Pattern detection on new text: TODO/FIXME markers, action language, imperative sentences
- Field extraction: title, priority, due date, source type
- High-confidence extractions auto-create tasks
- Medium-confidence extractions shown as suggestions
- Auto-link task to source entity (spawned_from relationship)

### 6. Task Board

- Kanban view: columns for todo, in_progress, done, blocked
- List view: sortable by priority, due date, creation date
- Filter by workspace profile, priority, status, source type
- Task card shows: title, priority badge, due date, source link, related entity count
- Click task → detail view with full knowledge graph neighborhood
- Drag to change status, click to edit

### 7. Universal Search

- Single search bar (Cmd+K) that queries everything
- Parallel queries: LanceDB vectors + SQLite FTS5 keyword search
- Result merging with recency boost and source diversity
- Result types: code, notes, tasks, chat, terminal, git events, experiments
- Each result shows: type icon, title, snippet, relevance score, metadata

### 8. Editor Knowledge Graph Integration

- Semantic annotations in editor: hover a function → tooltip shows linked entities
- Cross-reference panel: side panel showing all knowledge graph connections for current function
- Bidirectional: notes that reference code → code shows backlink to note

### 9. Graph Visualization

- Interactive graph view showing entities as nodes and relationships as edges
- Filter by entity type, relationship type, time range
- Click node → navigate to entity (open file, note, task, etc.)
- Zoom and pan, layout options (force-directed, hierarchical)
- Optional: use D3.js or a SolidJS graph library

---

## Testing Strategy

- **Unit test:** Entity extraction correctly identifies code symbols, dates, URLs, action items
- **Unit test:** Auto-linking produces correct confidence scores for known test cases
- **Integration test:** Save note mentioning a function → auto-link created → visible in editor hover
- **Integration test:** TODO in code comment → task auto-created → appears in task board
- **Integration test:** Universal search returns results from all source types
- **Performance test:** Entity extraction + auto-linking for 100 entities in < 10 seconds
- **Performance test:** Universal search across 100,000 entities in < 500ms

---

## Open Questions

- Should the graph visualization be a separate full-screen view or embeddable as a panel?
- How should entity merging work when two entities represent the same concept?
- Should the task board support drag-and-drop across workspace profiles?
- Can we implement "smart groups" — auto-generated task groupings based on knowledge graph clusters?
