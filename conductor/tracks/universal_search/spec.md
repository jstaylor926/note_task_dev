# Universal Search Specification

## 1. Goal
Provide a unified, performant, and intelligent search experience that acts as the primary "brain" for navigating the workspace.

## 2. Scope
Search across:
- **Code**: All files in the watched directories (functions, classes, structs).
- **Notes**: All markdown notes.
- **Tasks**: All manual and auto-extracted tasks.
- **Terminal History**: Commands and (substantial) stdout capture.
- **Files**: Filenames and paths.

## 3. Hybrid Search Strategy
- **Vector (LanceDB)**: Semantic similarity for code, notes, and terminal stdout.
- **Keyword (SQLite FTS5)**: Exact matches for symbols, filenames, and command strings.
- **Unified Scoring**: `final_score = (alpha * similarity_score) + (beta * keyword_score) + (gamma * recency_boost)`.

## 4. Metadata and Context
Search results should include:
- **Project/Profile Context**: Which workspace the result belongs to.
- **Git Context**: Which branch the result was captured from.
- **Recency**: Timestamp for ranking and display.

## 5. UI Requirements
- **Overlay**: Central Cmd+K/Cmd+P overlay.
- **Polymorphic Cards**: Different icons and snippets for different result types.
- **Fuzzy Paths**: Path-aware fuzzy matching for file navigation.
- **Actionable Results**:
  - "Create task: [query]" if no good match is found.
  - "Open in Terminal" for command history results.
  - "Navigate to definition" for code symbols.
