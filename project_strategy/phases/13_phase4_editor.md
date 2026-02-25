# Phase 4: Code Editor

> **Goal:** CodeMirror 6 code editor integrated with the context engine and terminal. Syntax highlighting, file tree, LSP for Python, and the beginning of AI-assisted editing.

**Prerequisite:** Phase 3 (terminal) complete.

---

## Definition of Done

- [ ] CodeMirror 6 editor renders in the editor panel with syntax highlighting
- [ ] File tree sidebar with directory navigation and fuzzy file finder (Cmd+P)
- [ ] Open, edit, and save files
- [ ] Multiple files in tabs, tabs across split panes
- [ ] Syntax highlighting via tree-sitter grammar mapping for Python
- [ ] Git gutter decorations (added/modified/deleted line indicators)
- [ ] LSP integration for Python (pyright or pylsp): autocomplete, hover, go-to-definition, diagnostics
- [ ] "Run file in terminal" button (Cmd+Enter)
- [ ] Click file path in terminal output opens file in editor at referenced line
- [ ] Terminal errors highlight relevant lines in editor
- [ ] File changes in editor trigger the context engine's file watcher
- [ ] Session state capture now includes editor state (open files, cursor position)
- [ ] Inline AI suggestions (ghost text) with session context
- [ ] Basic refactoring agent panel (select code → describe → get suggestion)

---

## Key Tasks

### 1. CodeMirror 6 Setup

- Install CodeMirror 6 core and essential extensions
- Configure: line numbers, bracket matching, auto-indent, code folding, search
- Set up theme system (dark/light) matching the application theme
- Handle large file detection (>50,000 lines → show warning, offer read-only mode)

### 2. File Tree

- Recursive directory tree component in SolidJS
- Sync with file watcher (auto-refresh on filesystem changes)
- Fuzzy finder modal (Cmd+P): search across all files in watched directories
- File status indicators: unsaved changes, git modified, git staged
- Context menu: rename, delete, copy path, reveal in terminal

### 3. Tab Management

- Tab bar with open files, closable tabs, unsaved indicator
- Split pane support: drag tabs between panes, split horizontal/vertical
- Tab persistence in session state (reopen tabs on session resume)
- "Close all", "Close others", "Close saved" actions

### 4. tree-sitter Syntax Highlighting

- Map tree-sitter AST node types to CodeMirror highlight classes
- Start with Python, add JavaScript/TypeScript and Rust grammars
- Extend to support code folding based on AST structure

### 5. LSP Client

- Implement LSP JSON-RPC message proxying through Rust backend
- Python language server: install and manage pyright subprocess
- Support: `textDocument/completion`, `textDocument/hover`, `textDocument/definition`, `textDocument/diagnostics`
- Error squiggles and diagnostic panel
- Go-to-definition navigation (Cmd+Click or F12)

### 6. Editor ↔ Terminal Integration

- "Run file" command: Cmd+Enter sends `python {filepath}` to active terminal
- File path detection in terminal output → clickable links → open in editor
- Error resolution agent links: "Apply Fix" opens editor with diff preview
- Terminal error line references → editor error decorations

### 7. Session State Integration

- Track open files, active file, cursor positions in the session state payload
- On session resume: reopen files from `focus.open_files`, restore cursor to `focus.last_cursor_position`
- Editor activity feeds into session state's `recent_file_edits`

### 8. AI Inline Suggestions

- On typing pause (500ms debounce): send cursor context to LLM
- Context includes: surrounding code, session state, relevant knowledge graph entities
- Display as ghost text (CodeMirror decoration with reduced opacity)
- Tab to accept, Escape/keep typing to dismiss
- Configurable: enable/disable, debounce timing, model selection

### 9. Refactoring Agent (Basic)

- Select code block → open refactoring panel (Cmd+Shift+R)
- Text input for natural language description of desired transformation
- Send to LLM with: selected code, full file context, session state, related entities
- Display proposed changes as a diff
- Apply/reject/edit buttons

---

## Testing Strategy

- **Unit test:** CodeMirror extensions load without errors
- **Unit test:** tree-sitter → CodeMirror highlight mapping is correct for Python syntax
- **Integration test:** Open file → edit → save → file watcher detects change → re-indexed
- **Integration test:** LSP diagnostics appear as squiggles in editor
- **Integration test:** Cmd+Enter runs active file in terminal
- **Integration test:** Click file path in terminal → opens in editor at correct line
- **Performance test:** Open a 10,000-line Python file without noticeable lag

---

## Open Questions

- Should we implement a minimap in this phase or defer to Phase 6?
- How should multi-file refactoring work? (Phase 4 basic: single file. Phase 7: multi-file.)
- Should the editor support opening image files (preview) or just text files?
- Should we add a diff view for comparing file versions in this phase?
