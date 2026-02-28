# Phase 3 Terminal: Code Review & Completion Requirements

> **Date:** 2026-02-27
> **Scope:** Every terminal-related file across all three process layers
> **Files reviewed:** `pty.rs`, `pty_commands.rs`, `osc_parser.rs`, `shell_hooks.rs`, `events.rs`, `main.rs`, `db.rs` (terminal section), `TerminalPanel.tsx`, `XtermInstance.tsx`, `PaneContainer.tsx`, `SplitContainer.tsx`, `terminalState.ts`, `pty.ts`, `TerminalPanel.test.tsx`, `setup.ts`

---

## Review Summary

| Dimension | Rating | Summary |
|-----------|--------|---------|
| **Security** | **Medium Risk** | No input sanitization on shell command injection via CWD param; OSC parser has unbounded buffer growth |
| **Performance** | **Acceptable** | `take_writer()` per-write is the critical path issue; ResizeObserver fires too frequently; base64 overhead is acceptable for now |
| **Correctness** | **3 Critical Bugs** | `take_writer()` breaks after first write, exit codes always None, split resize state is ephemeral |
| **Maintainability** | **Good Foundation** | Clean separation of concerns, well-typed IPC contract, tree model is elegant; test coverage is thin |

---

## 1. Security

### S1 — CWD Path Not Validated (Medium)
**File:** `pty_commands.rs:8-21`

`pty_create` accepts an arbitrary `cwd: Option<String>` from the frontend and passes it directly to the PTY command builder. There is no validation that the path exists, is a directory, or is within any allowed scope. While this is an IPC call (not a web-facing API), a compromised or buggy frontend could spawn shells in sensitive directories.

**Recommendation:** Validate that `cwd` is an existing directory and optionally restrict it to watched workspace directories.

### S2 — OSC Buffer Unbounded Growth (Low)
**File:** `osc_parser.rs:36, osc_buf`

If a malformed or unterminated OSC sequence is received (e.g., `ESC ]` followed by megabytes of non-BEL data), `osc_buf` grows without limit. A malicious program running in the terminal could cause memory exhaustion.

**Recommendation:** Add a max buffer size (e.g., 64KB). If exceeded, discard the buffer and reset to `State::Normal`.

### S3 — Shell Hook Injection Surface (Low)
**File:** `shell_hooks.rs:29-61`

The zsh and bash hooks use `$1` and `$BASH_COMMAND` in printf statements. While these are standard shell variables (not user-controlled in the injection sense), a command containing `%s`-like format specifiers could theoretically cause issues with `printf`. In practice, `printf '\e]633;E;%s\a' "$1"` is safe in zsh/bash because `$1` is correctly double-quoted.

**Status:** Acceptable as-is. No action needed.

---

## 2. Performance

### P1 — `take_writer()` Called Per Write (Critical)
**File:** `pty.rs:200-217`

This is the most critical issue in the terminal layer. `PtyManager::write()` calls `session.master.take_writer()` on every keystroke. The `portable-pty` documentation states `take_writer()` can only be called once per master handle — it transfers ownership of the writer. After the first successful write, subsequent calls will fail because the writer has already been taken.

**Impact:** The terminal is effectively **write-once** per session. After the first key the user presses, every subsequent keystroke will fail silently (the error propagates to the frontend but may not be visibly handled).

**Fix:** Store the writer in `PtySession` at creation time. Change the struct to:

```rust
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn std::io::Write + Send>,  // take_writer() once at creation
    child: Box<dyn Child + Send + Sync>,
    _reader_handle: JoinHandle<()>,
    shutdown_tx: Option<oneshot::Sender<()>>,
}
```

And in `create_session`, call `take_writer()` once and store it. In `write()`, use `session.writer.write_all(data)`.

### P2 — ResizeObserver Fires Too Frequently (Medium)
**File:** `XtermInstance.tsx:103-108`

The `ResizeObserver` calls `fitAddon.fit()` and `ptyResize()` on every observation callback. During window resize drags, this fires dozens of times per second, each triggering:
1. xterm.js `fit()` computation
2. A Tauri IPC `invoke('pty_resize', ...)` call
3. A Rust `master.resize()` PTY syscall

