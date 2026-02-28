# Feb 28, 2026 — Session Updates

## Work Completed This Session

### Phase 5c: Task Auto-Extraction & Enhanced TaskPanel

Implemented task auto-extraction from notes, code comments, and terminal errors. Surfaced `source_type` through the full stack (Rust → sidecar → frontend). Enhanced TaskPanel with Kanban board view, inline editing, sort/group controls, and source type badges. Total test count: 390 (Rust: 108, Frontend: 199, Python: 83).

---

### Step 1: Rust — `source_type` Through the Full Stack

Surfaced `source_type` field on `TaskRow` struct and all task SQL queries.

**Modified files:**
- `src-tauri/src/db.rs` — Added `source_type: Option<String>` to `TaskRow`, updated `create_task` signature to accept `source_type: Option<&str>` (defaults to `"manual"`), updated all SELECT queries to include `t.source_type`, added `find_task_by_title` function for dedup, added 6 new tests
- `src-tauri/src/entity_commands.rs` — Updated `task_create` command to accept optional `source_type` parameter

**Tests added:** 6 Rust tests (create_task with source_type, find_task_by_title match/miss, source_type in list_tasks, task CRUD with source_type)

---

### Step 2: Rust — Action Item Handling in `note_auto_link`

Implemented action item handling in `note_auto_link` that was previously skipped (`_ => continue`).

**Modified files:**
- `src-tauri/src/entity_commands.rs` — Added `action_item` handler in the reference processing loop: extracts task title from line content, deduplicates via `find_task_by_title`, creates task with `source_type="note"`, links task to note via `create_entity_link_with_confidence` with relationship `"contains_task"`

---

### Step 3: Sidecar — Code Comment TODO Extraction

Added endpoint and extraction logic for TODO/FIXME comments in source code.

**Modified files:**
- `sidecar/cortex_sidecar/reference_extraction.py` — Added `CodeTodo` dataclass, `CODE_COMMENT_TODO_RE` regex (handles `//`, `#`, `/*`, `--`, `%` comment styles), `extract_code_todos()` function
- `sidecar/cortex_sidecar/main.py` — Added `ExtractCodeTodosRequest` model and `POST /extract-code-todos` endpoint

**Tests added:** 7 Python tests (`TestCodeTodoExtraction`: Rust `//` comments, Python `#` comments, multiple todos, case insensitive, no false positives on "todoist", block comments, empty todo text skipped)

---

### Step 4: Sidecar — Terminal Error Extraction

Added endpoint and extraction logic for terminal errors (compile errors, test failures, runtime errors).

**New files:**
- `sidecar/cortex_sidecar/terminal_extraction.py` — `TerminalTask` dataclass with `text`, `error_type`, `source_text`, `confidence` fields. Regex patterns for compile errors (0.95), test failures (0.9), and runtime errors (0.85). Deduplication via `seen_texts` set.
- `sidecar/tests/test_terminal_extraction.py` — 13 tests across `TestCompileErrors`, `TestTestFailures`, `TestRuntimeErrors`, `TestMixedOutput`

**Modified files:**
- `sidecar/cortex_sidecar/main.py` — Added `ExtractTerminalTasksRequest` model and `POST /extract-terminal-tasks` endpoint

---

### Step 5: Rust — Wiring Extraction Into Watcher + Terminal Pipelines

Connected code TODO extraction to the file watcher and terminal error extraction to a new Tauri command.

**Modified files:**
- `src-tauri/src/ingest.rs` — Added `CodeTodo` and `TerminalTask` structs, `extract_code_todos()` and `extract_terminal_tasks()` async HTTP helper functions
- `src-tauri/src/watcher.rs` — Added code TODO extraction after file entity upsert: calls sidecar, deduplicates by title, creates tasks with `source_type="code_comment"`
- `src-tauri/src/entity_commands.rs` — Added `extract_tasks_from_terminal` async Tauri command: calls sidecar, deduplicates by title, creates tasks with `source_type="terminal"`
- `src-tauri/src/main.rs` — Registered `extract_tasks_from_terminal` in invoke_handler

