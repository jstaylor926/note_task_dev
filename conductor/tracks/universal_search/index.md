# Universal Search Integration Track

**ID:** `universal_search`
**Status:** In Progress
**Priority:** High
**Owner:** Gemini CLI

## Overview
Implement a high-performance, unified search interface that searches across all data types (code, notes, tasks, files, terminal history) with hybrid vector-keyword scoring and actionable results.

## Key Goals
- **Hybrid Search Engine**: Unify LanceDB (vector) and SQLite (keyword/FTS5) queries.
- **Terminal History Embedding**: Embed terminal commands and stdout for semantic search.
- **Unified Relevance Scoring**: Develop a better ranking algorithm combining similarity, matching, and recency.
- **Actionable Results**: Add "Quick Actions" like creating tasks or opening files directly from search.
- **Improved UI**: Better result visualization with source and project context.

## Documents
- [Specification](./spec.md)
- [Implementation Plan](./plan.md)
- [Metadata](./metadata.json)
