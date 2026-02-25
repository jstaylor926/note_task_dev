# Phase 3: Terminal

> **Goal:** Functional terminal emulator fully integrated with the context engine. Commands are logged, errors trigger the resolution agent, and terminal output is semantically searchable.

**Prerequisite:** Phase 2 (session handoff) complete.

---

## Definition of Done

- [ ] xterm.js terminal renders in the terminal panel with full PTY emulation
- [ ] Shell integration captures individual commands with exit codes
- [ ] Split pane support (multiple terminals, horizontal/vertical splits)
- [ ] Command logging to SQLite `terminal_commands` table
- [ ] stdout/stderr captured and embedded into LanceDB for semantic search
- [ ] Terminal output searchable via universal search from Phase 1
- [ ] Natural language mode: toggle, translate, confirm, execute
- [ ] Error detection triggers on non-zero exit codes with stack traces
- [ ] Error resolution agent provides inline fix suggestions
- [ ] Session state capture now includes recent terminal commands
- [ ] Click file paths in terminal output to open them (placeholder — editor in Phase 4)
- [ ] Pipeline monitoring detects long-running commands

---

## Key Tasks

### 1. xterm.js + PTY Integration

- Install xterm.js and addons (fit, web-links, search, unicode11)
- Configure tauri-plugin-pty for pseudo-terminal management
- Connect xterm.js frontend to PTY backend via Tauri IPC
- Detect user's default shell ($SHELL) and spawn it
- Handle terminal resize events (xterm-addon-fit)

### 2. Shell Integration

- Inject shell hooks for command boundary detection
- For bash: use `PROMPT_COMMAND` to emit OSC sequences
- For zsh: use `precmd`/`preexec` hooks
- Capture: command text, exit code, working directory, timestamp
- Store each command in `terminal_commands` table

### 3. Split Pane Terminal Layout

- Implement split pane container in SolidJS
- Support horizontal and vertical splits
- Each pane is an independent terminal instance with its own PTY
- Tab bar for multiple terminals within a pane
- Keyboard shortcuts: split horizontal, split vertical, close pane, navigate between panes

### 4. Terminal Output Intelligence

- Capture stdout/stderr for each command (buffer with configurable size limit)
- Embed substantial outputs (>500 chars) into LanceDB with terminal metadata
- Register terminal outputs as searchable via the existing semantic search endpoint
- Update session state capture to include `recent_terminal_commands`

### 5. Natural Language Mode

- Toggle with keyboard shortcut (Cmd+Shift+N)
- Visual indicator in prompt area when active
- On input: send to LLM for shell command translation
- Display translated command in confirmation panel
- Destructive command detection (rm -rf, dd, etc.) with warning
- Execute on confirmation, log both NL query and translated command

### 6. Error Resolution Agent

- Detect errors: non-zero exit code + stderr contains stack trace patterns
- Bundle error context: command, stderr, cwd, env vars, referenced source file
- Send to LLM with debugging prompt template
- Display inline suggestion panel below error output
- "Apply Fix" button: shows diff preview, applies on confirmation

### 7. Pipeline Monitoring (Basic)

- Detect long-running commands (>30 seconds)
- Show running indicator in terminal tab and status bar
- Desktop notification on completion or failure
- Create TerminalSession entities for monitored pipelines

---

## Testing Strategy

- **Unit test:** Shell hook injection produces correct OSC sequences
- **Unit test:** Error detection regex matches common Python/Node/Rust stack traces
- **Integration test:** Type command → execute → output captured → stored in SQLite → searchable in LanceDB
- **Integration test:** NL mode: type English → translated to shell → confirmation → execution
- **Integration test:** Error → resolution agent → suggestion displayed
- **Performance test:** Terminal responsiveness not degraded by logging overhead

---

## Open Questions

- Should terminal sessions persist across app restarts? (Restore shell state, or just the history?)
- How should we handle commands that produce enormous output (e.g., `find / -name "*"`)?
- Should the NL mode support context from the active file? ("Run this with the test config" → knows which file and config)
