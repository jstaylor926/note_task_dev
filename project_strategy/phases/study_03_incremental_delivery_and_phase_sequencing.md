# Study Guide: Incremental Delivery & Phase Sequencing

> This guide explains *why* the 8 phases are ordered the way they are, the software engineering principles behind incremental delivery, and strategies for maintaining momentum on a long solo project.

---

## 1. Why Not Build Everything at Once?

A solo developer building all features simultaneously faces compounding problems:

- **Nothing works until everything works.** If you build the editor, terminal, knowledge graph, and agent layer in parallel, none of them are usable until all of them integrate. That could be months of work before you can use any of it.
- **Debugging across half-built systems is hellish.** Is the search broken because of the embedding pipeline, the chunking logic, the LanceDB schema, or the frontend rendering? When everything is half-done, the answer could be any of them.
- **Motivation collapses.** Six months of work with nothing usable to show is demoralizing, even for the most dedicated builder.

The alternative: **each phase produces a working, usable tool.** After Phase 1, you have a semantic code search engine. After Phase 2, you have a context-aware AI assistant. After Phase 3, you have an intelligent terminal. Each phase builds on the last, but each phase is independently valuable.

---

## 2. Vertical Slices vs. Horizontal Layers

### The Horizontal Approach (Layers)

Build all of one layer before starting the next:

```
Month 1-2: Build entire database layer (all tables, all schemas, all migrations)
Month 3-4: Build entire backend API (all endpoints, all business logic)
Month 5-6: Build entire frontend (all components, all pages, all interactions)
Month 7-8: Connect everything together
```

Problem: nothing works until Month 8. And when you finally connect the layers, you discover that your database schema doesn't quite match what the frontend needs, your API doesn't handle streaming, and your authentication model needs rethinking.

### The Vertical Approach (Slices)

Build thin slices that cut through all layers:

```
Phase 0: Skeleton (2 weeks)
    → One IPC call works end-to-end: Frontend → Rust → Python → Rust → Frontend
    → Database created with all tables
    → You have: a running app that proves the architecture works

Phase 1: Context Engine (3-4 weeks)
    → File watcher + tree-sitter + embedding + search
    → You have: a semantic code search tool (genuinely useful!)

Phase 2: Session Handoff (3-4 weeks)
    → LLM integration + session capture + hydration + chat
    → You have: an AI assistant that remembers your context
```

Each phase touches all three processes (Rust, Python, frontend) but only implements the features for that slice. When something doesn't work, the bug is in the small amount of new code, not in a massive untested codebase.

---

## 3. The Phase Dependency Graph

The phases aren't arbitrary — each builds on capabilities from previous phases:

```
Phase 0: Skeleton
    ├── Three-process architecture validated
    ├── IPC pattern proven
    └── Database initialized
         │
         ▼
Phase 1: Context Engine
    ├── File watching + indexing pipeline
    ├── Semantic search
    └── CodeUnit entity creation
         │
         ▼
Phase 2: Session Handoff ← depends on search (for context retrieval)
    ├── LLM integration (litellm)
    ├── Session capture + hydration
    ├── Chat panel
    └── Workspace profiles
         │
         ▼
Phase 3: Terminal ← depends on LLM (for error resolution, NL mode)
    ├── xterm.js + PTY
    ├── Shell integration
    ├── Error resolution agent
    └── Natural language mode
         │
         ▼
Phase 4: Editor ← depends on terminal (for run-file, error linking)
    ├── CodeMirror 6
    ├── LSP integration
    ├── AI inline suggestions
    └── Editor ↔ Terminal integration
         │
         ▼
Phase 5: Knowledge Graph ← depends on all above (entities from all sources)
    ├── Auto-linking engine
    ├── Task extraction
    ├── Notes panel
    └── Universal search
         │
         ▼
Phase 6: Agents & Polish ← depends on knowledge graph (agents need entities)
    ├── Background agents
    ├── Full routing rules
    └── UI polish + themes
         │
         ▼
Phase 7: Advanced ← depends on everything (extension and integration)
    ├── Multi-file refactoring
    ├── Voice notes
    ├── Plugin system
    └── Multi-device sync
```

### Why This Specific Order?

**Phase 0 before everything:** Without the three-process skeleton, you can't build anything else.

**Phase 1 (Context Engine) before Phase 2 (Session Handoff):** Session hydration needs semantic search to retrieve relevant code context. Without embeddings and LanceDB, the session handoff can't compose a meaningful LLM prompt.

**Phase 2 (Session Handoff) before Phase 3 (Terminal):** The terminal's error resolution agent and natural language mode both require LLM integration, which is set up in Phase 2. The session state capture also needs to be established before the terminal can contribute to it.

**Phase 3 (Terminal) before Phase 4 (Editor):** The editor needs "Run file in terminal" and "click error → open in editor" features. The terminal must exist first.

**Phase 5 (Knowledge Graph) after Phases 1-4:** The knowledge graph connects entities from ALL sources — code, notes, terminal, chat, git. Building it after the data sources exist means you have real data to work with, not synthetic test data.

**Phase 6 (Agents) after Phase 5 (Knowledge Graph):** Background agents (research daemon, digest agent) operate on the knowledge graph. They need entities, links, and tasks to exist.

---

## 4. The "Definition of Done" Pattern

Each phase document includes a **Definition of Done** — a checklist of specific, testable criteria:

```markdown
## Definition of Done

- [ ] File watcher monitors configured directories and detects changes
- [ ] tree-sitter parses Python files into AST and extracts function/class boundaries
- [ ] Semantic search returns results in < 500ms
```

