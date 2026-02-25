# Study Guide: Terminal Emulation, PTY, and Shell Integration

> This guide explains how terminals actually work at the OS level — what pseudo-terminals are, how xterm.js renders a terminal in a browser context, and how shell integration hooks enable command-level intelligence. These concepts underpin the functional terminal module described in `07_module_terminal.md`.

---

## 1. A Brief History: Why Terminals Are Complicated

The word "terminal" comes from physical hardware — a screen and keyboard connected to a mainframe via a serial cable. The famous DEC VT100 (1978) established the standard for how text-based interfaces work: the computer sends characters and **escape codes** (special byte sequences), and the terminal hardware interprets them to position the cursor, change colors, clear the screen, etc.

When physical terminals were replaced by software ("terminal emulators"), the software had to emulate this same protocol. Your terminal app (iTerm2, Windows Terminal, GNOME Terminal) is literally pretending to be a VT100-compatible hardware device.

This is why terminal commands use arcane escape codes like `\e[31m` to set red text — it's a protocol designed for serial hardware in the 1970s, and modern terminals maintain backward compatibility.

---

## 2. What Is a PTY (Pseudo-Terminal)?

### The Problem

A shell (bash, zsh, fish) is a program that reads commands and executes them. It expects to talk to a "terminal device" — something it can read user input from and write output to. On a physical terminal, this device is the serial port. On a headless server, there's no terminal device at all (that's why SSH needs to "allocate a PTY").

When you run a terminal emulator on your desktop, the shell needs a terminal device to talk to, but there's no physical terminal. The solution: a **pseudo-terminal (PTY)**.

### How a PTY Works

A PTY is a pair of virtual devices created by the OS kernel:

```
┌──────────────┐         ┌──────────────┐
│  PTY Master   │ ◄─────► │  PTY Slave    │
│ (your app)    │  kernel  │ (the shell)   │
└──────────────┘  pipes   └──────────────┘
```

**PTY Master:** Your application (the terminal emulator) reads from and writes to this end. When it writes bytes, they appear as "keyboard input" to the shell. When it reads bytes, it gets the shell's output.

**PTY Slave:** The shell (bash, zsh) reads from and writes to this end. It looks exactly like a real terminal device to the shell — the shell can't tell the difference between a PTY slave and a physical VT100.

### The Data Flow

```
User presses a key
    │
    ▼
Terminal emulator (xterm.js) captures the keypress
    │
    ▼
Writes the character to PTY master
    │
    ▼
Kernel transfers it to PTY slave
    │
    ▼
Shell (bash) reads the character
    │
    ▼
Shell processes and produces output (e.g., command result)
    │
    ▼
Shell writes output to PTY slave
    │
    ▼
Kernel transfers it to PTY master
    │
    ▼
Terminal emulator reads from PTY master
    │
    ▼
xterm.js renders the output on screen
```

### Terminal Line Discipline

Between the master and slave, the kernel applies a **line discipline** — a set of rules for processing terminal I/O:

- **Echo:** When you type a character, the line discipline echoes it back so you can see what you're typing. The shell doesn't need to manually print each character you type.
- **Line editing:** Backspace, Ctrl+W (delete word), Ctrl+U (delete line) are handled by the line discipline before the shell sees the input.
- **Signal generation:** Ctrl+C generates SIGINT, Ctrl+Z generates SIGTSTP, Ctrl+D generates EOF. The kernel translates these key combinations into signals sent to the shell's process group.
- **Raw mode:** Programs like vim, top, and nano disable the line discipline ("raw mode") to handle every keystroke themselves.

### Why This Matters for the Project

The Tauri backend uses `tauri-plugin-pty` to manage PTY pairs in Rust. For each terminal tab:

1. Rust creates a new PTY pair (`openpty()` system call)
2. Rust forks a child process (the shell) attached to the PTY slave
3. The PTY master is held by the Rust process
4. xterm.js in the frontend sends keystrokes → Rust → PTY master → shell
5. Shell output → PTY master → Rust → Tauri event → xterm.js renders it

---

## 3. Escape Codes and Terminal Protocols

### ANSI Escape Codes

Terminal programs communicate formatting through **escape sequences** — byte sequences starting with the ESC character (`\x1b` or `\e`):

