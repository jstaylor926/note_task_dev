# Module Study Guides

> These guides explain the underlying concepts and technologies referenced in the module specification documents. Read the foundation study guides first for architecture-level understanding, then read these for module-specific depth.

---

## Reading Order

These guides are independent — read them based on which module you're working on or curious about. Each covers the "how does this actually work?" behind a specific module.

| # | Guide | What You'll Learn |
|---|-------|-------------------|
| 1 | [File Watching & Event Pipelines](./study_01_file_watching_and_event_pipelines.md) | OS file notification APIs, debouncing vs throttling, content hashing, event-driven pipeline architecture, batching, back-pressure, ignore patterns |
| 2 | [NER, Fuzzy Matching & Auto-Linking](./study_02_ner_fuzzy_matching_and_autolinking.md) | Named entity recognition (regex/spaCy/LLM), Levenshtein distance, token-based fuzzy matching, entity resolution cascades, confidence scoring, temporal co-occurrence, BM25 ranking |
| 3 | [Terminal Emulation & PTY](./study_03_terminal_emulation_and_pty.md) | Pseudo-terminals (master/slave), ANSI escape codes, OSC sequences, xterm.js architecture, shell integration hooks (OSC 633), terminal resize protocol |
| 4 | [LLM Routing & Context Windows](./study_04_llm_routing_and_context_windows.md) | litellm unified API, token budgets, context window management strategies, routing rules, fallback chains, cost tracking, local vs cloud privacy, background agent scheduling |
| 5 | [CodeMirror 6 Extensions](./study_05_codemirror_extension_architecture.md) | Immutable state model, transactions, state fields, decorations (mark/widget/line), facets, view plugins, rope data structure, viewport-aware rendering, keymap handling |

---

## How These Connect to the Module Documents

| Module Document | Study Guides That Explain Its Concepts |
|---|---|
| 04 — Context Engine | Study 01 (file watching, pipelines, hashing) + Foundation Study 02 (embeddings) + Foundation Study 03 (AST/tree-sitter) |
| 05 — Knowledge Graph | Study 02 (NER, fuzzy matching, auto-linking) + Foundation Study 02 (embeddings for semantic matching) + Foundation Study 04 (graph modeling in SQL) |
| 06 — IDE | Study 05 (CodeMirror extensions) + Foundation Study 03 (tree-sitter, LSP) + Foundation Study 05 (SolidJS reactivity) |
| 07 — Terminal | Study 03 (PTY, xterm.js, shell integration) + Foundation Study 01 (IPC, processes) |
| 08 — Agent Layer | Study 04 (LLM routing, context windows, costs) + Foundation Study 01 (async runtimes, SSE streaming) |

---

## Prerequisites

These guides assume you've read (or at least skimmed) the foundation study guides in `../foundation/STUDY_GUIDES.md`. In particular:

- **Foundation Study 01 (System Architecture)** — explains the three-process model and IPC patterns that all modules depend on
- **Foundation Study 02 (Embeddings)** — explains vector search, which is referenced heavily in Study 01 and Study 02 above
- **Foundation Study 04 (Database Concepts)** — explains SQLite and LanceDB, which every module uses for storage
