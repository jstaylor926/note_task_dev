# Study Guide: System Architecture — Processes, IPC, and WebViews

> This guide explains the core computing concepts behind the three-process architecture described in `01_system_architecture.md`. If you understand everything here, you'll understand *why* the system is designed the way it is — not just *what* it does.

---

## 1. What Is a Process?

A **process** is an instance of a running program. When you launch an app, the operating system creates a process for it, giving it its own chunk of memory, a process ID, and a set of resources (file handles, network sockets, etc.).

Key properties of a process:

- **Isolated memory:** One process can't read or write another process's memory directly. This is enforced by the OS kernel for safety.
- **Own thread(s):** Each process has at least one thread of execution. It can spawn more.
- **Lifecycle:** A process starts, does work, and eventually exits (or crashes). The OS reclaims its resources on exit.

**Why this matters for the project:** The workspace app runs as *three* separate processes — Tauri/Rust, SolidJS frontend, and the Python sidecar. They can't just share variables in memory. They need explicit communication channels between them.

---

## 2. Threads vs. Processes

A **thread** is a lightweight unit of execution *within* a process. Multiple threads share the same memory space.

| Property | Process | Thread |
|----------|---------|--------|
| Memory | Own isolated address space | Shares memory with other threads in the same process |
| Creation cost | Heavy (OS allocates new address space) | Light (just a new execution context) |
| Communication | Needs IPC (pipes, sockets, HTTP, etc.) | Can share variables directly (but needs synchronization) |
| Crash isolation | One process crashing doesn't kill others | One thread panicking can take down the whole process |

**In this project:**
- The Rust layer uses **threads** for file watching and PTY management (fast, shared memory within the Rust process)
- The Python sidecar is a **separate process** from Rust (crash isolation — if Python crashes, the Rust app survives and can restart it)
- The SolidJS frontend runs in its own **WebView process** (more on this below)

---

## 3. Inter-Process Communication (IPC)

Since processes have isolated memory, they need a mechanism to exchange data. This is called **IPC (Inter-Process Communication)**.

### Common IPC Mechanisms

**Pipes:** One-way byte streams between processes. The shell's `|` operator creates pipes (`ls | grep .py`). Fast but unstructured — just raw bytes.

**Sockets:** Two-way communication endpoints. Can be local (Unix domain sockets — a file on disk that acts as a communication channel) or networked (TCP/IP sockets). Structured protocols (HTTP, WebSocket) are built on top of sockets.

**HTTP over localhost:** The Python sidecar listens on `127.0.0.1:9400`. The Rust process makes HTTP requests to it. This is just regular HTTP, but the `127.0.0.1` address means it never leaves the machine — it loops back internally in the OS networking stack. It never touches a physical network adapter.

**Shared memory:** Two processes map the same chunk of physical memory. Extremely fast but complex to manage (synchronization issues). Not used in this project.

**Tauri's `invoke()` IPC:** Tauri provides a custom IPC bridge between the WebView (frontend) and the Rust backend. Under the hood, this is a message-passing system where the frontend calls `invoke("commandName", { args })` and the Rust side has a handler function that receives those arguments, does work, and returns a result. Tauri serializes arguments to JSON for transit.

### Communication Patterns in This Project

```
Frontend (SolidJS)
     │
     │  Tauri invoke() — JSON over internal IPC bridge
     ▼
Rust Backend (Tauri main process)
     │
     │  HTTP requests to 127.0.0.1:9400 — JSON over localhost TCP
     ▼
Python Sidecar (FastAPI on uvicorn)
```

**The frontend never talks to Python directly.** Everything is funneled through Rust. This is a deliberate architectural choice — Rust acts as the single coordinator, which simplifies debugging, error handling, and security.

---

## 4. WebViews vs. Bundled Browsers

This is one of the most important architectural distinctions in desktop app development.

### The Electron Approach (Bundled Chromium)

Electron apps (VS Code, Slack, Discord) ship with their own copy of the Chromium browser engine — the same engine that powers Google Chrome. Your app's UI is rendered inside this bundled browser.

**Pros:** Consistent rendering across platforms (same Chromium version everywhere). Full access to Chrome's APIs.

**Cons:** Each Electron app adds ~80-120 MB to disk and ~200-300 MB of RAM at idle because it's running a near-complete web browser as its rendering engine. If you have 5 Electron apps open, you're essentially running 5 separate Chrome instances.

### The Tauri Approach (Native WebViews)

Tauri doesn't bundle a browser. Instead, it uses the **WebView already installed on your operating system:**