| Escape Code | Meaning |
|---|---|
| `\e[31m` | Set text color to red |
| `\e[0m` | Reset all formatting |
| `\e[1;1H` | Move cursor to row 1, column 1 |
| `\e[2J` | Clear entire screen |
| `\e[K` | Clear from cursor to end of line |
| `\e[?25l` | Hide cursor |
| `\e[?25h` | Show cursor |

When `ls --color` shows colored filenames, it's literally printing escape codes between the filenames:

```
\e[34mDocuments\e[0m  \e[32mscript.sh\e[0m  \e[31mbroken.py\e[0m
  blue                green              red
```

### OSC (Operating System Command) Sequences

**OSC sequences** are a special class of escape codes for communicating metadata between the shell and the terminal emulator:

```
OSC format: \e]<code>;<data>\a

\e]0;My Title\a         → Set the window/tab title to "My Title"
\e]8;;https://...\a      → Start a hyperlink
\e]633;C\a               → Shell integration: command started
\e]633;D;0\a             → Shell integration: command ended (exit code 0)
\e]633;P;Cwd=/home/user\a → Shell integration: CWD update
```

The `633` code is used by VS Code's shell integration protocol (which this project adopts). It allows the terminal emulator to know *structured information* about what the shell is doing — not just raw text output.

---

## 4. xterm.js: A Terminal in the Browser

### What xterm.js Does

xterm.js is a JavaScript library that renders a terminal in an HTML canvas (or DOM). It:

1. **Parses escape codes:** Interprets the stream of bytes from the PTY, recognizing ANSI codes, OSC sequences, and other terminal protocols
2. **Maintains a screen buffer:** A 2D grid of cells (rows × columns), each cell containing a character and its attributes (color, bold, underline, etc.)
3. **Renders to canvas/DOM:** Draws the buffer to an HTML canvas for performance, or to DOM elements for accessibility
4. **Captures input:** Listens for keyboard events and translates them to the byte sequences the shell expects

### The xterm.js Architecture

```
┌─────────────────────────────────────────┐
│ xterm.js                                │
│                                         │
│  ┌─────────┐   ┌──────────┐   ┌──────┐ │
│  │  Parser  │──►│  Buffer  │──►│Render│ │
│  │(escape   │   │(screen   │   │ er   │ │
│  │ codes)   │   │ state)   │   │      │ │
│  └─────────┘   └──────────┘   └──────┘ │
│       ▲                           │     │
│       │                           ▼     │
│  ┌─────────┐              ┌──────────┐  │
│  │  Input  │              │  Canvas  │  │
│  │Handler  │              │  /DOM    │  │
│  └─────────┘              └──────────┘  │
└─────────────────────────────────────────┘
```

**Parser:** Receives raw bytes, recognizes escape sequences, and calls the appropriate buffer operations (move cursor, change color, insert character, clear line, etc.).

**Buffer:** The canonical state of the terminal — a grid of cells plus a scrollback buffer. The buffer knows the cursor position, the current formatting state, and the content of every cell. xterm.js maintains two buffers: the **normal buffer** (regular shell usage) and the **alternate buffer** (used by full-screen apps like vim, top, less).

**Renderer:** Reads the buffer and draws it. The WebGL renderer is fastest (GPU-accelerated), followed by the canvas renderer, then the DOM renderer.

### xterm.js Addons

xterm.js is modular. Core functionality is minimal; features are added through **addons**:

| Addon | Purpose |
|-------|---------|
| `xterm-addon-fit` | Auto-resize the terminal to fit its container element |
| `xterm-addon-web-links` | Detect URLs in output and make them clickable |
| `xterm-addon-search` | Search (Ctrl+F) within terminal output |
| `xterm-addon-unicode11` | Full Unicode support (emoji, CJK characters) |
| `xterm-addon-webgl` | GPU-accelerated rendering via WebGL |
| `xterm-addon-serialize` | Serialize terminal state (useful for session restore) |

---

## 5. Shell Integration: Structured Command Capture

### The Problem

Raw PTY output is an undifferentiated stream of bytes. The terminal sees:

```
$ python train.py --epochs 10
Epoch 1/10: loss=2.34
Epoch 2/10: loss=1.89
...
Epoch 10/10: loss=0.089
$ echo "done"
done
$
```

From just this byte stream, how does the system know:
- Where one command ends and the next begins?
- What the exit code of `python train.py` was?
- Which bytes are the command prompt vs. command output?

