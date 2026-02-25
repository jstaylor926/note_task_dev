# Philosophy & Design Principles

> This document defines the foundational beliefs and non-negotiable design principles that govern every technical and product decision in the project. Future iterations should test proposed features against these principles — if a feature conflicts, the principle wins or the principle needs an explicit, documented amendment.

---

## Project Identity

This is an AI-native workspace built by a solo developer for a solo developer. It is not a startup product, not a SaaS play, and not trying to compete with VS Code or Obsidian on their terms. It exists because no existing tool unifies code editing, terminal interaction, note-taking, task management, and AI assistance into a single system with persistent, semantic memory.

The target user is someone who:
- Juggles multiple complex contexts daily (job, graduate program, side projects)
- Works across data engineering, ML/AI, and full-stack development
- Handles proprietary/sensitive codebases that cannot touch cloud services without explicit consent
- Wants their tools to remember what they were doing and why, not just what files were open

---

## Three Architectural Pillars

### Pillar 1: Session State & Handoff

The system captures the semantic state of a work session — not just which files were open, but what you were focused on, what was blocking you, and what you planned to do next. On session resume, this state is injected into the LLM's context so the AI assistant can greet you with full awareness.

**Why this is the killer feature:** Context switching is the most expensive cognitive tax. Every time you close your laptop and come back, you spend 10-20 minutes reconstructing where you were. This feature eliminates that overhead.

**Principle:** Session state capture must be automatic and invisible. If the user has to manually "save" their session state, the feature has failed.

### Pillar 2: Local-First Architecture

All core functionality operates entirely offline. Data never leaves the machine unless the user explicitly opts in to a cloud API. There is no cloud dependency for storage, embedding, or inference.

**Why this is non-negotiable:** The user works in aerospace (ITAR/export control considerations). Proprietary code, research data, and work artifacts must remain on local storage. Even for non-sensitive personal projects, local-first means the user owns their data completely.

**Principle:** Every feature must have a fully local execution path. Cloud APIs (Claude, OpenAI, Gemini) are opt-in performance upgrades, never dependencies.

### Pillar 3: Automatic Semantic Linking

The knowledge graph builds itself. Notes link to code, code links to tasks, tasks link to git branches, experiments link to configurations — all without the user manually tagging, linking, or organizing.

**Why this matters:** Manual knowledge management doesn't survive contact with a busy schedule. The moment you need to remember to tag a note or link it to a branch, the system decays into an unused organizational overhead.

**Principle:** If a linking mechanism requires manual user action, it must also have an automatic fallback. The auto-linker should produce correct links at least 80% of the time; incorrect links are cheaper than missing links.

---

## Design Principles

### 1. Session State Is Sacred

Never lose context. Every session exit produces a state payload. Every session start hydrates from the latest payload. This is the one thing that must never break. If the app crashes, the last periodic state snapshot should still be recoverable.

**Implications:**
- Session state writes must be crash-safe (SQLite WAL mode, atomic writes)
- Periodic background snapshots (every 5 minutes) in addition to exit-triggered captures
- State payloads are append-only — historical states are never deleted, only aged out by configurable retention policy

### 2. Automatic Over Manual

If it requires the user to remember to do something, it will be forgotten on a busy day. File watching, entity extraction, auto-linking, session capture, command logging — all automatic, all running in the background.

**Implications:**
- Background processes must be resource-aware (throttle CPU/memory usage during active coding)
- Automatic processes should be observable (a status indicator showing what's being indexed/processed)
- The user can always override or correct automatic actions, but should rarely need to

### 3. Local-First, Cloud-Optional

The entire system runs offline with Ollama and local embedding models. Cloud APIs are opt-in upgrades that can be toggled per workspace profile. A workspace profile marked "work" should never route to cloud APIs even if they're configured globally.

**Implications:**
- Model routing rules must be workspace-profile-aware
- The UI must clearly indicate when a cloud API is being used vs. local inference
- All embedding generation has a local path (sentence-transformers) even if API embeddings are configured as preferred

### 4. The Knowledge Graph Is an Emergent Property

You don't build the graph manually. It emerges from the continuous ingestion of work artifacts. Every file save, terminal command, note, commit, and chat message is a signal. The graph is the accumulated intelligence of all those signals linked together.

**Implications:**
- The entity extraction pipeline must run on every new piece of content entering the system
- Link confidence scores allow the system to surface uncertain connections as suggestions rather than facts
- The graph should be queryable both structurally (follow links) and semantically (search by meaning)

### 5. Each Phase Ships a Usable Tool

Phase 1 gives you semantic code search. Phase 2 gives you session memory. Phase 3 gives you an intelligent terminal. No phase depends on future phases to be useful. You start using the tool from the earliest phases and your real usage informs what to build next.

**Implications:**
- Phase boundaries are meaningful — each phase has a clear "done" state that delivers standalone value
- Features that span multiple phases should have degraded-but-functional behavior in earlier phases
- The build order is optimized for compound value: each new phase multiplies the utility of previous ones

### 6. Composable Internals

The context engine, knowledge graph, and agent router are independent services communicating via defined interfaces. You can swap LanceDB for ChromaDB, or Ollama for vLLM, or CodeMirror for Monaco, without rewriting unrelated modules.

**Implications:**
- Inter-module communication uses well-defined APIs (not shared global state)
- Storage layer access is abstracted behind repository interfaces
- LLM access is always through the router, never direct API calls from feature code

---

## Iteration Protocol

When revisiting this document in future iterations:

1. **Test new features against these principles.** If a feature requires cloud-only infrastructure, it violates Pillar 2. If it requires manual user action with no automatic fallback, it violates Principle 2.
2. **Principles can be amended, but amendments must be explicit.** If you decide that some features genuinely need cloud-only infrastructure (e.g., a collaborative feature), add an amendment section below documenting the reasoning.
3. **Track principle violations.** If a phase ships with a known principle violation (e.g., "auto-linking isn't working yet so manual tagging is required"), document it as technical debt with a plan to resolve it.

---

## Amendments

*None yet. This section will track any future exceptions or modifications to the principles above.*

---

## Open Questions for Future Iterations

- Should workspace profiles support inheritance (e.g., a "base" profile with shared settings)?
- What's the retention policy for historical session states? Keep forever, or age out after N days?
- Should the knowledge graph support "private" entities that are excluded from certain workspace profiles?
- How should the system handle conflicts when the same file is watched by multiple workspace profiles?