**Recommendation:** Debounce the ResizeObserver callback by 100-150ms. Only the final size matters.

### P3 — Base64 Encoding Overhead (Low/Acceptable)
**File:** `pty.rs:164-171`, `XtermInstance.tsx:79-89`

Every byte of PTY output is base64-encoded in Rust and decoded in the frontend. This adds ~33% bandwidth overhead. For typical terminal usage this is fine; for high-throughput scenarios (e.g., `cat` on a large file), it could cause lag.

**Status:** Acceptable for now. Binary channels in Tauri v2 would eliminate this but aren't critical path.

### P4 — Mutex Contention on `pty_manager` (Low)
**File:** `pty_commands.rs:19, 34, 45, 54`

Every `pty_write`, `pty_resize`, `pty_create`, and `pty_kill` locks the same `Mutex<PtyManager>`. Since `pty_write` is called on every keystroke, and the mutex holds for the duration of the write syscall, this could cause contention if the user types rapidly while a resize is happening.

**Recommendation:** Consider per-session locking (e.g., a `RwLock<HashMap<String, Mutex<PtySession>>>`) to avoid cross-session contention. Low priority — unlikely to be noticeable with single-user usage.

---

## 3. Correctness

### C1 — `take_writer()` Breaks After First Write (Critical) !! REPEAT OF P1 !!
**File:** `pty.rs:206-209`

See P1 above. This is the single most critical bug — the terminal is non-functional after the first keystroke.

### C2 — Exit Code Always `None` (High)
**File:** `pty.rs:107-116`

When the PTY reader gets EOF (process exited), the exit payload is emitted with `exit_code: None`. The child's actual exit status is never retrieved via `child.wait()`.

**Impact:** The frontend always shows `[Process exited]` without a meaningful exit code. The `pty:exit` event's `exit_code` field is effectively useless.

**Fix:** In the `kill()` method (or better, in the reader thread after EOF), call `session.child.wait()` to get the real exit status. This requires the child to be accessible from the reader thread, or moving the wait to the cleanup path.

### C3 — PTY Initial Size Hardcoded (Medium)
**File:** `pty.rs:56-61`

The PTY is always created at 24x80 regardless of the actual container size. The frontend sends a `pty_resize` immediately after creation (`XtermInstance.tsx:72`), but there's a brief window where the shell initializes at 24x80 and may emit TIOCGWINSZ-dependent output (e.g., prompts with line wrapping) that won't match the actual terminal size.

**Fix:** Accept `cols` and `rows` parameters in `pty_create` and pass them to `PtySize` at creation. The frontend already has `terminal.cols` and `terminal.rows` available.

### C4 — Split Container Resize State is Ephemeral (Medium)
**File:** `SplitContainer.tsx:14`

`localSizes` is initialized from `props.sizes` but changes via dragging are stored only in the local signal. When the user switches tabs and returns, or when the SolidJS store updates, `localSizes` reinitializes from `props.sizes` (which is always `[50, 50]` from `splitNode`), losing the user's resize.

**Fix:** Write `localSizes` back to the store on drag end, or derive sizes reactively from the store.

### C5 — `onExit` Prop Not Wired (Low)
**File:** `PaneContainer.tsx:26-29`, `XtermInstance.tsx:13`

`XtermInstance` accepts an `onExit` prop, but `PaneContainer` never passes it. When a PTY process exits, the pane shows the exit message but has no auto-close or visual indicator behavior.

### C6 — `ptyWrite` Errors Silently Swallowed (Medium)
**File:** `XtermInstance.tsx:79-82`

```typescript
terminal.onData((data) => {
  const encoded = btoa(data);
  ptyWrite(props.sessionId, encoded);
});
```

The `ptyWrite` promise is never awaited and has no `.catch()`. If writes fail (which they will after the first write due to C1), errors are silently lost.

**Fix:** Add `.catch()` to handle write failures — at minimum log them, ideally show a visual indicator.

### C7 — `shutdown_rx.try_recv()` Timing Issue (Low)
**File:** `pty.rs:102`

The reader thread checks `shutdown_rx.try_recv()` only before each `reader.read()` call. Since `read()` is blocking, if the PTY produces continuous output, the shutdown signal won't be processed until the next read returns. This means `kill()` may not stop the reader thread promptly.

