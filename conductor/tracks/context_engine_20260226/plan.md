# Implementation Plan - Context Engine Core

This plan outlines the steps to implement the core file ingestion and semantic search pipeline for Cortex.

## Phase 1: Sidecar Foundation & Vector DB [checkpoint: 5fa715c]

- [x] **Task: Sidecar - Implement LanceDB initialization and schema management** 76dc887
    - [x] Write tests for LanceDB connection and table creation in `sidecar/tests/`
    - [x] Implement LanceDB setup and schema definition in `sidecar/cortex_sidecar/main.py`
    - [x] Verify table persistence across sidecar restarts

- [x] **Task: Sidecar - Create embedding and search API endpoints** a981b0d
    - [x] Write tests for `/embed` and `/search` endpoints
    - [x] Implement chunk embedding logic (using a lightweight model like `all-MiniLM-L6-v2`)
    - [x] Implement vector search logic against the LanceDB table
    - [x] Verify endpoint responses with mock data

- [x] **Task: Conductor - User Manual Verification 'Phase 1: Sidecar Foundation' (Protocol in workflow.md)** 5fa715c

## Phase 2: Rust File Watcher & Ingestion [checkpoint: 4b9ee65]

- [x] **Task: Rust - Implement file watcher using the `notify` crate** b3d0c74
    - [x] Write tests for file event detection (Add, Modify, Delete)
    - [x] Implement `FileWatcher` module in `src-tauri/src/watcher.rs`
    - [x] Integrate watcher with the main Tauri setup to monitor the workspace directory

- [x] **Task: Rust - Implement basic text chunking and ingestion trigger** 862ce97
    - [x] Write tests for text chunking logic
    - [x] Implement a simple sliding window or paragraph-based chunker in Rust
    - [x] Implement the trigger logic to send new/modified chunks to the Python sidecar
    - [x] Verify that file events correctly trigger sidecar requests

- [x] **Task: Conductor - User Manual Verification 'Phase 2: Rust File Watcher' (Protocol in workflow.md)** 4b9ee65

## Phase 3: Integration & UI

- [~] **Task: Frontend - Implement indexing status and search UI**
    - [x] Add Rust event types (`events.rs`) and indexing state tracking in `AppState`
    - [x] Wire indexing events into file watcher (`watcher.rs`) via `app_handle.emit()`
    - [x] Add `semantic_search` and `get_indexing_status` Tauri commands (`commands.rs`)
    - [x] Extend frontend Tauri API layer with types, search fn, and event listeners (`lib/tauri.ts`)
    - [x] Set up Vitest test framework with SolidJS testing library
    - [x] Write tests for the `IndexingStatus` component (5 tests)
    - [x] Write tests for the `SearchPanel` component (6 tests)
    - [x] Implement `IndexingStatus` component with idle/active states in header bar
    - [x] Implement `SearchPanel` component with search form and results display
    - [x] Wire components into `WorkspaceLayout` (header + right sidebar)
    - [ ] All 11 frontend tests pass, all 8 Rust tests pass

- [ ] **Task: Conductor - User Manual Verification 'Phase 3: Integration & UI' (Protocol in workflow.md)**
