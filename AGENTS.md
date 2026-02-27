# Repository Guidelines

## Project Structure & Module Organization
- `src/`: SolidJS frontend (components in `src/components`, layouts in `src/layouts`, shared logic in `src/lib`, tests in `src/**/__tests__`).
- `src-tauri/`: Rust backend for Tauri (commands, IPC, database, file watcher).
- `sidecar/`: Python FastAPI + LanceDB service (tests in `sidecar/tests`).
- `project_strategy/`, `docs/`, `conductor/`: architecture plans, project status, and workflow artifacts.

## Build, Test, and Development Commands
- `pnpm dev`: run the Vite dev server for the frontend.
- `pnpm tauri dev`: run the full desktop app (frontend + Rust + sidecar).
- `pnpm build` / `pnpm tauri build`: production builds.
- `pnpm test` or `pnpm test:watch`: run Vitest once or in watch mode.
- `cd src-tauri && cargo test`: Rust backend tests.
- `cd sidecar && uv sync` (first-time deps), then `cd sidecar && uv run pytest`.

## Coding Style & Naming Conventions
- TypeScript/TSX uses SolidJS primitives; prefer signals and stores over React hooks.
- Indentation: 2 spaces in TS/TSX, 4 spaces in Rust/Python; match surrounding files.
- Components use `PascalCase.tsx` (e.g., `TerminalPanel.tsx`); tests use `*.test.ts(x)` under `__tests__/`.
- No lint/format tooling is configured; avoid reformatting unrelated code.

## Testing Guidelines
- Frontend: Vitest + `@solidjs/testing-library` with jsdom; setup in `src/test/setup.ts`.
- Backend: `cargo test` for Rust, `pytest` for the sidecar.
- For faster sidecar tests, set `CORTEX_TEST_MODE=1` to skip ML model loading.
- Conductor workflow targets TDD and >80% coverage when applicable.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits (e.g., `feat(terminal): add search`, `fix(sidecar): handle retries`).
- PRs should include a concise description, linked issues when relevant, test commands run, and screenshots for UI changes.

## Additional References
- `CLAUDE.md` has detailed command and architecture notes.
- `project_strategy/` contains the long-form design and roadmap.
