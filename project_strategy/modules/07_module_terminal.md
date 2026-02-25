# Module: Functional Terminal

> The terminal is a first-class citizen, not a panel hidden at the bottom. It is fully integrated with the context engine — every command feeds the knowledge graph, errors trigger the resolution agent, and long-running processes are monitored automatically. Future iterations should focus on improving error detection accuracy, expanding natural language command translation, and building richer pipeline monitoring.

---

## Overview

The terminal module has four sub-systems:

1. **Terminal Emulator Core** — xterm.js + PTY backend for full shell emulation
2. **Terminal Intelligence Layer** — command capture, semantic indexing, error detection
3. **Natural Language Mode** — translate plain English to shell commands
4. **Pipeline Monitoring** — detect and track long-running processes

Plus a cross-cutting concern: **Terminal ↔ Editor Integration** for bidirectional navigation.

---

## Sub-System 4A: Terminal Emulator Core

### Technology

- **Frontend rendering:** xterm.js v5 with addons (fit, web-links, search, unicode11)
- **PTY backend:** tauri-plugin-pty (Rust) managing pseudo-terminal processes
- **Shell support:** bash, zsh, fish, PowerShell (detect user's default shell)

### Base Capabilities

| Feature | Implementation |
|---------|---------------|
| Full PTY emulation | xterm.js + tauri-plugin-pty |
| Split panes | Tile terminals horizontally/vertically (configurable layout) |
| Multiple tabs | Separate terminal instances, each with its own shell and CWD |
| Scrollback buffer | Configurable size (default: 10,000 lines) with search |
| Clickable links | xterm-addon-web-links: URLs and file paths are clickable |
| Search in output | xterm-addon-search: Cmd+F within terminal output |
| Shell integration | Detect prompt boundaries for command-level capture |
| Configurable themes | Match the editor theme, or configure independently |
| Font configuration | Same font stack as editor, configurable size |
| Copy/paste | System clipboard integration |
| Selection | Mouse selection, double-click for word, triple-click for line |

### Split Pane Layout

```
┌──────────────────────┬──────────────────────┐
│ Terminal 1            │ Terminal 2            │
│ ~/thesis/src          │ ~/thesis/experiments  │
│                       │                       │
│ $ python train.py     │ $ tensorboard --logdir│
│ Epoch 1/50: loss=2.34 │ TensorBoard 2.x at   │
│ Epoch 2/50: loss=1.89 │ http://localhost:6006 │
│                       │                       │
├───────────────────────┴──────────────────────┤
│ Terminal 3 (full width)                       │
│ ~/thesis                                      │
│ $ git status                                  │
│ On branch feature/multi-head-attention        │
│ Changes not staged for commit:                │
│   modified: src/models/transformer.py         │
└───────────────────────────────────────────────┘
```

Users can drag split dividers, create new splits, close panes, and drag tabs between panes.

### Shell Integration

To capture commands at the command level (not just raw PTY output), integrate with the shell's prompt mechanism:

**For bash/zsh:**
- Inject a shell hook via `PROMPT_COMMAND` (bash) or `precmd`/`preexec` (zsh)
- The hook emits OSC escape sequences that xterm.js can intercept:
  - `\e]633;C\a` — command start (marks the beginning of command output)
  - `\e]633;D;{exit_code}\a` — command end (marks the end with exit code)
  - `\e]633;P;Cwd={path}\a` — current working directory update

**For fish:**
- Fish has built-in `fish_prompt` and `fish_preexec` functions

This shell integration allows the terminal to:
- Know exactly where each command starts and ends in the scrollback
- Capture the command text, its output, and its exit code as separate units
- Store each command as a structured record in SQLite

---

## Sub-System 4B: Terminal Intelligence Layer

### Command Capture Pipeline

```
Command Executed (detected via shell integration)
    │
    ▼
Record in SQLite: terminal_commands table
    ├── command text
    ├── working directory
    ├── exit code
    ├── stdout preview (first N bytes, configurable, default 10 KB)
    ├── stderr preview (first N bytes)
    ├── duration
    └── workspace profile ID
    │
    ▼
Context Engine Notification
    └── Session state updater adds to recent_terminal_commands
    │
    ▼
Conditional Processing
    ├── exit_code != 0 → trigger Error Resolution Agent (4B.1)
    ├── output contains metrics pattern → trigger Experiment Detection (4B.2)
    ├── command still running after N seconds → trigger Pipeline Monitor (4B.3)
    └── output > embedding threshold → embed in LanceDB for semantic search
```

### 4B.1: Error Detection & Resolution Agent

When a command fails (non-zero exit code + stderr content):

```
Error Detected
    │
    ▼
Bundle Context
    ├── The failed command
    ├── stderr output (full, up to configurable limit)
    ├── stdout output (may contain partial results)
    ├── Current working directory
    ├── Relevant environment variables (PATH, PYTHONPATH, CUDA_VISIBLE_DEVICES, etc.)
    ├── The source file referenced in the error (if identifiable from stack trace)
    ├── Recent successful commands (for context)
    └── Active workspace profile and session state
    │
    ▼
Send to LLM Router (debugging agent prompt)
    │
    ▼
Display Inline Suggestion Panel
    ┌── Error Resolution ─────────────────────────────┐
    │                                                   │
    │ ❌ Command failed: python train.py --epochs 50    │
    │                                                   │
    │ 🔍 Root Cause:                                    │
    │ CUDA out of memory. Tried to allocate 2.00 GiB    │
    │ but only 1.24 GiB available on GPU 0.              │
    │                                                   │
    │ 💡 Suggested Fix:                                  │
    │ Reduce batch_size in config.yaml from 128 to 32,  │
    │ or implement gradient accumulation (4 steps of 32) │
    │ to maintain effective batch size of 128.            │
    │                                                   │
    │ [Apply Fix] [Copy Suggestion] [Dismiss]           │
    └───────────────────────────────────────────────────┘
```

The "Apply Fix" button:
1. Opens the referenced file in the editor
2. Shows a diff preview of the proposed change
3. User confirms → edit is applied
4. A new task is optionally created: "Verify fix for CUDA OOM in train.py"

### 4B.2: Experiment Detection

When terminal output contains metric patterns (loss, accuracy, epoch, step):

```
Pattern Detection (regex)
    ├── "loss[=:]\s*[\d.]+" → training loss metric
    ├── "accuracy[=:]\s*[\d.]+" → accuracy metric
    ├── "epoch\s+\d+/\d+" → epoch progress
    ├── "step\s+\d+" → step progress
    └── custom patterns (configurable)
    │
    ▼
If metrics detected in a long-running command:
    Create Experiment entity in knowledge graph
    ├── Link to triggering TerminalSession
    ├── Link to config file (if identifiable from command args)
    ├── Store parsed metrics in entity metadata
    └── Update periodically as new metrics appear in output
```

### 4B.3: Semantic Indexing of Terminal Output

For commands with substantial output (build logs, test results, data exploration):

```
Output exceeds embedding threshold (default: 500 chars)
    │
    ▼
Chunk output into segments (sliding window, 512 tokens, 128 overlap)
    │
    ▼
Embed each chunk with metadata:
    ├── source_type: "terminal"
    ├── command: the command that produced this output
    ├── exit_code
    └── timestamp
    │
    ▼
Store in LanceDB
```

This enables searches like: "that error message about missing CUDA drivers" → finds the terminal output from 3 days ago.

---

## Sub-System 4C: Natural Language Mode

A toggleable mode where the terminal input accepts natural language and translates it to shell commands.

### Flow

```
User types: "show me the 10 largest files in this directory sorted by size"
    │
    ▼
NL Mode Active? → Yes
    │
    ▼
Send to LLM Router with context:
    ├── Natural language input
    ├── Current shell (bash/zsh/fish)
    ├── Current working directory
    ├── OS (Linux/macOS/Windows)
    └── Recent commands (for context)
    │
    ▼
LLM generates: du -sh * | sort -rh | head -10
    │
    ▼
Display for confirmation:
    ┌── Natural Language Translation ────────────┐
    │                                             │
    │ 💬 "show me the 10 largest files sorted     │
    │     by size"                                │
    │                                             │
    │ 🖥️ du -sh * | sort -rh | head -10          │
    │                                             │
    │ [Execute] [Edit] [Cancel]                   │
    └─────────────────────────────────────────────┘
    │
    ▼
User confirms → command executes in terminal
    └── Both the NL query and translated command are logged
```

### Safety

- **Destructive command detection:** If the translated command contains `rm -rf`, `dd`, `mkfs`, `FORMAT`, or other destructive operations, show a prominent warning and require explicit confirmation.
- **Sudo detection:** If the command requires `sudo`, flag it and show the full command for review.
- **Never auto-execute:** NL-translated commands always require confirmation (unlike typed commands which execute on Enter).

### Toggle

- Keyboard shortcut to toggle NL mode (e.g., Cmd+Shift+N)
- Visual indicator in the terminal prompt when NL mode is active (e.g., prompt changes from `$` to `💬`)
- NL mode is per-terminal-instance (one terminal can be in NL mode while another is in normal mode)

---

## Sub-System 4D: Pipeline Monitoring

### Detection

Long-running commands are detected by:

1. **Time heuristic:** Command running longer than N seconds (configurable, default: 30s)
2. **Command pattern matching:** Known long-running commands (e.g., `python train.py`, `npm run build`, `docker build`, `make`)
3. **User annotation:** User explicitly marks a command for monitoring (right-click → "Monitor this process")

### Monitoring Features

```
┌── Pipeline Monitor ────────────────────────────┐
│                                                 │
│ 🏃 python train.py --epochs 50                  │
│ ├── Running: 23m 14s                            │
│ ├── PID: 42356                                  │
│ ├── GPU: 78% utilization                        │
│ ├── Last output: Epoch 12/50, loss=0.342        │
│ └── ETA: ~45 minutes (based on epoch rate)      │
│                                                 │
│ 🏃 npm run build                                │
│ ├── Running: 1m 32s                             │
│ ├── Last output: Building chunk 34/89...        │
│ └── ETA: ~2 minutes                             │
│                                                 │
│ ✅ docker build -t myimage .                    │
│ ├── Completed: 5m ago (exit code 0)             │
│ └── Image: myimage:latest (1.2 GB)             │
│                                                 │
│ [Background All] [Notify on Complete]           │
└─────────────────────────────────────────────────┘
```

### Notifications

When a monitored process completes:
- **Desktop notification:** "Training completed (exit code 0) — 50 epochs, final loss: 0.089"
- **In-app badge:** Pipeline monitor icon shows completion count
- **Knowledge graph:** If experiment metrics were detected, create/finalize the Experiment entity
- **Session state:** Update session state with completed pipeline information

When a monitored process fails:
- **Desktop notification:** "Training failed (exit code 1) — CUDA OOM at epoch 12"
- **Error resolution agent:** Automatically triggered with full error context
- **Task creation:** Optionally create a task: "Investigate training failure in run-043"

---

## Terminal ↔ Editor Integration

| Feature | Implementation |
|---------|---------------|
| Click file path → open in editor | Parse terminal output for file path patterns (`/path/to/file.py:42`), make them clickable, open in editor at the specified line |
| Error → editor highlighting | When error resolution agent identifies a source file, add error decorations in the editor at the relevant lines |
| Run file from editor | Cmd+Enter in editor: runs the active file in the focused terminal with `python {file}` (or appropriate interpreter) |
| Terminal CWD → editor context | When the terminal changes directory, optionally update the file tree to show that directory |
| Editor file → terminal | Right-click file in editor tree → "Open terminal here" starts a new terminal in that file's directory |
| Copy output to note | Right-click terminal output → "Save to note" creates a new Note entity with the selected output |

---

## Configuration

```yaml
# terminal.yaml
terminal:
  default_shell: null             # null = detect from $SHELL, or explicit path
  scrollback_lines: 10000
  font_family: "JetBrains Mono"
  font_size: 14
  cursor_style: "block"           # block, underline, bar
  cursor_blink: true
  theme: "match_editor"           # match_editor, or specific terminal theme

intelligence:
  capture_stdout: true
  stdout_capture_limit_bytes: 10240
  stderr_capture_limit_bytes: 10240
  embed_output_threshold_chars: 500
  error_resolution_auto_trigger: true

natural_language:
  enabled: true
  confirmation_required: true     # Always require confirmation for NL-translated commands
  destructive_command_warning: true

pipeline_monitor:
  auto_detect: true
  time_threshold_seconds: 30
  notify_on_complete: true
  notify_on_failure: true
  known_long_commands:
    - "python train"
    - "npm run build"
    - "docker build"
    - "make"
    - "cargo build"
    - "pip install"
```

---

## Open Questions for Future Iterations

- Should the terminal support SSH sessions with the same intelligence layer? (Capture commands on remote machines)
- Can we implement terminal session replay (record and playback terminal sessions like asciinema)?
- Should the error resolution agent learn from past resolutions? (If you fixed a similar error before, suggest the same fix)
- How should we handle commands that produce enormous output (e.g., `cat large_file.csv`)? Truncate embedding? Skip?
- Should NL mode support multi-step translations? ("Set up a Python virtual environment and install the requirements") → multiple commands in sequence
- Can we detect and visualize command dependencies? ("This command depends on the output of that command")
- Should the pipeline monitor integrate with external monitoring tools (Grafana, Prometheus)?
- Can we add "smart paste" — detect when pasted content is a command from a tutorial/StackOverflow and offer to execute it?
