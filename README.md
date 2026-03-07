# Cortex: Local-First AI Workspace

Cortex is a Tauri desktop app with:
- SolidJS frontend (`src/`)
- Rust backend (`src-tauri/`)
- Python FastAPI + LanceDB sidecar (`sidecar/`)

## Current State (Verified 2026-03-07)

- Frontend tests: passing (`216/216`)
- Rust tests: passing (`128/128`)
- Sidecar tests: passing (`88/88`)
- CI workflow runs required quality gates on PRs and pushes to `main`.

## Architecture Notes

- Rust is the control plane for state, indexing, IPC, and sidecar lifecycle.
- Sidecar serves embedding, retrieval, chat, and session synthesis endpoints.
- Sidecar launch behavior:
  - Dev builds: `uv run ... python -m cortex_sidecar.main`
  - Production builds: prefers bundled sidecar executable resource (`sidecar/bin/cortex-sidecar[.exe]`), with fallback to `uv run` if unavailable.

## Quality Gates

Run these before merge:

```bash
pnpm test
cd src-tauri && cargo test
cd sidecar && CORTEX_TEST_MODE=1 uv run pytest
```

Static checks:

```bash
pnpm typecheck
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd sidecar && uv run ruff check cortex_sidecar tests --select E9,F63,F7,F82
cd sidecar && uv run mypy cortex_sidecar --ignore-missing-imports
```

Single command aggregate:

```bash
pnpm check
```

## Local Development

Install dependencies:

```bash
pnpm install
cd sidecar && uv sync --extra dev
```

Run:

```bash
pnpm tauri dev
```

## Build

```bash
pnpm build
pnpm tauri build
```

Build a standalone sidecar binary artifact (for production packaging):

```bash
python sidecar/scripts/build_sidecar_binary.py
```

## References

- [AGENTS.md](./AGENTS.md)
- [CLAUDE.md](./CLAUDE.md)
- [docs/PROJECT_STATE.md](./docs/PROJECT_STATE.md)