| OS | WebView Engine |
|----|---------------|
| macOS | WebKit (Safari's engine) |
| Windows | WebView2 (Edge/Chromium-based) |
| Linux | WebKitGTK (WebKit for GTK) |

**Pros:** Tiny binary size (2-3 MB), tiny memory footprint (30-40 MB idle). No duplicate browser engines.

**Cons:** Different rendering engines on different platforms. WebKit on Linux may render CSS or fonts slightly differently than Chromium. You need to test on all platforms.

### What Is a WebView, Technically?

A WebView is an OS-provided component that can render HTML, CSS, and JavaScript — essentially a browser window without the address bar, bookmarks, and other browser chrome. Your app creates a WebView, loads your frontend code into it, and the OS handles the rendering.

Think of it like embedding a browser tab inside your application window. The tab can run any web application, but it's controlled by your native code rather than the user typing URLs.

**Why Tauri uses WebViews:** The frontend of this workspace app is built with SolidJS (a JavaScript framework). SolidJS produces HTML/CSS/JS output. The WebView renders that output. The Rust backend talks to the WebView through Tauri's IPC bridge.

---

## 5. The Three-Process Model in Detail

### Process 1: Tauri Main Process (Rust)

This is the "brain" of the application. It:

1. **Creates the application window** and initializes the WebView
2. **Manages the Python sidecar lifecycle** (spawns it, monitors its health, restarts on crash)
3. **Handles file system operations** — reading, writing, and watching files for changes
4. **Manages PTY instances** for the terminal emulator
5. **Accesses SQLite directly** for fast structured data operations
6. **Routes requests** between the frontend and the Python sidecar

Rust is chosen here because these operations are performance-sensitive. File watching generates a high volume of events. PTY management requires low-latency I/O. SQLite access needs to be fast and concurrent. Rust provides zero-cost abstractions and guaranteed memory safety without a garbage collector.

### Process 2: Python Sidecar (FastAPI)

This process handles everything that benefits from Python's ML/AI ecosystem:

1. **LLM calls** via litellm (Ollama, Claude, OpenAI, Gemini)
2. **Embedding generation** via sentence-transformers
3. **AST parsing** via tree-sitter Python bindings
4. **Entity extraction** (NER, task detection)
5. **LanceDB operations** (vector storage and search)
6. **Background agents** (research daemon, pipeline monitor)

**FastAPI** is the web framework that exposes these capabilities as HTTP endpoints. It runs on **uvicorn**, an ASGI server that uses Python's `asyncio` event loop for concurrent request handling.

**Why a separate process?** If the Python code crashes (bad model loading, OOM during embedding), the Rust app continues running. The user sees a "degraded mode" indicator but can still edit files, use the terminal, and interact with the UI. Rust restarts the sidecar automatically.

### Process 3: Frontend (SolidJS in WebView)

The UI layer — purely responsible for rendering and user interaction. It:

1. Renders the editor (CodeMirror), terminal (xterm.js), notes, tasks, chat, and search panels
2. Handles user input (keystrokes, clicks, drag-and-drop)
3. Manages ephemeral UI state (scroll positions, panel sizes, modal states)
4. Communicates with Rust exclusively through `invoke()` calls

The frontend is deliberately "thin" — it doesn't make decisions about data processing, storage, or AI. It asks the Rust layer to do things and renders the results.

---

## 6. Async Runtimes and Event Loops

Both Rust and Python use **async runtimes** to handle concurrency efficiently.

### What Is Async Programming?

Traditional (synchronous) code does one thing at a time:

```
result1 = fetch_from_database()    # Wait 5ms
result2 = call_llm_api()           # Wait 2000ms
result3 = read_file()              # Wait 1ms
# Total: 2006ms
```

Async code can start multiple operations and wait for them concurrently:

```
task1 = async fetch_from_database()  # Start, don't wait
task2 = async call_llm_api()         # Start, don't wait
task3 = async read_file()            # Start, don't wait
result1, result2, result3 = await all(task1, task2, task3)
# Total: ~2000ms (limited by the slowest operation)
```

### The Event Loop

An async runtime is built around an **event loop** — a single loop that:

1. Checks which tasks have pending I/O results
2. Runs the tasks that are ready to make progress
3. Puts tasks back to sleep when they're waiting for I/O
4. Repeats

This is how a single thread can handle thousands of concurrent network requests — most of the time, each request is just waiting for a response, not doing computation.

### Rust: Tokio

**Tokio** is Rust's most popular async runtime. Tauri uses it internally. It provides:
- An event loop for async I/O
- A thread pool for CPU-bound work
- Timers, channels, and synchronization primitives

In this project, Tokio handles concurrent IPC calls from the frontend, file watcher events, and HTTP requests to the Python sidecar — all without blocking.

### Python: asyncio + uvicorn

Python's `asyncio` module provides the event loop. **uvicorn** runs FastAPI on top of it. When an HTTP request arrives:

1. uvicorn receives the request
2. FastAPI routes it to the correct handler function
3. If the handler is `async`, it runs on the event loop (good for I/O-bound work like LLM API calls)
4. If the handler needs CPU-bound work (embedding generation, AST parsing), it offloads to a **thread pool** so it doesn't block the event loop

This distinction is important: I/O-bound work (waiting for network responses) is handled async. CPU-bound work (computing embeddings, parsing syntax trees) is pushed to threads.

---

## 7. Streaming and Server-Sent Events (SSE)

When you chat with an LLM, responses stream in token by token. This requires a different communication pattern than simple request-response.

### How Streaming Works

1. Frontend sends a chat message via `invoke("chat", { message })`
2. Rust forwards it to Python as `POST /chat`
3. Python calls the LLM via litellm with streaming enabled
4. As tokens arrive, Python sends them back to Rust as an **SSE (Server-Sent Events) stream**
5. Rust forwards each token to the frontend via a **Tauri event channel**
6. The frontend renders each token as it arrives

### What Are Server-Sent Events?

SSE is a simple protocol for one-way streaming from server to client over HTTP. The server holds the HTTP connection open and sends events as they become available:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream

data: {"token": "Hello"}

data: {"token": " there"}

data: {"token": ", how"}

data: {"token": " can"}

data: {"token": " I help?"}

data: [DONE]
```

It's simpler than WebSockets (which are two-way) and fits perfectly for LLM streaming where only the server needs to push data.

### Tauri Event Channels

Tauri provides an event system where the Rust backend can emit named events that the frontend listens for:

```rust
// Rust side
app_handle.emit("chat-token", token_payload)?;
```

```javascript
// Frontend side
listen("chat-token", (event) => {
  appendToChat(event.payload);
});
```

This is how streaming LLM responses reach the UI without polling.

---

## 8. Error Handling and Resilience

### Crash Isolation Through Process Boundaries

The three-process model provides natural crash isolation:

| Crash Scenario | Impact | Recovery |
|---|---|---|
| Python sidecar crashes | No AI features, no embedding, no semantic search | Rust detects via health check, restarts automatically (max 3 retries with exponential backoff) |
| Frontend WebView crashes | UI is gone | Tauri detects and reloads the WebView |
| Rust main process crashes | Everything dies | OS-level restart (user reopens the app). Last periodic snapshot is recoverable from SQLite |

### Exponential Backoff

When the sidecar crashes and Rust tries to restart it, it uses **exponential backoff**: wait 1 second, then 2, then 4. This prevents a rapid crash-restart-crash loop from consuming all system resources.

### WAL Mode and Crash Safety

SQLite's WAL (Write-Ahead Logging) mode ensures that even if the process crashes mid-write, the database is not corrupted. This is covered in detail in the database study guide, but the key point here is: crash safety is designed into the storage layer, not just the process management layer.

---

## 9. Security: Why 127.0.0.1 Matters

The Python sidecar binds to `127.0.0.1:9400`. This is the **loopback address** — it's a special IP address that always refers to "this machine." Traffic sent to 127.0.0.1 never leaves the computer. It never touches a network adapter, never goes through a router, and is invisible to other machines on the network.

If the sidecar instead bound to `0.0.0.0:9400`, it would accept connections from *any* network interface — meaning other computers on the same network could potentially access the API endpoints. For an application handling proprietary aerospace code, this would be a serious security issue.

---

## Key Takeaways

1. **Three processes for three concerns:** Rust handles performance-critical system operations, Python handles the ML/AI ecosystem, and the WebView handles UI rendering. Each plays to its language's strengths.

2. **IPC is the glue:** The processes communicate through well-defined channels (Tauri invoke for frontend↔Rust, HTTP for Rust↔Python). No shared memory, no implicit coupling.

3. **WebViews save resources:** Using the OS's built-in browser engine instead of bundling Chromium keeps the app lightweight — critical for a tool that's supposed to *reduce* cognitive overhead, not add to it.

4. **Async everywhere:** Both Rust (Tokio) and Python (asyncio) use event loops to handle many concurrent operations efficiently. CPU-bound work is offloaded to thread pools.

5. **Crash isolation is architectural:** The sidecar being a separate process means Python ML code can crash without taking down the editor, terminal, or file system operations.

---

## Further Reading

- [Tauri Architecture Guide](https://tauri.app/concept/) — How Tauri's IPC and WebView integration works
- [Tokio Tutorial](https://tokio.rs/tokio/tutorial) — Rust's async runtime in depth
- [FastAPI Async](https://fastapi.tiangolo.com/async/) — How FastAPI handles async vs sync endpoints
- [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) — The SSE protocol specification
