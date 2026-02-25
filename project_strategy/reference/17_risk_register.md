# Risk Register

> This document tracks known risks, their likelihood, impact, and mitigation strategies. These are not reasons to cut scope — they are things to watch for and plan around. Future iterations should update this register as risks materialize, are mitigated, or new risks emerge.

---

## Risk Categories

### Technical Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|-----------|
| T1 | **xterm.js + WebKit rendering on Linux** — WebKit (used by Tauri on Linux) may have font rendering or escape sequence differences from Chromium | Medium | Medium | Test terminal rendering on Linux early (Phase 3). If severe, evaluate running terminal in a separate Chromium-based webview or Alacritty sidecar. |
| T2 | **tree-sitter grammar quality for niche languages** — Python/JS grammars are excellent, but less common languages may have incomplete or buggy grammars | Medium | Low | Start with well-supported languages (Python, JS, Rust). For niche languages, fall back to regex-based chunking. Contribute grammar fixes upstream. |
| T3 | **Local embedding model quality ceiling** — `all-MiniLM-L6-v2` is good for general text but may produce poor embeddings for domain-specific code | Medium | Medium | Evaluate code-specific models (`codebert-base`, `codellama` embeddings) early. Keep the embedding model configurable per workspace profile. Swap to better models as they release. |
| T4 | **LLM context window overflow** — As session state payloads grow, combined context may exceed model limits | High | Medium | Implement smart truncation strategy (Phase 2). Always keep session state + user query within budget. Summarize old context. Switch to larger-context models when available. |
| T5 | **SQLite concurrent write contention** — Multiple processes (Rust + Python sidecar) writing to SQLite simultaneously | Medium | High | Enable WAL mode on initialization. Coordinate writes: Rust owns SQLite writes, Python sidecar writes via HTTP request to Rust (or dedicated write endpoints). |
| T6 | **Python sidecar startup latency** — Loading sentence-transformers model takes 2-3 seconds, delaying AI features | High | Low | Show "AI features loading" indicator in UI. Pre-load model in background. Consider lazy loading (only load embedding model when first needed). |
| T7 | **LanceDB schema migration** — Changing the embedding schema requires re-indexing all files | Low | Medium | Schema changes trigger automatic re-indexing in background. For large codebases, show progress bar and allow partial functionality during re-index. |
| T8 | **Tauri IPC overhead for streaming** — Streaming LLM responses through Rust IPC to frontend may add latency | Low | Medium | Use Tauri's event channels for streaming (designed for this use case). Benchmark token-by-token latency. If problematic, consider a direct WebSocket from frontend to Python sidecar for streaming only. |

### Platform Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|-----------|
| P1 | **Tauri v2 breaking changes** — Tauri is actively developed; minor versions may introduce breaking changes | Low | Medium | Pin Tauri version. Test before upgrading. Follow Tauri release notes. |
| P2 | **SolidJS ecosystem gaps** — Fewer third-party component libraries than React | Medium | Low | Use Kobalte for accessible primitives. Build custom components as needed. The solo-developer context means fewer dependencies anyway. |
| P3 | **litellm provider API changes** — LLM provider APIs change frequently; litellm may lag | Medium | Low | Pin litellm version. For critical providers (Ollama, Claude), maintain fallback direct API calls. |
| P4 | **Cross-platform differences** — macOS, Linux, Windows may behave differently for file watching, PTY management, and keychain access | Medium | Medium | Develop on your primary OS first. Test on secondary platforms before release. Use Tauri's cross-platform plugins where available. |

### Project Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|-----------|
| R1 | **Scope creep within phases** — Each phase has enough tasks to expand indefinitely | High | Medium | Strict "definition of done" per phase. When a phase is done, move to the next. Nice-to-haves go in the phase's "open questions" for later. |
| R2 | **Motivation decay on infrastructure phases** — Phase 0 (skeleton) is necessary but not exciting | Medium | Medium | Phase 0 is deliberately small. Get through it fast and start using the context engine (Phase 1) immediately — that's where the reward is. |
| R3 | **"Build everything from scratch" temptation** — Spending time building a feature that a library already does well | Medium | Medium | Before building, search for existing libraries. If a library does 80% of what's needed, use it and customize the remaining 20%. |
| R4 | **Testing debt accumulation** — Skipping tests early, making later changes risky | Medium | High | Each phase includes a testing strategy. Write tests for critical paths (session state capture, entity linking) even if you skip tests for UI. |

---

## Risk Response Status

| Status | Meaning |
|--------|---------|
| **Open** | Risk is identified, mitigation planned but not yet implemented |
| **Mitigated** | Mitigation is in place, risk reduced to acceptable level |
| **Materialized** | Risk has occurred, response is in progress |
| **Closed** | Risk is no longer relevant or fully addressed |

*All risks above are currently **Open**. Update status as the project progresses.*

---

## Open Questions

- Should we add a "technology watch" list for emerging tools that could impact the stack? (e.g., a new Rust-native embedding library, a better vector store)
- At what point does a materialized risk warrant a scope change vs. a workaround?
- Should we track "positive risks" (opportunities) — e.g., a new Tauri plugin that simplifies something we planned to build manually?
