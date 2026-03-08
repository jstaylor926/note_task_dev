# Beta Release Checklist

> Track: `production_ai_beta_90d`  
> Goal: Cut a controlled `beta` channel release with reproducible artifacts and rollback readiness.

## 1. Preconditions
- [ ] `main` is green on required CI checks (frontend, Rust, sidecar, lint/static checks).
- [ ] No open P0/P1 issues tagged for beta cut.
- [ ] Feature flags verified:
  - [ ] `ai.session_handoff_v2` default ON for beta.
  - [ ] `remote_api_enabled` default OFF.
  - [ ] `ai.terminal_copilot` default OFF.
- [ ] Release owner + fallback owner assigned for the cut window.

## 2. Version and Freeze
- [ ] Pick beta version tag (example: `v0.1.0-beta.1`).
- [ ] Freeze merge window for release branch.
- [ ] Confirm release notes draft includes:
  - [ ] Known issues.
  - [ ] Breaking changes.
  - [ ] Rollback procedure and contact channel.

## 3. Local Verification
- [ ] Run full gate:
  - [ ] `pnpm check`
  - [ ] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
  - [ ] `cd sidecar && uv run ruff check cortex_sidecar tests --select E9,F63,F7,F82`
  - [ ] `cd sidecar && uv run mypy cortex_sidecar --ignore-missing-imports`
- [ ] Build app artifacts:
  - [ ] `pnpm tauri build`
- [ ] Verify clean-machine startup behavior:
  - [ ] Sidecar bundled binary launches (no system Python/uv dependency).
  - [ ] Startup diagnostics panel loads.
  - [ ] Diagnostic export writes file successfully.

## 4. CI Release Artifacts
- [ ] Produce per-OS sidecar binary artifacts in CI.
- [ ] Produce signed Tauri artifacts for target platforms.
- [ ] Attach checksums/SBOM metadata to release artifacts.
- [ ] Validate updater metadata and signature verification.

## 5. Beta Channel Cut
- [ ] Publish artifacts to `beta` channel only.
- [ ] Smoke test installation + first run on each target OS.
- [ ] Confirm remote API remains OFF by default after install/update.
- [ ] Confirm app can recover from sidecar restart and still pass health checks.

## 6. Rollback Readiness
- [ ] Previous stable artifact retained and verified installable.
- [ ] Rollback command/playbook rehearsed by on-call owner.
- [ ] Escalation contacts documented in release thread.

## 7. Post-Cut Monitoring (first 48h)
- [ ] Crash-free session rate monitored daily.
- [ ] Track p95 search and session synthesis latency against targets.
- [ ] Triage all new regressions with severity labels.
- [ ] Publish daily beta status note to team channel.
