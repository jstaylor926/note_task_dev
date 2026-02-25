# Foundation Study Guides

> These guides explain the underlying concepts and technologies referenced in the foundation documents. Read them to build a deep understanding of *how* and *why* the system works — not just *what* it does.

---

## Reading Order

Start with the system architecture guide for the big picture, then read the others in any order based on what you want to understand next.

| # | Guide | What You'll Learn |
|---|-------|-------------------|
| 1 | [System Architecture](./study_01_system_architecture.md) | Processes, threads, IPC, WebViews, async runtimes, event loops, streaming, crash isolation |
| 2 | [Embeddings & Semantic Search](./study_02_embeddings_and_semantic_search.md) | How text becomes vectors, cosine similarity, the embedding pipeline, vector databases, ANN search, hybrid search |
| 3 | [AST Parsing & Code Intelligence](./study_03_ast_parsing_and_code_intelligence.md) | Syntax trees, tree-sitter's incremental parsing, query language, smart chunking, LSP protocol |
| 4 | [Database Concepts](./study_04_database_concepts.md) | SQLite internals, WAL mode, graph modeling in SQL, JSON columns, indexes, B-trees, migrations, hybrid storage |
| 5 | [Rust, Tauri & Reactive Frontends](./study_05_rust_tauri_and_reactive_frontends.md) | Rust ownership/borrowing, Tauri IPC and plugins, SolidJS signals vs React virtual DOM, TailwindCSS |

---

## How These Connect to the Foundation Documents

| Foundation Document | Study Guides That Explain Its Concepts |
|---|---|
| 00 — Philosophy & Principles | All (the principles are grounded in the technical realities explained across all guides) |
| 01 — System Architecture | Study 01 (processes, IPC, async) + Study 05 (Rust, Tauri, SolidJS) |
| 02 — Tech Stack | Study 03 (tree-sitter) + Study 02 (embeddings, LanceDB) + Study 04 (SQLite) + Study 05 (Rust, Tauri, SolidJS) |
| 03 — Data Schema | Study 04 (SQLite, WAL, indexes, migrations) + Study 02 (LanceDB, vector schema) |