**Status:** Acceptable — `reader.read()` will eventually return with an error or EOF when the child process is killed, which triggers the break. The shutdown channel is a best-effort optimization.

### C8 — `terminal:command-start` and `terminal:command-end` Events Not Consumed (Medium)
**File:** `events.rs:10-11`, `pty.rs:122-158`

These events are emitted but no frontend component listens for them. The shell hooks work (OSC 633 parsing is solid), the Rust layer correctly parses and emits events, but the data goes nowhere.

**Impact:** Command capture — the entire intelligence layer foundation — is working but disconnected. No persistence, no UI feedback.

---

## 4. Maintainability

### M1 — Well-Structured IPC Contract (Positive)
The `events.rs` type definitions, `pty.ts` frontend wrapper, and `pty_commands.rs` command handlers form a clean, type-safe IPC boundary. Each layer has clear responsibilities.

### M2 — Terminal State Tree Model is Elegant (Positive)
The recursive `PaneNode` type (pane | split) with `splitNode` and `removeNode` operations is a clean, well-tested data structure. The 9 tests in `terminalState.ts` cover the important operations.

### M3 — OSC Parser is Thoroughly Tested (Positive)
14 tests covering normal passthrough, all event types, cross-chunk splitting, multiple terminators (BEL and ST), and edge cases. This is the best-tested module in the terminal layer.

### M4 — Terminal Tests are Structural Only (Weak)
**File:** `TerminalPanel.test.tsx`

Only 3 tests, all purely structural: "renders a div", "renders + button", "has full height". Zero behavioral tests — no tab creation, no split pane, no keyboard shortcut handling, no IPC interaction.

**Recommendation:** Add tests for:
- Tab creation on mount (verify `invoke('pty_create')` called)
- Cmd+T creates new tab
- Cmd+W closes active pane
- Cmd+D splits pane
- Tab switching changes active content

### M5 — `#[allow(dead_code)]` on `insert_terminal_command` (Debt)
**File:** `db.rs:310`

The annotation acknowledges the function is unused. It's fully implemented and tested (the test at line 465 passes), but it's never called from the application code path. This is the missing link between command capture events and persistence.

### M6 — Hardcoded Theme (Minor)
**File:** `XtermInstance.tsx:34-55`

Tokyo Night Dark is hardcoded. The project strategy calls for theme configurability. This is fine for now but should eventually read from CSS variables or a theme config.

### M7 — Module ID Counter is Global Mutable State
**File:** `terminalState.ts:25-31`

`nextId` is a module-level `let` that monotonically increases. `resetIdCounter()` exists for tests but in production the counter never resets. This means IDs like `pane-1`, `session-2` grow across the app lifetime. Not a bug, but deterministic IDs would be cleaner (e.g., UUIDs or a store-scoped counter).

---

## Phase 3 Completion Requirements

Based on the module spec (`project_strategy/modules/07_module_terminal.md`) and the current implementation, here is what remains to complete Phase 3:

### Tier 1: Critical Bug Fixes (Must Do Before Anything Else)

| # | Task | Files | Effort |
|---|------|-------|--------|
| **F1** | **Fix `take_writer()` — store writer in PtySession** | `pty.rs` | 30 min |
| **F2** | **Retrieve real exit codes via `child.wait()`** | `pty.rs` | 1 hr |
| **F3** | **Accept initial size in `pty_create`** | `pty.rs`, `pty_commands.rs`, `pty.ts`, `XtermInstance.tsx` | 30 min |

### Tier 2: Wire Existing Infrastructure (Low Effort, High Value)

| # | Task | Files | Effort |
|---|------|-------|--------|
| **W1** | **Persist commands to SQLite** — Listen for `terminal:command-end` events in Rust and call `db::insert_terminal_command()`. The function already exists and is tested | `main.rs` or new `terminal_persistence.rs`, `pty.rs` | 2 hr |
| **W2** | **Debounce ResizeObserver** — Add 100ms debounce to avoid IPC flood | `XtermInstance.tsx` | 15 min |
| **W3** | **Write split sizes back to store** — Persist drag positions across tab switches | `SplitContainer.tsx`, `terminalState.ts` | 1 hr |
| **W4** | **Handle `ptyWrite` errors** — Add `.catch()` with visual feedback | `XtermInstance.tsx` | 30 min |
| **W5** | **Wire `onExit` for auto-close or visual indicator** | `PaneContainer.tsx` | 1 hr |
| **W6** | **Add OSC buffer size limit** | `osc_parser.rs` | 30 min |