Without shell integration, the answer is: **it doesn't.** It would have to guess based on heuristics (look for `$` characters, assume newlines after prompts are commands). This is fragile and unreliable.

### Shell Hooks

Shell integration works by injecting **hooks** into the shell that emit structured signals at key points:

**For bash:**
```bash
# Injected via PROMPT_COMMAND and a trap
__terminal_preexec() {
    # Called before each command executes
    printf '\e]633;C\a'  # Signal: command started
}

__terminal_precmd() {
    # Called before the prompt is displayed (after command finishes)
    printf '\e]633;D;%s\a' "$?"  # Signal: command ended, with exit code
    printf '\e]633;P;Cwd=%s\a' "$PWD"  # Signal: current directory
}

trap '__terminal_preexec' DEBUG
PROMPT_COMMAND='__terminal_precmd'
```

**For zsh:**
```zsh
preexec() { printf '\e]633;C\a' }
precmd() {
    printf '\e]633;D;%s\a' "$?"
    printf '\e]633;P;Cwd=%s\a' "$PWD"
}
```

**For fish:**
```fish
function fish_preexec; printf '\e]633;C\a'; end
function fish_postexec; printf '\e]633;D;%s\a' $status; end
```

### What the Terminal Emulator Sees

With shell integration active, the byte stream becomes structured:

```
\e]633;P;Cwd=/home/user/thesis\a        ← CWD is /home/user/thesis
$ python train.py --epochs 10
\e]633;C\a                                ← Command started
Epoch 1/10: loss=2.34
Epoch 2/10: loss=1.89
...
Epoch 10/10: loss=0.089
\e]633;D;0\a                              ← Command ended, exit code 0
\e]633;P;Cwd=/home/user/thesis\a
$ echo "done"
\e]633;C\a
done
\e]633;D;0\a
```

