# Phase Study Guides — Index

> These guides cover the **practical skills and engineering practices** needed to execute the 8-phase build plan. While the foundation guides explain *what* the technologies are and the module guides explain *how* the subsystems work, these phase guides focus on *how to actually build, test, ship, and maintain* the project.

---

## Reading Order

| # | Study Guide | Covers Concepts From | Key Topics |
|---|-------------|---------------------|------------|
| 1 | [Dev Environment & Toolchains](study_01_dev_environment_and_toolchains.md) | [Phase 0: Skeleton](09_phase0_skeleton.md) | Rust/Cargo, Node/pnpm/Vite, Python/uv, Tauri orchestration, first-time setup |
| 2 | [Testing a Three-Process Architecture](study_02_testing_a_three_process_architecture.md) | All phases | Unit/integration/E2E testing, mocking strategies, performance benchmarking, crash recovery |
| 3 | [Incremental Delivery & Phase Sequencing](study_03_incremental_delivery_and_phase_sequencing.md) | All phases | Vertical slices, dependency graph, Definition of Done, scope management, solo dev strategies |
| 4 | [Packaging & Distribution](study_04_packaging_and_distribution.md) | [Phase 0](09_phase0_skeleton.md), all phases (release) | PyInstaller, model distribution, cross-platform concerns, auto-updates |
| 5 | [Git Integration & Programmatic Access](study_05_git_integration_and_programmatic_access.md) | [Phase 2](11_phase2_session_handoff.md), [Phase 4](13_phase4_editor.md), [Phase 5](14_phase5_knowledge_graph.md) | git2 crate, porcelain parsing, git gutter, GitEvent entities, multi-repo handling |

---

## How These Guides Relate to the Phase Documents

The 8 phase documents (09–16) are **implementation plans** — they specify *what* to build in each phase, with Definitions of Done and architecture decisions. These study guides extract the **cross-cutting engineering skills** that span multiple phases:

- **Guide 1 (Toolchains)** prepares you to execute Phase 0 and every phase after it — you need the dev environment working before anything else.
- **Guide 2 (Testing)** applies to every phase. Each phase should have unit tests for its new code, integration tests for its IPC boundaries, and crash recovery tests for its failure modes.
- **Guide 3 (Incremental Delivery)** is the strategic framework for the entire project — why the phases are ordered this way, how to avoid scope creep, and how to stay motivated as a solo developer.
- **Guide 4 (Packaging)** becomes critical when transitioning from development to distribution, but understanding the constraints early (e.g., Python sidecar bundling) informs decisions in every phase.
- **Guide 5 (Git Integration)** covers a specific subsystem that touches three different phases — session state (Phase 2), editor git gutter (Phase 4), and knowledge graph GitEvent entities (Phase 5).

---

## Prerequisites

These guides assume familiarity with the concepts covered in the **Foundation Study Guides** and **Module Study Guides**:

- [Foundation Study Guides](../foundation/STUDY_GUIDES.md) — System architecture, embeddings, AST parsing, databases, Rust/Tauri/SolidJS
- [Module Study Guides](../modules/STUDY_GUIDES.md) — File watching, NER/autolinking, terminal emulation, LLM routing, CodeMirror

---

## Suggested Approach

1. **Read Guide 1 (Toolchains) first** — set up your dev environment before anything else.
2. **Read Guide 3 (Incremental Delivery) second** — understand the overall strategy before diving into implementation.
3. **Read Guide 2 (Testing) as you start Phase 0** — establish testing habits from the beginning.
4. **Read Guide 5 (Git Integration) before Phase 2** — git context is needed for session state capture.
5. **Read Guide 4 (Packaging) before preparing for release** — or skim it early to understand the constraints that affect your architecture decisions.