---

### Step 6: Frontend — Types, State, and IPC

Updated frontend types and state management to support new task features.

**Modified files:**
- `src/lib/tasks.ts` — Added `source_type: string | null` to `TaskRow` interface, updated `taskCreate` to accept optional `sourceType`, added `extractTasksFromTerminal()` IPC wrapper
- `src/lib/taskState.ts` — Full rewrite: added `viewMode`, `sortBy`, `groupBy`, `editingTaskId` to state; added `sortedTasks()`, `groupedTasks()`, `kanbanColumns()` computed memos; added `setViewMode`, `setSortBy`, `setGroupBy`, `setEditingTask`, `updateTaskInline` actions; exported `TaskViewMode`, `TaskSortBy`, `TaskGroupBy` types
- `src/lib/taskStoreInstance.ts` — Updated exports to include new types

**Tests added:**
- `src/lib/__tests__/taskState.test.ts` — 6 new tests (sortedTasks, groupedTasks, kanbanColumns, setViewMode/setSortBy/setGroupBy, source_type preserved, setEditingTask)
- `src/lib/__tests__/tasks.test.ts` — 1 new test (extractTasksFromTerminal IPC)

---

### Step 7: Enhanced TaskPanel

Rewrote TaskPanel with Kanban board view, inline editing, and comprehensive controls.

**Modified files:**
- `src/components/TaskPanel.tsx` — Full rewrite with sub-components:
  - `SourceBadge` — N/C/T badges for note/code_comment/terminal sources
  - `InlineEditForm` — Inline title/status/priority editing with Save/Cancel
  - `TaskCard` — Status dot, source badge, priority badge, delete button, click-to-edit
  - `KanbanColumn` — Column header (label + count) + task cards
  - `TaskPanel` — View mode toggle, filter pills, sort/group dropdowns, kanban view, grouped list view, inline creation
  - Data attributes: `view-mode-list`, `view-mode-kanban`, `kanban-column-{status}`, `task-card-{id}`, `task-edit-{id}`, `source-badge-{type}`, `sort-select`, `group-select`, `group-header-{key}`

**Tests added:** 7 new tests in `src/components/__tests__/TaskPanel.test.tsx` (kanban renders 3 columns, tasks in correct columns, view mode toggle, source badges, inline edit, sort select, group by status)

---

## Bugs Fixed

1. **Rust compilation — missing `source_type` argument:** Two `create_task` calls in db.rs test helpers (search entities, entity titles) weren't updated with the new parameter. Fixed by adding `None` as 6th argument.

2. **Python regex — empty TODO text matched across newlines:** `CODE_COMMENT_TODO_RE` used `[:\s]+` after the marker, but `\s` includes `\n`. `// TODO:\n// FIXME: real issue` matched as one TODO. Fixed by changing to `[: \t]+`.

3. **Frontend test state pollution:** Singleton `taskStore` persisted state between tests — switching to kanban in one test affected subsequent tests. Fixed by resetting store state (`setViewMode('list')`, etc.) in `beforeEach`.

---

## Test Summary

| Layer | Framework | Count | Delta |
|---|---|---|---|
| Rust | `cargo test` | 108 | +58 |
| Frontend | Vitest | 199 | +165 |
| Python | pytest | 83 | +38 |
| **Total** | | **390** | **+261** |

---

## Documentation Updated

- `docs/PROJECT_STATE.md` — Updated sections: Tauri commands (8→22), sidecar endpoints (+3), component tree (stubs→functional), state management (task + notes stores), data layer (tasks + entity_links implemented), IPC contract (full frontend→Rust listing), test counts (129→390), known bugs (B5 updated), What Is Complete (added Phase 4a, 5a, 5b, 5c), What Is Not Yet Built (updated Phase 4/5 remaining items)
- `project_strategy/phases/14_phase5_knowledge_graph.md` — Updated Definition of Done checklist (8/14 items checked)
