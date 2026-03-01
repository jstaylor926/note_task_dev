# Universal Search Implementation Plan

## Phase 1: Infrastructure & Data Prep
- [x] **SQLite FTS5**: Enable FTS5 in `db.rs` and create a unified `fts_search` table for cross-entity keyword indexing.
- [x] **Terminal Indexing**: Enhance `ingest.rs` to trigger background embedding of `terminal_commands.output` (for stdout) and `terminal_commands.command` (for keyword indexing).
- [x] **Metadata Alignment**: Ensure all searchable entities have `updated_at`, `git_branch`, and `workspace_profile_id` consistently.

## Phase 2: Hybrid Search Logic (Rust)
- [x] **Search Coordinator**: Rewrite `universal_search` command to be a coordinator that spawns parallel keyword and vector queries.
- [x] **BM25 Scoring**: Implement (or use SQLite's) BM25 for keyword scoring.
- [x] **Rank Fusion**: Implement a simple Rank Fusion (e.g., Reciprocal Rank Fusion or weighted sum) to combine scores.
- [x] **Context Injection**: Filter results by active workspace and branch (with optional "global" toggle).

## Phase 3: Sidecar Enhancements (Python)
- [x] **Search Refactoring**: Update sidecar `/search` to return more structured metadata and scores.
- [x] **Terminal Chunker**: Add a specialized chunker for terminal output (e.g., identifying tool outputs, error messages).

## Phase 4: Frontend & UI
- [x] **Polymorphic UI**: Update `UniversalSearch.tsx` to display diverse result types with specific icons/badges.
- [x] **Actionable Search**: Add a "Quick Action" section (e.g., "Create task: [query]").
- [x] **Keyboard Navigation**: Full keyboard-only interaction (arrows to select, Enter to open, Cmd+Enter for secondary action).
- [x] **Global Search Panel**: A more permanent search view in the sidebar.

## Verification
- [x] **Search Accuracy**: Test with specific keywords, paths, and fuzzy semantic queries.
- [x] **Performance**: Ensure <100ms end-to-end for most queries.
- [x] **Ranking**: Verify that exact symbol matches rank higher than broad semantic matches.
