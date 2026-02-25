# Module: Agentic IDE

> The IDE is not a VS Code competitor. It's a code editor that is natively integrated with the context engine in ways that external extensions cannot achieve. The context engine feeds the editor with semantic awareness — every function knows its linked notes, every variable knows its lineage, every error knows its resolution history. Future iterations should focus on deepening context engine integration, expanding LSP support to more languages, and refining the AI-assisted editing experience.

---

## Overview

The IDE module has four sub-systems:

1. **Editor Core** — CodeMirror 6 with standard editing capabilities (syntax highlighting, split panes, file tree, search)
2. **Context-Aware Extensions** — custom CodeMirror extensions that surface knowledge graph data inline (semantic annotations, cross-references, AI suggestions)
3. **LSP Integration** — language server protocol support for go-to-definition, diagnostics, hover docs, and refactoring
4. **AI Editing Features** — inline completions, refactoring agent, and natural language code transformations

---

## Sub-System 3A: Editor Core (CodeMirror 6)

### Base Capabilities

These are standard code editor features built on CodeMirror 6's extension API:

| Feature | Implementation | Priority |
|---------|---------------|----------|
| Syntax highlighting | tree-sitter grammars mapped to CodeMirror highlight styles | Phase 4 (essential) |
| File tree sidebar | Custom SolidJS component with directory tree, fuzzy finder | Phase 4 (essential) |
| Split panes | Horizontal and vertical splits, tabs within panes | Phase 4 (essential) |
| Find and replace | CodeMirror's built-in search extension + regex support | Phase 4 (essential) |
| Multi-cursor editing | CodeMirror's built-in multi-cursor support | Phase 4 (essential) |
| Git gutter | Inline diff markers showing added/modified/deleted lines | Phase 4 |
| Minimap | Scrollbar overview of file structure | Phase 6 (polish) |
| Bracket matching | CodeMirror's `bracketMatching()` extension | Phase 4 (essential) |
| Auto-indent | CodeMirror's `indentOnInput()` extension | Phase 4 (essential) |
| Code folding | Based on tree-sitter AST structure (fold functions, classes, blocks) | Phase 4 |
| Line numbers | CodeMirror's `lineNumbers()` extension | Phase 4 (essential) |
| Drag-and-drop tabs | Rearrange open files across panes | Phase 6 (polish) |

### File Tree

```
┌── File Tree ──────────────┐
│ 🔍 Quick Open (Cmd+P)     │
│                            │
│ ▼ thesis/                  │
│   ▼ src/                   │
│     ▼ models/              │
│       📄 transformer.py  * │  ← * indicates unsaved changes
│       📄 attention.py      │
│     ▼ data/                │
│       📄 loader.py         │
│   📄 train.py            * │
│   📄 config.yaml           │
│   📄 README.md             │
│ ▼ experiments/             │
│   📄 run_042.log           │
└────────────────────────────┘
```

Features:
- Fuzzy file finder (Cmd+P / Ctrl+P): search files by name across watched directories
- File status indicators: modified (unsaved), git-staged, git-modified, indexing status
- Drag-and-drop to rearrange
- Right-click context menu: rename, delete, copy path, reveal in terminal, open in system file manager
- Auto-refresh on file system changes (synced with file watcher)

### Keyboard Shortcuts

Default shortcuts follow VS Code conventions where possible (reduce learning curve):

| Action | Shortcut |
|--------|----------|
| Quick open file | Cmd+P |
| Command palette | Cmd+Shift+P |
| Find in file | Cmd+F |
| Find in project | Cmd+Shift+F |
| Go to line | Ctrl+G |
| Toggle terminal | Ctrl+` |
| Split pane | Cmd+\ |
| Close tab | Cmd+W |
| Save | Cmd+S |
| Semantic search | Cmd+K (custom — opens universal search) |
| AI suggestion accept | Tab |
| AI refactor panel | Cmd+Shift+R |

All shortcuts are configurable via a keybindings config file.

---

## Sub-System 3B: Context-Aware Extensions

These are the features that make this editor unique — they exist because the context engine provides data that no external extension could access.

### Semantic Annotations

Inline decorations that show knowledge graph connections on hover:

```python
def scaled_dot_product_attention(q, k, v, mask=None):  # ← hover to see:
    #                                                      📝 2 notes reference this function
    #                                                      🧪 3 experiments use this function
    #                                                      ✅ 1 task targets this function
    scores = torch.matmul(q, k.transpose(-2, -1))
    scores = scores / math.sqrt(q.size(-1))
    if mask is not None:
        scores = scores.masked_fill(mask == 0, -1e9)
    weights = F.softmax(scores, dim=-1)                 # ← hover: linked to note "Attention scaling investigation"
    return torch.matmul(weights, v)