### Why This Matters

Without a clear DoD:
- You endlessly polish Phase 1 instead of moving to Phase 2 ("the search results could be ranked better...")
- You build Phase 2 features while Phase 1 is half-done, creating a shaky foundation
- You lose track of what's actually working vs. what's aspirational

### Using the DoD

1. **Before starting a phase:** Read the DoD. Understand what "done" means.
2. **While building:** Work through items systematically. Skip none.
3. **At the end:** Go through the checklist. Every item must be checkable. If something isn't done, either finish it or explicitly defer it (with a note about why).
4. **Only then:** Move to the next phase.

---

## 5. Managing Scope Within a Phase

### The Temptation

You're building Phase 3 (Terminal), and you realize: "The error resolution agent would be SO much better if it could also search Stack Overflow and suggest solutions from there." That's a Phase 6+ feature. Building it now means:

- Phase 3 takes twice as long
- The Stack Overflow integration depends on web scraping or API integration you haven't designed
- You're not getting value from the terminal features that ARE ready

### The Discipline

If a feature isn't in the current phase's DoD, it goes into the "Open Questions" section of the current phase or the task list for a future phase. Write it down so you don't forget it, but don't build it now.

**Exception:** If you discover during Phase 3 that a Phase 1 component needs fixing (e.g., the search is too slow, a schema is wrong), fix it immediately. Fixing foundations is different from adding new features.

### The Open Questions Pattern

Every phase document ends with "Open Questions." These are explicitly deferred decisions:

```markdown
## Open Questions

- Should the NL mode support multi-step translations?
- Can we detect command dependencies?
- Should the pipeline monitor integrate with Grafana?
```

These aren't forgotten — they're acknowledged and tracked. When you start Phase 7, review all open questions from all phases to see which ones now make sense to address.

---

## 6. Solo Developer Strategies

### Time Boxing

Set a time budget per phase. If Phase 1 is estimated at 3-4 weeks and you're at week 6, something needs to change: either cut scope (move an item to a future phase), accept reduced quality (good enough is good enough), or debug your estimate for future phases.

### Daily Progress Notes

Write a 2-3 sentence note at the end of each working session:

```
2024-02-24: Implemented debouncing in file watcher. Found that watchdog fires
3 events per save on macOS. tree-sitter parsing works for functions but not
decorated functions yet. Tomorrow: fix decorator handling, start chunk hashing.
```

This is your session state for *you* (meta, right?). When you come back after a weekend, these notes tell you exactly where you left off. They also feed into the session state the app will eventually capture.

### The "Ship It" Mindset

Phase 1's context engine doesn't need perfect embeddings, perfect chunking, or perfect search ranking. It needs to **work**: file change → embedding stored → searchable. You can improve quality in every subsequent phase as you discover what matters.

Don't optimize what you haven't measured. Don't perfect what you haven't used.

---

## 7. Feature Flags for Incomplete Work

Sometimes you want to start a feature in one phase but finish it in another. **Feature flags** let you ship incomplete code without exposing it to users:

```python
# config.py
FEATURES = {
    "nl_terminal_mode": True,       # Phase 3: shipped
    "voice_notes": False,            # Phase 7: code exists but not ready
    "multi_device_sync": False,      # Phase 7: not started
}

# In the terminal module
if FEATURES["nl_terminal_mode"]:
    register_nl_mode_handler()
```

```typescript
// Frontend
const FEATURES = {
    nlTerminalMode: true,
    voiceNotes: false,
};

{FEATURES.voiceNotes && <VoiceNoteButton />}
```

This lets you merge code for future features without accidentally exposing half-baked functionality. When you're ready to enable it, flip the flag.

---

## 8. The Compound Payoff

The magic of this phase structure is that later phases get dramatically more powerful because they build on earlier ones:

**Phase 5 (Knowledge Graph)** is relatively simple to implement because:
- Phase 1 already handles file indexing and embedding
- Phase 2 already handles LLM integration
- Phase 3 already logs terminal commands to SQLite
- Phase 4 already extracts CodeUnit entities with tree-sitter

All Phase 5 needs to add is the auto-linking logic and UI. The *data sources* are already flowing.

**Phase 6 (Agents)** is mostly configuration because:
- The research daemon just needs an ArXiv API client + existing embedding pipeline
- The digest agent queries existing tables (tasks, experiments, errors)
- The pipeline monitor extends existing terminal command tracking

By Phase 6, the hard infrastructure work is done. You're composing capabilities, not building them from scratch.

---

## Key Takeaways

1. **Vertical slices over horizontal layers.** Each phase cuts through all three processes and produces something usable.

2. **Dependencies determine order.** Session handoff needs search. Terminal needs LLM. Editor needs terminal. Knowledge graph needs all data sources. The order isn't arbitrary.

3. **Definition of Done prevents scope creep.** A concrete checklist tells you when to stop and move on.

4. **Open Questions are acknowledged, not forgotten.** Write down future ideas so you don't feel compelled to build them now.

5. **Each phase amplifies the next.** The compound effect means later phases are faster because they compose existing capabilities.

6. **Ship, then improve.** A working feature you can use beats a perfect feature you can't.

---

## Further Reading

- [Shape Up (Basecamp)](https://basecamp.com/shapeup) — A methodology for scoping and shipping work in cycles
- [The Pragmatic Programmer: "Tracer Bullets"](https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/) — The original argument for end-to-end thin slices
- [Continuous Delivery (Humble & Farley)](https://continuousdelivery.com/) — The principles behind shipping early and often