### Tier 3: Intelligence Layer (Phase 3 Spec — Not Started)

These are the features from the module spec that haven't been built:

| # | Feature | Description | Effort |
|---|---------|-------------|--------|
| **I1** | **Terminal output embedding** | When command output exceeds a threshold (~500 chars), chunk and embed it into LanceDB via the sidecar `/ingest` endpoint. Requires stdout/stderr capture in the reader thread (currently only exit codes are captured) | 1-2 days |
| **I2** | **Error resolution agent** | When `exit_code != 0` and stderr contains content, bundle the error context (command, stderr, cwd, recent commands) and send to an LLM for root cause analysis. Display inline suggestion panel below the error in the terminal. **Depends on:** Phase 2 LLM integration (litellm router) | 3-5 days |
| **I3** | **Natural language command translation** | Toggle mode where terminal input goes to LLM instead of shell. LLM translates NL to shell command, shows confirmation UI, user approves or edits. **Depends on:** Phase 2 LLM integration | 3-5 days |
| **I4** | **Pipeline monitoring** | Detect long-running commands (>30s heuristic or pattern matching), show live status, send desktop notifications on complete/fail. **Partially depends on:** W1 (command persistence for tracking) | 2-3 days |
| **I5** | **stdout/stderr capture** | The reader thread currently only sees the merged PTY output. To capture stdout/stderr separately, you'd need to either (a) parse OSC 633 more aggressively to mark output boundaries, or (b) capture at the shell hook level. The simpler approach: capture the full output between `CommandStart` and `CommandEnd` events and store it as the command's output | 1 day |

### Tier 4: Testing & Polish

| # | Task | Effort |
|---|------|--------|
| **T1** | **Add behavioral tests for TerminalPanel** — Tab creation, keyboard shortcuts, split operations | 2-3 hr |
| **T2** | **Add integration test for PTY write/read cycle** — Currently only negative-path tests exist | 2-3 hr |
| **T3** | **Add Fish shell hooks** — Detected but not implemented (`shell_hooks.rs:143`) | 1-2 hr |
| **T4** | **Validate CWD path in `pty_create`** | 30 min |
| **T5** | **Add SearchAddon keyboard binding (Cmd+F)** — Loaded but never invoked | 30 min |

---

## Recommended Execution Order

**Step 1 — Fix the blockers (half-day):**
F1 (take_writer), F2 (exit codes), F3 (initial size)

**Step 2 — Wire the plumbing (1 day):**
W1 (persist commands), W2 (debounce resize), W3 (split sizes), W4 (write errors), W5 (onExit), W6 (OSC buffer limit)

**Step 3 — Capture output (1 day):**
I5 (stdout capture between command start/end), I1 (embed terminal output in LanceDB)

**Step 4 — Pipeline monitoring (2-3 days):**
I4 (long-running detection, notifications) — this can be built without LLM integration

**Step 5 — LLM-dependent features (after Phase 2):**
I2 (error resolution agent), I3 (natural language mode) — these both require the litellm router from Phase 2

**Step 6 — Testing & polish (1 day):**
T1-T5

---

## Dependency Note

**I2 and I3 cannot be completed without Phase 2 (Session Handoff).** The error resolution agent and natural language translation both require an LLM router (litellm integration), which is Phase 2's responsibility. You have two strategic options:

1. **Complete Phase 3 Tier 1-2-3-4 now, defer I2/I3 until after Phase 2** — This means Phase 3 is "mostly done" with the mechanical/capture parts complete and the AI-powered parts waiting on the LLM layer.

2. **Interleave Phase 2 and Phase 3** — Build just enough of the LLM integration (litellm setup, basic chat, streaming responses) to unblock I2 and I3, then finish both phases together.

Option 1 is cleaner from a dependency standpoint. Option 2 ships a more impressive demo sooner.