```

Implementation:
- On file open/change, query the knowledge graph for all entities linked to CodeUnits in this file
- Create CodeMirror decorations (line decorations or widget decorations) at the relevant line numbers
- Hover triggers a tooltip showing linked entities with click-through navigation

### Cross-Reference Panel

A side panel (togglable) showing all knowledge graph connections for the current function/class:

```
┌── References: scaled_dot_product_attention() ──┐
│                                                 │
│ 📝 Notes                                       │
│   • Attention scaling investigation (yesterday) │
│   • Thesis Chapter 3 draft (3 days ago)         │
│                                                 │
│ 🧪 Experiments                                  │
│   • run-041: NaN loss at step 450               │
│   • run-039: baseline accuracy 0.87             │
│   • run-038: scaled vs unscaled comparison      │
│                                                 │
│ ✅ Tasks                                        │
│   • [TODO] Test learned scaling parameter       │
│                                                 │
│ 💬 Chat Discussions                             │
│   • "sqrt(d_k) vs learned scaling" (Feb 22)     │
│                                                 │
│ 📦 Dependencies                                 │
│   • imports: torch, torch.nn.functional          │
│   • called by: MultiHeadAttention.forward()      │
└─────────────────────────────────────────────────┘
```

### Context-Aware Autocomplete

The autocomplete engine combines LSP suggestions with context engine suggestions:

```
Priority 1: LSP completions (type-accurate, from language server)
Priority 2: Context engine suggestions (semantically relevant code from elsewhere in the codebase)
Priority 3: AI completions (LLM-generated, with session context)
```

When the user types a function call or variable name:
1. LSP provides type-correct completions (standard)
2. The context engine searches LanceDB for similar code patterns in the same codebase
3. If enabled, the LLM generates a ghost text completion that considers the session context (what you're working on, what's in your notes, what the current task is)

---

## Sub-System 3C: LSP Integration

### Architecture

```
CodeMirror (frontend)
    │
    ▼ LSP messages via Tauri IPC
Rust (Tauri backend)
    │
    ▼ stdio pipe
Language Server Process (subprocess)
    ├── pylsp / pyright (Python)
    ├── typescript-language-server (JS/TS)
    ├── rust-analyzer (Rust)
    └── gopls (Go)
```

The Rust backend:
1. Manages language server process lifecycle (start, restart on crash, shutdown)
2. Proxies LSP JSON-RPC messages between the frontend and the language server
3. Handles multiple language servers simultaneously (one per language)

### Supported Features (per language server)

| Feature | Description |
|---------|-------------|
| `textDocument/completion` | Autocomplete suggestions |
| `textDocument/hover` | Type information and documentation on hover |
| `textDocument/definition` | Go to definition |
| `textDocument/references` | Find all references |
| `textDocument/rename` | Rename symbol across files |
| `textDocument/diagnostics` | Error and warning squiggles |
| `textDocument/formatting` | Code formatting |
| `textDocument/signatureHelp` | Function signature hints |

### Language Support Rollout

| Language | Server | Phase |
|----------|--------|-------|
| Python | pyright or pylsp | Phase 4 (first language) |
| JavaScript/TypeScript | typescript-language-server | Phase 6 |
| Rust | rust-analyzer | Phase 6 |
| Go | gopls | Phase 7 |
| Others | Community language servers | Phase 7+ |

Start with Python since it's your primary language. Each additional language server is a bounded effort (configure subprocess, test LSP messages).

---

## Sub-System 3D: AI Editing Features

### Inline AI Suggestions (Ghost Text)

Ghost text completions that appear as you type, similar to GitHub Copilot but with full session context:

```python
def training_loop(model, dataloader, optimizer):
    for epoch in range(num_epochs):
        for batch in dataloader:
            ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← ghost text suggestion
            # The LLM knows from session state:
            # - You're working on gradient accumulation (next_step)
            # - The previous implementation had OOM issues (blocker)
            # - Your config.yaml has accumulation_steps: 4
