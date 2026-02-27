# Implementation Plan - Context Engine Core

This plan outlines the steps to implement the core file ingestion and semantic search pipeline for Cortex.

## Phase 1: Sidecar Foundation & Vector DB

- [x] **Task: Sidecar - Implement LanceDB initialization and schema management** 76dc887
    - [x] Write tests for LanceDB connection and table creation in `sidecar/tests/`
    - [x] Implement LanceDB setup and schema definition in `sidecar/cortex_sidecar/main.py`
    - [x] Verify table persistence across sidecar restarts

- [x] **Task: Sidecar - Create embedding and search API endpoints** a981b0d
    - [x] Write tests for `/embed` and `/search` endpoints
    - [x] Implement chunk embedding logic (using a lightweight model like `all-MiniLM-L6-v2`)
    - [x] Implement vector search logic against the LanceDB table
    - [x] Verify endpoint responses with mock data

- [ ] **Task: Conductor - User Manual Verification 'Phase 1: Sidecar Foundation' (Protocol in workflow.md)**

## Phase 2: Rust File Watcher & Ingestion

- [ ] **Task: Rust - Implement file watcher using the `notify` crate**
    - [ ] Write tests for file event detection (Add, Modify, Delete)
    - [ ] Implement `FileWatcher` module in `src-tauri/src/watcher.rs`
    - [ ] Integrate watcher with the main Tauri setup to monitor the workspace directory

- [ ] **Task: Rust - Implement basic text chunking and ingestion trigger**
    - [ ] Write tests for text chunking logic
    - [ ] Implement a simple sliding window or paragraph-based chunker in Rust
    - [ ] Implement the trigger logic to send new/modified chunks to the Python sidecar
    - [ ] Verify that file events correctly trigger sidecar requests

- [ ] **Task: Conductor - User Manual Verification 'Phase 2: Rust File Watcher' (Protocol in workflow.md)**

## Phase 3: Integration & UI

- [ ] **Task: Frontend - Implement indexing status and search UI**
    - [ ] Write tests for the `IndexingStatus` component
    - [ ] Implement a status indicator in the `WorkspaceLayout` (e.g., "Indexing 45/100 files")
    - [ ] Create a basic semantic search input that queries the sidecar via Tauri commands
    - [ ] Display search results with source file references

- [ ] **Task: Conductor - User Manual Verification 'Phase 3: Integration & UI' (Protocol in workflow.md)**
