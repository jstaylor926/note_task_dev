# Specification: Phase 3 Terminal Completion

## Overview
This track completes the Terminal module (Phase 3) by addressing critical bugs, wiring existing infrastructure for command persistence, implementing the intelligence layer (capture/embedding/monitoring), and adding comprehensive tests.

## Functional Requirements

### 1. Critical Bug Fixes (Tier 1)
- **F1: Fix `take_writer()`:** Store the writer in `PtySession` at creation time to allow more than one keystroke.
- **F2: Real Exit Codes:** Retrieve actual process exit status using `child.wait()` and emit it via the `pty:exit` event.
- **F3: Initial Size:** Accept `cols` and `rows` in `pty_create` and initialize the PTY with these dimensions.

### 2. Infrastructure & Plumbing (Tier 2)
- **W1: SQLite Command Persistence:** Automatically save shell commands to the database when they complete (listening for `terminal:command-end`).
- **W2: Debounce Resize:** Add a 100ms debounce to the `ResizeObserver` to prevent IPC floods.
- **W3: Split State Persistence:** Write split pane sizes back to the store so they persist across tab/pane switches.
- **W4: Write Error Handling:** Catch `ptyWrite` errors and provide visual feedback to the user.
- **W5: Exit Awareness:** Wire the `onExit` prop for better pane management when a process dies.
- **W6: OSC Buffer Limit:** Implement a 64KB limit for the OSC parser buffer to prevent memory exhaustion.

### 3. Intelligence Layer (Tier 3)
- **I1: Output Capture & Persistence:** Capture full terminal output between `CommandStart` and `CommandEnd` events and persist it in SQLite.
- **I2: Output Embedding:** If output is significant (>500 chars), chunk and embed it into LanceDB via the sidecar `/ingest` endpoint.
- **I4: Pipeline Monitoring:** Detect and notify users of long-running commands (>30s).
- **I2 & I3 (LLM Agents):** Display suggestions as **floating elements** near the error/cursor. (Note: These depend on Phase 2's LLM router).

### 4. Testing & Polish (Tier 4)
- **T1: Behavioral Tests:** Add SolidJS tests for `TerminalPanel` (tab creation, keyboard shortcuts, split operations).
- **T3: Shell Support:** Add Fish shell hooks to the existing zsh/bash support.
- **S1: Security:** Validate that `cwd` in `pty_create` is an existing directory within the workspace scope.

## Non-Functional Requirements
- **Performance:** Debouncing and efficient serialization to maintain low latency.
- **Security:** Path validation for PTY creation.
- **Reliability:** Comprehensive unit and behavioral test coverage.

## Acceptance Criteria
- [ ] Terminal supports continuous input (more than one keystroke).
- [ ] Terminal shows the correct exit code when a process exits.
- [ ] Shell commands are automatically persisted to SQLite.
- [ ] Terminal output is optionally embedded for semantic search.
- [ ] UI remains responsive during resize and high-throughput output.
- [ ] Split pane sizes are remembered when switching views.

## Out of Scope
- Full LLM agent implementation for error resolution (deferred to post-Phase 2).
- Native binary channel optimization for PTY output (deferred).
