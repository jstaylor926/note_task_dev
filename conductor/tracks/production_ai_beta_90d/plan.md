# 90-Day Production + AI Beta Plan

## Phase 1: Stabilization and Truth Alignment
- [x] Restore green frontend baseline and resolve failing tests.
- [x] Add deterministic quality gates:
  - `pnpm test`
  - `cd src-tauri && cargo test`
  - `cd sidecar && CORTEX_TEST_MODE=1 uv run pytest`
- [x] Add CI workflow for frontend/Rust/sidecar tests plus static checks.
- [x] Add static checks:
  - `pnpm typecheck`
  - `cargo clippy --all-targets -- -D warnings`
  - `ruff` + `mypy` sidecar checks.
- [x] Align core docs (`README.md`, `docs/PROJECT_STATE.md`) with verified current state.

## Phase 2: Production Hardening (Security + Reliability)
- [x] Mitigate sidecar filter-injection risk on `/search` and `/embeddings` delete.
- [x] Add Rust->sidecar timeout/retry and circuit-breaker request policy.
- [x] Attempt LanceDB ANN index creation during sidecar startup.
- [x] Fix TSX chunking fallback gap in `chunking.py`.
- [x] Fix indexing counter semantics and branch freshness handling.
- [x] Restrict file operations to active workspace boundaries.
- [x] Keep remote API feature-flagged and default-off.
- [x] Tighten remote CORS defaults to allowlist behavior.
- [x] Add remote security audit-log inserts (enable/port/revoke/pairing events).
- [~] Expand structured IPC error taxonomy across all command surfaces.

## Phase 3: Release Engineering and Operability
- [x] Add production launcher path for bundled sidecar executable with dev-mode `uv run` fallback.
- [~] Build sidecar binary artifact per OS in CI and package in release jobs.
- [~] Signed updater/release pipeline for Tauri artifacts.
- [x] Startup diagnostics panel and persistent log export UI.
- [~] SQLite schema migration versioning for new production tables.

## Phase 4: AI/ML/LLM Quality (Session Handoff First)
- [x] Add `session_capture_v2` command and retain legacy compatibility wrapper.
- [x] Add sidecar session synthesis schema with confidence/provenance/source fields and deterministic fallback.
- [x] Add `hybrid_search` and `/api/v1/rag/query` route with optional rerank mode.
- [x] Add `model_list` + profile default-model update command.
- [~] Add robust streaming chat transport (Rust now consumes sidecar SSE with non-stream fallback; next step is true incremental UI streaming events).
- [~] Add retrieval eval harness and golden quality benchmark automation.

## Phase 5: Beta Readiness
- [~] Define release checklist and cut controlled `beta` channel build (checklist drafted in `release_checklist_beta.md`; build cut pending).
- [~] Private beta onboarding workflow (20-100 users) drafted in `private_beta_onboarding.md`; execution pending.
- [x] In-app feedback capture tied to trace IDs (SearchPanel now submits per-result feedback with search trace IDs).
- [~] Two-week stabilization sprint process for crashers and AI regressions drafted in `stabilization_sprint_playbook.md`; execution pending.

## Next Pending Items (Ordered Queue)
1. [ ] Phase 4: complete true incremental chat streaming in the UI via event-driven token updates.
2. [ ] Phase 4: implement retrieval/session quality evaluation harness automation and CI reporting.
3. [ ] Phase 3: finish sidecar binary packaging in release jobs (not artifact-only CI).
4. [ ] Phase 3: finalize signed updater/release pipeline for all supported platforms.
5. [ ] Phase 3: complete migration versioning hardening with rollback-safe startup checks.
6. [ ] Phase 2: finish structured IPC/sidecar error taxonomy coverage across remaining command surfaces.
7. [ ] Phase 5: execute `release_checklist_beta.md` and cut first controlled `beta` channel build.
8. [ ] Phase 5: execute `private_beta_onboarding.md` and onboard first cohort.
9. [ ] Phase 5: execute `stabilization_sprint_playbook.md` for the first 2-week beta stabilization window.