xterm.js intercepts the `633` OSC sequences (they're invisible — not rendered to the screen). The application now knows:

1. The exact boundaries of each command's output
2. The exit code of each command
3. The working directory at each point in time
4. Which text is the command vs. the output

### What This Enables

With structured command data, the terminal intelligence layer can:

- **Log commands to SQLite** with clean separation: command text, output, exit code, duration
- **Detect errors** precisely: exit code ≠ 0 AND stderr content → trigger error resolution
- **Index output** for semantic search: embed the output of meaningful commands
- **Track experiments** : detect training metrics in output of identified commands
- **Navigate** : click on a specific command's output in the scrollback, knowing exactly where it starts and ends

---

## 6. The Connection: xterm.js ↔ Tauri ↔ PTY

Here's the complete data flow in this project:

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   xterm.js      │     │    Tauri (Rust)   │     │   Shell (bash)   │
│  (WebView)      │     │    (PTY Master)   │     │  (PTY Slave)     │
├─────────────────┤     ├──────────────────┤     ├──────────────────┤
│                 │     │                  │     │                  │
│ User types 'ls' │     │                  │     │                  │
│       │         │     │                  │     │                  │
│       ▼         │     │                  │     │                  │
│ invoke("pty_    ├────►│ Write 'ls\n' to  ├────►│ Shell receives   │
│  write", "ls\n")│     │ PTY master fd    │     │ 'ls\n' from      │
│                 │     │                  │     │ PTY slave fd     │
│                 │     │                  │     │       │          │
│                 │     │                  │     │       ▼          │
│                 │     │                  │     │ Execute 'ls'     │
│                 │     │                  │     │ Write output to  │
│                 │     │                  │◄────┤ PTY slave fd     │
│                 │     │ Read from PTY    │     │                  │
│                 │     │ master fd        │     │ Emit OSC 633;D;0 │
│                 │     │       │          │     │ (command done)   │
│                 │     │       ▼          │     │                  │
│ Receive event   │◄────┤ Emit Tauri event │     │                  │
│ "pty-output"    │     │ with output bytes│     │                  │
│       │         │     │       │          │     │                  │
│       ▼         │     │       ▼          │     │                  │
│ xterm.js parses │     │ Parse OSC 633    │     │                  │
│ bytes, renders  │     │ sequences:       │     │                  │
│ to screen       │     │ - Log command    │     │                  │
│                 │     │ - Check exit code│     │                  │
│                 │     │ - Update CWD     │     │                  │
│                 │     │ - Trigger error  │     │                  │
│                 │     │   agent if needed│     │                  │
└─────────────────┘     └──────────────────┘     └──────────────────┘
```

Key design decision: **Rust intercepts the OSC sequences** before forwarding output to xterm.js. This means the intelligence layer processes command boundaries in Rust (fast, with direct SQLite access) rather than in JavaScript (slower, needs IPC for storage).

---

## 7. Terminal Resize and Reflow

### The Problem

When you resize a terminal window, the number of columns and rows changes. Long lines that wrapped at 80 columns need to reflow for 120 columns (and vice versa). This is surprisingly complex.

### How It Works

1. **Frontend detects resize:** The `xterm-addon-fit` addon monitors the container element's dimensions and calculates the new column/row count.

2. **Notify the PTY:** The new dimensions are sent to the PTY via the `TIOCSWINSZ` ioctl (a system call to set the terminal window size):

```rust
// Rust (Tauri backend)
pty.resize(PtySize { cols: 120, rows: 40 })?;
```

3. **Shell receives SIGWINCH:** The kernel sends the SIGWINCH signal to the shell, telling it the terminal size changed. Programs like vim redraw their entire screen in response.

4. **xterm.js reflows the buffer:** Lines that wrapped at the old width are re-wrapped at the new width. The scrollback buffer is reflowed too.

---

## 8. Natural Language Mode: The Translation Layer

### How NL Translation Works

Natural language mode is conceptually simple — it's an LLM prompt with good context:

```
System prompt:
You are a shell command translator. Convert the user's natural language
request into a shell command for {shell} on {os}.

Context:
- Current directory: {cwd}
- Recent commands: {last_5_commands}
- Available tools: {which python, which node, ...}

User: "show me the 10 largest files in this directory sorted by size"

LLM output: du -sh * | sort -rh | head -10
```

The context is critical — shell type (bash vs fish have different syntax), OS (macOS `du` flags differ from Linux), current directory, and recent commands all influence the correct translation.

### Safety: Destructive Command Detection

Before presenting the translated command, the system scans for dangerous patterns:

```python
DESTRUCTIVE_PATTERNS = [
    r'\brm\s+-rf\b',        # rm -rf
    r'\bdd\s+',             # dd (disk destroyer)
    r'\bmkfs\b',            # format filesystem
    r'\b>\s*/dev/',          # write to device files
    r'\bchmod\s+-R\s+777\b', # dangerous permission change
    r'\bsudo\b',            # elevated privileges
]
```

If a destructive pattern is found, the command is flagged with a warning. Translated commands **always** require user confirmation before execution — this is a non-negotiable safety rule.

---

## Key Takeaways

1. **PTYs are virtual terminal devices.** The master side connects to your app; the slave side connects to the shell. The kernel mediates, applying line discipline rules.

2. **Escape codes are the terminal protocol.** ANSI codes control formatting and cursor movement. OSC sequences carry structured metadata. Both are byte sequences embedded in the output stream.

3. **xterm.js parses and renders.** It receives raw bytes, interprets escape codes, maintains a screen buffer, and draws to canvas. Addons extend its capabilities.

4. **Shell integration hooks are the key to intelligence.** Without OSC 633 sequences marking command boundaries, the terminal can't distinguish commands from output. With them, every command becomes a structured record.

5. **The data path is: xterm.js → Tauri IPC → Rust → PTY master → kernel → PTY slave → shell** (and reverse for output). Rust intercepts shell integration signals before forwarding to the frontend.

6. **Terminal resize is a multi-step handshake.** Frontend detects size change → notifies Rust → Rust updates PTY → kernel sends SIGWINCH to shell → shell redraws → xterm.js reflows buffer.

---

## Further Reading

- [The TTY Demystified](https://www.linusakesson.net/programming/tty/) — The definitive guide to how terminals work at the OS level
- [xterm.js Documentation](https://xtermjs.org/docs/) — API reference and guides
- [VT100 Escape Codes](https://vt100.net/docs/vt100-ug/) — The original terminal protocol specification
- [Shell Integration in VS Code](https://code.visualstudio.com/docs/terminal/shell-integration) — The OSC 633 protocol this project adopts
- [PTY Programming in Rust](https://docs.rs/portable-pty/latest/portable_pty/) — Rust PTY management crate