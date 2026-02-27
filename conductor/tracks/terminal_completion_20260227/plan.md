# Implementation Plan: Phase 3 Terminal Completion

## Phase 1: Critical Fixes (Tier 1)
- [ ] **Task: Fix `take_writer()` in Rust**
    - [ ] Update `PtySession` struct in `pty.rs` to store the writer.
    - [ ] Call `take_writer()` once during session creation.
    - [ ] Use the stored writer in `PtyManager::write()`.
- [ ] **Task: Retrieve real exit codes**
    - [ ] Update `PtySession` reader thread or `kill()` method to wait on the child process.
    - [ ] Populate `exit_code` in the `pty:exit` payload.
- [ ] **Task: Support initial PTY size**
    - [ ] Update `pty_create` IPC command to accept `cols` and `rows`.
    - [ ] Pass these dimensions to the PTY builder in `pty.rs`.
    - [ ] Update frontend `ptyCreate` wrapper and `XtermInstance` to pass current dimensions.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1: Critical Fixes' (Protocol in workflow.md)**

## Phase 2: Infrastructure & Plumbing (Tier 2)
- [ ] **Task: Wire Command Persistence to SQLite**
    - [ ] Listen for `terminal:command-end` events in `main.rs`.
    - [ ] Call `db::insert_terminal_command()` to persist the command.
    - [ ] Remove `#[allow(dead_code)]` from `db.rs` for the insertion function.
- [ ] **Task: Debounce Terminal Resize**
    - [ ] Add 100ms debounce to the `ResizeObserver` callback in `XtermInstance.tsx`.
- [ ] **Task: Persist Split Container Sizes**
    - [ ] Update `SplitContainer.tsx` to write resized dimensions back to the `terminalState` store.
    - [ ] Ensure `localSizes` re-initializes from the store correctly.
- [ ] **Task: Implement OSC Buffer Limit**
    - [ ] Add a 64KB constant limit to `osc_parser.rs`.
    - [ ] If the buffer exceeds this limit, discard and reset to `State::Normal`.
- [ ] **Task: Handle `ptyWrite` Errors**
    - [ ] Add `.catch()` to the `ptyWrite` call in `XtermInstance.tsx`.
    - [ ] Show a toast or console error for failed writes.
- [ ] **Task: Wire `onExit` Prop**
    - [ ] Ensure `PaneContainer` passes the `onExit` callback to `XtermInstance`.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2: Infrastructure & Plumbing' (Protocol in workflow.md)**

## Phase 3: Intelligence Layer (Tier 3)
- [ ] **Task: Capture and Store Terminal Output**
    - [ ] Update `PtyManager` or the reader thread to buffer output between `CommandStart` and `CommandEnd` events.
    - [ ] Store this output in the SQLite `terminal_commands` table.
- [ ] **Task: Implement Output Embedding**
    - [ ] Add logic to check if captured output is > 500 characters.
    - [ ] If so, chunk and send to the sidecar's `/ingest` endpoint.
- [ ] **Task: Add Pipeline Monitoring**
    - [ ] Implement a basic heuristic to detect commands running > 30 seconds.
    - [ ] Emit a frontend event/notification when a long-running command completes or fails.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3: Intelligence Layer' (Protocol in workflow.md)**

## Phase 4: Testing & Polish (Tier 4)
- [ ] **Task: Add Behavioral Tests for TerminalPanel**
    - [ ] Write tests in `TerminalPanel.test.tsx` for tab creation, splitting, and keyboard shortcuts.
- [ ] **Task: Implement Fish Shell Support**
    - [ ] Add Fish-specific shell hooks in `shell_hooks.rs`.
- [ ] **Task: Validate CWD Path Security**
    - [ ] Update `pty_commands.rs` to validate that `cwd` exists and is within a workspace-scoped directory.
- [ ] **Task: Conductor - User Manual Verification 'Phase 4: Testing & Polish' (Protocol in workflow.md)**
