# 90-Day Production + AI Beta Specification

## 1. Goal
Ship a private beta of Cortex in 90 days with strong reliability, security hardening, and high-quality session handoff workflows as the first production AI feature.

## 2. Scope
In scope:
- Desktop app reliability and recoverability.
- Release/build supportability.
- Security hardening for local-first + optional remote access.
- Retrieval quality, LLM reliability, and observability.
- Controlled beta rollout readiness.

Out of scope in this window:
- Remote API enabled by default.
- Full inline code-editing copilot.
- Multi-device sync and plugin ecosystem.

## 3. Non-Negotiable Priorities
1. Platform stability and hardening first.
2. Reproducible, supportable release path second.
3. Session handoff quality before broader AI surfaces.
4. Terminal copilot remains feature-flagged until post-gate quality.

## 4. API and Contract Direction
- Rust commands:
  - `session_capture_v2(input)` (legacy wrapper remains)
  - `hybrid_search(query, options)` (legacy semantic wrapper remains)
  - `chat_send_stream(request)`
  - `model_list()`
  - `model_set_profile_default(profile_id, model_id)`
- Sidecar endpoints:
  - `POST /api/v1/rag/query`
  - `POST /api/v1/session/synthesis` (strict schema shape + provenance)
  - `GET /api/v1/models`

## 5. Security and Reliability Baseline
- File operations constrained to allowed workspace roots.
- Sidecar filters sanitized and rejected on unsafe input.
- Sidecar calls bound by timeout/retry/circuit-breaker policy.
- Remote access remains explicit opt-in and audit-logged.
- CORS allowlist defaults replace permissive wildcard behavior.

## 6. Quality Gates
- CI required checks all green:
  - frontend tests
  - Rust tests + clippy
  - sidecar tests + ruff + mypy
- AI quality acceptance goals (target):
  - retrieval nDCG@10 >= 0.75
  - session summary actionability median >= 4/5
  - fallback success rate >= 99%
- Performance targets (target):
  - p95 hybrid search <= 400 ms
  - p95 session synthesis <= 6s local, <= 3s cloud opt-in
