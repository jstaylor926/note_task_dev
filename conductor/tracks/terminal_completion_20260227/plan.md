# Implementation Plan: Phase 3 Terminal Completion

## Phase 1: Critical Fixes (Tier 1) [checkpoint: e237ea0]
- [x] **Task: Fix `take_writer()` in Rust** 88b557c
    - [x] Update `PtySession` struct in `pty.rs` to store the writer.
    - [x] Call `take_writer()` once during session creation.
    - [x] Use the stored writer in `PtyManager::write()`.
- [x] **Task: Retrieve real exit codes** 88b557c
    - [x] Update `PtySession` reader thread or `kill()` method to wait on the child process.
    - [x] Populate `exit_code` in the `pty:exit` payload.
- [x] **Task: Support initial PTY size** 88b557c
    - [x] Update `pty_create` IPC command to accept `cols` and `rows`.
    - [x] Pass these dimensions to the PTY builder in `pty.rs`.
    - [x] Update frontend `ptyCreate` wrapper and `XtermInstance` to pass current dimensions.
- [x] **Task: Conductor - User Manual Verification 'Phase 1: Critical Fixes' (Protocol in workflow.md)** e237ea0

## Phase 2: Infrastructure & Plumbing (Tier 2) [checkpoint: 6d6c1d2]
- [x] **Task: Wire Command Persistence to SQLite** bd889f8
    - [x] Listen for `terminal:command-end` events in `main.rs`.
    - [x] Call `db::insert_terminal_command()` to persist the command.
    - [x] Remove `#[allow(dead_code)]` from `db.rs` for the insertion function.
- [x] **Task: Debounce Terminal Resize** 642bb13
    - [x] Add 100ms debounce to the `ResizeObserver` callback in `XtermInstance.tsx`.
- [x] **Task: Persist Split Container Sizes** a624bc5
    - [x] Update `SplitContainer.tsx` to write resized dimensions back to the `terminalState` store.
    - [x] Ensure `localSizes` re-initializes from the store correctly.
- [x] **Task: Implement OSC Buffer Limit** 5d0bb8e
    - [x] Add a 64KB constant limit to `osc_parser.rs`.
    - [x] If the buffer exceeds this limit, discard and reset to `State::Normal`.
- [x] **Task: Handle `ptyWrite` Errors** c4d84c9
    - [x] Add `.catch()` to the `ptyWrite` call in `XtermInstance.tsx`.
    - [x] Show a toast or console error for failed writes.
- [x] **Task: Wire `onExit` Prop** cf415d3
    - [x] Ensure `PaneContainer` passes the `onExit` callback to `XtermInstance`.
- [x] **Task: Conductor - User Manual Verification 'Phase 2: Infrastructure & Plumbing' (Protocol in workflow.md)** 6d6c1d2

## Phase 3: Intelligence Layer (Tier 3) [checkpoint: 44bed55]
- [x] **Task: Capture and Store Terminal Output** d65994f
    - [x] Update `PtyManager` or the reader thread to buffer output between `CommandStart` and `CommandEnd` events.
    - [x] Store this output in the SQLite `terminal_commands` table.
- [x] **Task: Implement Output Embedding** b60fae4
    - [x] Add logic to check if captured output is > 500 characters.
    - [x] If so, chunk and send to the sidecar's `/ingest` endpoint.
- [x] **Task: Add Pipeline Monitoring** fb90ee8
    - [x] Implement a basic heuristic to detect commands running > 30 seconds.
    - [x] Emit a frontend event/notification when a long-running command completes or fails.
- [x] **Task: Conductor - User Manual Verification 'Phase 3: Intelligence Layer' (Protocol in workflow.md)** 44bed55

## Phase 4: Testing & Polish (Tier 4)
- [~] **Task: Add Behavioral Tests for TerminalPanel**
    - [ ] Write tests in `TerminalPanel.test.tsx` for tab creation, splitting, and keyboard shortcuts.
- [ ] **Task: Implement Fish Shell Support**
    - [ ] Add Fish-specific shell hooks in `shell_hooks.rs`.
- [ ] **Task: Validate CWD Path Security**
    - [ ] Update `pty_commands.rs` to validate that `cwd` exists and is within a workspace-scoped directory.
- [ ] **Task: Conductor - User Manual Verification 'Phase 4: Testing & Polish' (Protocol in workflow.md)**
