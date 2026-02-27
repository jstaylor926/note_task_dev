# Specification: Context Engine Core

## Goal
Implement the core file ingestion and semantic search pipeline to provide Cortex with a persistent semantic memory.

## Functional Requirements
- **File Watching:** Monitor the workspace directory for file additions, modifications, and deletions using Rust.
- **Smart Chunking:** Partition files into meaningful semantic chunks based on language-specific AST parsing (Tree-sitter).
- **Embedding Pipeline:** Send chunks to the Python sidecar for embedding generation.
- **Vector Storage:** Persist embeddings and metadata in LanceDB.
- **Semantic Search:** Expose a search API to retrieve relevant context based on natural language queries.

## Technical Constraints
- **Performance:** File indexing should happen in the background without blocking the UI.
- **Local-First:** All processing and storage must occur locally.
- **Scalability:** Handle projects with thousands of files efficiently through differential updates.