```

Implementation:
- On typing pause (debounce 500ms), send the current cursor context to the LLM router
- Context includes: current file content around cursor, session state payload, relevant knowledge graph entities
- LLM generates a completion
- Display as ghost text (CodeMirror decoration with reduced opacity)
- Tab to accept, Escape to dismiss, keep typing to dismiss and get new suggestion

### Refactoring Agent Panel

Select code → open refactoring panel → describe transformation in natural language:

```
┌── Refactoring Agent ───────────────────────┐
│                                             │
│ Selected: lines 45-89 of transformer.py     │
│                                             │
│ 💬 "Migrate this to use gradient           │
│     accumulation with configurable steps"   │
│                                             │
│ Context the agent sees:                     │
│ • Selected code (full function)             │
│ • AST-parsed surrounding context            │
│ • Session state (blocker: OOM at batch 128) │
│ • Linked notes (gradient accumulation plan) │
│ • config.yaml contents                      │
│                                             │
│ ┌── Proposed Changes ────────────────────┐  │
│ │ - train.py (12 lines modified)         │  │
│ │ - config.yaml (1 key added)            │  │
│ │                                        │  │
│ │ [View Diff] [Apply] [Reject] [Edit]    │  │
│ └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

The agent receives:
1. The selected code block
2. The full file for structural context
3. AST-parsed imports and dependencies
4. Related knowledge graph entities (linked notes, tasks, experiments)
5. Session state (blockers, next steps)

This context density is what makes the refactoring more intelligent than a generic AI code edit — the agent understands *why* you're refactoring, not just *what* you selected.

---

## Editor ↔ Terminal Integration

| Feature | Direction | Description |
|---------|-----------|-------------|
| Run file | Editor → Terminal | Button or Cmd+Enter: runs the active file in the terminal with the appropriate interpreter |
| Open from terminal | Terminal → Editor | Click a file path in terminal output to open it at the referenced line number |
| Error highlighting | Terminal → Editor | Terminal errors referencing a file automatically add error decorations in the editor |
| Terminal CWD sync | Editor → Terminal | Opening a file from a different project can optionally change the terminal's working directory |

---

## Configuration

```yaml
# editor.yaml
editor:
  font_family: "JetBrains Mono, Fira Code, monospace"
  font_size: 14
  tab_size: 4
  use_spaces: true
  word_wrap: false
  minimap: true
  line_numbers: true
  bracket_matching: true
  auto_indent: true

ai:
  inline_suggestions: true
  suggestion_debounce_ms: 500
  suggestion_model: null          # null = use default from LLM router
  max_suggestion_tokens: 150

lsp:
  python:
    server: "pyright"
    enabled: true
  typescript:
    server: "typescript-language-server"
    enabled: false               # Enable when you need it
  rust:
    server: "rust-analyzer"
    enabled: false

keybindings: "default"           # or path to custom keybindings file
theme: "dark"                    # dark, light, or custom theme name
```

---

## Open Questions for Future Iterations

- Should the editor support collaborative editing (CRDT-based)? This would be a massive scope addition but could be valuable for pair programming.
- Should inline AI suggestions be debounced differently for different contexts (e.g., faster in comments, slower in code)?
- Can we implement a "code lens" feature (similar to VS Code) that shows inline metadata above functions (test pass/fail, last modified, linked task count)?
- Should the file tree show knowledge graph metadata (e.g., number of linked notes per file)?
- How should large file handling work? (CodeMirror can struggle with 50,000+ line files — should we detect and suggest splitting?)
- Should the refactoring agent support multi-file refactoring (e.g., renaming a function used across 10 files)?
- Can we integrate diff view for comparing file versions (git diff in a side-by-side editor view)?
