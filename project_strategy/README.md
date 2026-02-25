# Project Strategy: AI-Augmented Workspace

> A comprehensive strategy breakdown for building an AI-native workspace with persistent semantic memory, a functional terminal, an agentic IDE, an auto-linking knowledge graph, and pluggable AI/ML capabilities. Local-first, built for a solo developer juggling aerospace work, a CS master's program, and side projects.

---

## Document Index

### Foundation

| Document | Description |
|----------|-------------|
| [00 — Philosophy & Principles](./foundation/00_philosophy_and_principles.md) | Core beliefs, three architectural pillars, six design principles, iteration protocol |
| [01 — System Architecture](./foundation/01_system_architecture.md) | Three-process model (Tauri + SolidJS + Python sidecar), communication patterns, state management, concurrency model, error handling |
| [02 — Tech Stack](./foundation/02_tech_stack.md) | Every technology choice with rationale, alternatives considered, and swap conditions |
| [03 — Data Schema](./foundation/03_data_schema.md) | Full SQLite table definitions, LanceDB collection schema, session state payload format, migration strategy |

### Modules

| Document | Description |
|----------|-------------|
| [04 — Context Engine](./modules/04_module_context_engine.md) | File ingestion pipeline, AST parsing, smart chunking, embedding, differential updates, session state capture & handoff, workspace profiles |
| [05 — Knowledge Graph](./modules/05_module_knowledge_graph.md) | Ontology layer (entity types, relationships), auto-linking engine, task management, universal semantic search |
| [06 — IDE](./modules/06_module_ide.md) | CodeMirror 6 editor, context-aware extensions, LSP integration, AI editing features (inline suggestions, refactoring agent) |
| [07 — Terminal](./modules/07_module_terminal.md) | xterm.js + PTY, shell integration, command capture, natural language mode, error resolution agent, pipeline monitoring |
| [08 — Agent Layer](./modules/08_module_agent_layer.md) | Model router (litellm), background agents (research daemon, pipeline monitor, digest agent), webhook/API extensibility |

### Phases

| Document | Description |
|----------|-------------|
| [09 — Phase 0: Skeleton](./phases/09_phase0_skeleton.md) | Tauri scaffolding, Python sidecar, SQLite/LanceDB init, IPC validation |
| [10 — Phase 1: Context Engine Core](./phases/10_phase1_context_engine.md) | File watching, tree-sitter parsing, embedding, semantic search |
| [11 — Phase 2: Session Handoff](./phases/11_phase2_session_handoff.md) | Session state capture, LLM integration, context-aware greeting, workspace profiles |
| [12 — Phase 3: Terminal](./phases/12_phase3_terminal.md) | xterm.js terminal, shell integration, NL mode, error resolution agent |
| [13 — Phase 4: Editor](./phases/13_phase4_editor.md) | CodeMirror editor, file tree, LSP for Python, AI suggestions |
| [14 — Phase 5: Knowledge Graph](./phases/14_phase5_knowledge_graph.md) | Entity extraction, auto-linking, task board, universal search, graph visualization |
| [15 — Phase 6: Agents & Polish](./phases/15_phase6_agents_polish.md) | Background agents, webhook API, settings UI, themes, notifications |
| [16 — Phase 7: Advanced](./phases/16_phase7_advanced.md) | Voice notes, ML experiment tracking, Foundry integration, multi-device sync, plugin system |

### Reference

| Document | Description |
|----------|-------------|
| [17 — Risk Register](./reference/17_risk_register.md) | Technical, platform, and project risks with mitigation strategies |
| [18 — Vision](./reference/18_vision.md) | What the finished product looks like in daily use — the north star |

---

## Directory Structure

```
project_strategy/
├── README.md                 ← You are here
├── foundation/
│   ├── 00_philosophy_and_principles.md
│   ├── 01_system_architecture.md
│   ├── 02_tech_stack.md
│   └── 03_data_schema.md
├── modules/
│   ├── 04_module_context_engine.md
│   ├── 05_module_knowledge_graph.md
│   ├── 06_module_ide.md
│   ├── 07_module_terminal.md
│   └── 08_module_agent_layer.md
├── phases/
│   ├── 09_phase0_skeleton.md
│   ├── 10_phase1_context_engine.md
│   ├── 11_phase2_session_handoff.md
│   ├── 12_phase3_terminal.md
│   ├── 13_phase4_editor.md
│   ├── 14_phase5_knowledge_graph.md
│   ├── 15_phase6_agents_polish.md
│   └── 16_phase7_advanced.md
└── reference/
    ├── 17_risk_register.md
    └── 18_vision.md
```

---

## How to Use These Documents

**Starting the build:** Begin with Phase 0. Each phase document has a "Definition of Done" checklist and a list of key tasks.

**Making design decisions:** Check the decision against `foundation/00_philosophy_and_principles.md`. If it conflicts with a principle, either change the decision or explicitly amend the principle.

**Choosing a technology:** Check `foundation/02_tech_stack.md` for the rationale and swap conditions. If a swap is warranted, update the document.

**Understanding a module:** The module documents (04-08) contain detailed specifications — pipeline flows, data schemas, configuration options, and open questions. They are the reference for building each module's features.

**Evaluating risk:** Check `reference/17_risk_register.md` before starting a new phase. Update risk status as risks materialize or are mitigated.

**Staying motivated:** Read `reference/18_vision.md`. That's what we're building toward.

---

## Iteration Protocol

Every document ends with an **Open Questions** section. These are the seeds for future iterations. When you revisit a document:

1. Review the open questions — has your thinking evolved on any of them?
2. Check the "Definition of Done" if it's a phase document — is everything checked off?
3. Add new open questions or observations from real usage
4. If a decision has changed, update the document and note the date and reason

These documents are living artifacts. They should evolve with the project.
