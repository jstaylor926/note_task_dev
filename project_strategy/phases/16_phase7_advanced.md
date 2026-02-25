# Phase 7: Advanced Features

> **Goal:** The features that transform this from a capable tool into a mature, deeply personalized workspace. Context-aware refactoring, voice notes, ML experiment tracking, Foundry integration, multi-device sync, and a plugin system.

**Prerequisite:** Phase 6 (agents & polish) complete.

---

## Definition of Done

- [ ] Context-aware refactoring agent handles multi-file transformations
- [ ] Voice note capture and local transcription (whisper.cpp)
- [ ] ML experiment tracking integration (MLflow/W&B hooks)
- [ ] Foundry API integration for pipeline context
- [ ] Multi-device sync for SQLite and LanceDB
- [ ] Plugin system for extending functionality
- [ ] Additional language support via tree-sitter grammars and LSP servers

---

## Features

### 1. Advanced Refactoring Agent

- Multi-file refactoring: rename a function used across 10 files, migrate a pattern across a codebase
- Dependency-aware: understands import chains and won't break consumers
- Preview: full multi-file diff view before applying changes
- Undo: revert all changes from a refactoring operation as a single unit
- Examples: "migrate all Pandas DataFrames to PySpark", "extract this repeated pattern into a shared utility"

### 2. Voice Notes

- Push-to-talk voice capture from within the app
- Local transcription via whisper.cpp (no cloud dependency)
- Transcribed text becomes a Note entity in the knowledge graph
- Auto-linking applies to transcribed text (same as typed notes)
- Optional: speaker diarization for meeting notes (future)

### 3. ML Experiment Tracking Integration

- MLflow integration: read experiment data from local MLflow tracking server
- W&B integration: read run data from W&B API (if configured)
- Create Experiment entities from tracking data
- Link experiments to: config files, training scripts, git commits
- Experiment comparison view: side-by-side metrics, hyperparameters, artifacts

### 4. Foundry API Integration

- Connect to Palantir Foundry APIs for pipeline status
- Push: context from local work into Foundry (if permitted)
- Pull: pipeline status, dataset metadata, build outcomes into local knowledge graph
- Create entities for Foundry datasets, pipelines, and builds
- Security: respect profile-level cloud API blocking

### 5. Multi-Device Sync

- Sync SQLite database between machines (conflict resolution via last-write-wins or CRDT)
- Sync LanceDB embeddings (or re-index from source files on each machine)
- Options: git-based sync (commit DB files), file sync (Syncthing/Dropbox), or custom sync protocol
- Selective sync: choose which workspace profiles sync

### 6. Plugin System

- Plugin interface: Python plugins that register new background agents, entity types, or API endpoints
- Plugin manifest: name, version, dependencies, entry point
- Plugin directory: load plugins from `~/.config/app-name/plugins/`
- Example plugins: Slack integration, calendar sync, custom NER models, domain-specific entity types
- Plugin configuration UI in settings

### 7. Additional Language Support

- tree-sitter grammars: Go, Java, C/C++, Ruby, PHP, Swift, Kotlin
- LSP servers: gopls, jdtls, clangd, solargraph
- Each language is a bounded addition: install grammar, map highlights, configure LSP

---

## Open Questions

- Should multi-device sync be peer-to-peer or use a central server (even self-hosted)?
- What's the minimum plugin API surface? Start minimal and expand based on actual plugin needs.
- Should Foundry integration use the official SDK or REST API directly?
- Can voice notes support real-time transcription (streaming) or only post-capture?
- Should the experiment comparison view support charting (loss curves, metric plots)?
