# Study Guide: Rust, Tauri, and Reactive Frontend Models

> This guide covers the languages and frameworks that form the application shell: why Rust is chosen for the backend, how Tauri turns web UIs into desktop apps, and how SolidJS's reactive model differs from traditional approaches like React.

---

## 1. Rust: The Backend Language

### Why Rust Exists

Rust was created to solve a specific problem: how do you get the performance of C/C++ without the memory bugs that plague those languages? Buffer overflows, use-after-free, data races — these are entire categories of bugs that cause security vulnerabilities, crashes, and undefined behavior in C/C++ code.

Rust eliminates these bugs at **compile time** through its ownership system. If your Rust code compiles, it's guaranteed to be free of data races and memory safety violations.

### Ownership: The Core Concept

In Rust, every value has exactly one **owner** — a variable that "owns" the data. When the owner goes out of scope, the data is automatically freed (no garbage collector needed).

```rust
fn main() {
    let name = String::from("hello");  // name owns the String
    let greeting = name;                // ownership MOVES to greeting
    // println!("{}", name);            // ERROR: name no longer owns the data
    println!("{}", greeting);           // OK: greeting owns it now
}
```

This prevents two variables from independently trying to free the same memory (double-free bug) or one variable accessing memory that another has already freed (use-after-free bug).

### Borrowing: Sharing Without Giving Up Ownership

You can lend a reference to data without transferring ownership:

```rust
fn print_length(s: &String) {    // s borrows the String (read-only)
    println!("Length: {}", s.len());
}   // s goes out of scope, but it was just borrowing, so nothing is freed

fn main() {
    let name = String::from("hello");
    print_length(&name);          // lend a reference
    println!("{}", name);         // still valid — we never gave up ownership
}
```

Rust enforces at compile time: you can have either **one mutable reference** or **any number of immutable references** — never both. This prevents data races at the type system level.

### Zero-Cost Abstractions

Rust's abstractions (iterators, closures, generics, trait objects) compile down to the same machine code you'd write by hand in C. There's no runtime overhead for using high-level patterns.

```rust
// This high-level code:
let sum: i64 = numbers.iter().filter(|&&x| x > 0).sum();

// Compiles to the same machine code as:
let mut sum: i64 = 0;
for x in numbers {
    if x > 0 { sum += x; }
}
```

### Why Rust for This Project

| Concern | Why Rust Helps |
|---------|---------------|
| File watching | High-frequency events need low-latency handling without GC pauses |
| PTY management | Terminal I/O is performance-sensitive and requires careful memory management |
| SQLite access | Direct C library bindings without FFI overhead |
| Sidecar management | Process lifecycle management with guaranteed cleanup |
| Binary size | Rust compiles to small, statically linked binaries |
| Safety | No null pointer exceptions, no buffer overflows, no data races |

---

## 2. Tauri: From Web UI to Desktop App

### The Problem Tauri Solves

You want to build a desktop application with a rich UI. You have three options:

1. **Native toolkit (GTK, Qt, SwiftUI):** Maximum performance, but you build the entire UI from scratch for each platform. No HTML/CSS/JS.

2. **Electron:** Use HTML/CSS/JS for the UI by bundling Chromium. Huge binary, huge memory footprint. But massive ecosystem.

3. **Tauri:** Use HTML/CSS/JS for the UI by leveraging the OS's built-in WebView. Small binary (typically 5-15 MB, depending on dependencies), low memory footprint. Rust backend.

### How Tauri Works

```
┌──────────────────────────────────────┐
│         Your Application             │
│                                      │
│  ┌──────────────┐  ┌──────────────┐  │
│  │   Rust Core   │  │   WebView    │  │
│  │              │◄─►│ (OS-native)  │  │
│  │  - IPC       │  │              │  │
│  │  - File I/O  │  │  SolidJS UI  │  │
│  │  - SQLite    │  │  HTML/CSS/JS │  │
│  │  - PTY       │  │  CodeMirror  │  │
│  │  - Sidecar   │  │  xterm.js    │  │
│  └──────────────┘  └──────────────┘  │
└──────────────────────────────────────┘
```

Tauri provides:
- A Rust runtime that handles native OS operations
- A WebView component that renders your frontend
- An IPC bridge that connects them
- A build system that packages everything into a native app

### Tauri's IPC System

The frontend (JavaScript) calls Rust functions through `invoke()`:

```javascript
// Frontend (SolidJS)
const results = await invoke("search_entities", {
    query: "attention mechanism",
    entityType: "CodeUnit"
});
```

```rust
// Backend (Rust)
#[tauri::command]
async fn search_entities(query: String, entity_type: String) -> Result<Vec<Entity>, String> {
    // Access SQLite, call Python sidecar, etc.
    let entities = db.search(&query, &entity_type).await?;
    Ok(entities)
}
```

Tauri automatically serializes the arguments to JSON, passes them across the IPC boundary, deserializes them in Rust, runs the handler, serializes the result, and returns it to JavaScript. All type-safe on the Rust side.

### Tauri Commands vs. Events

**Commands** (invoke) are request-response: frontend asks, Rust responds.

**Events** are push-based: Rust emits an event, frontend listens.

```rust
// Rust emits an event
app_handle.emit("file-changed", FileChangePayload {
    path: "/src/main.rs".to_string(),
    change_type: "modified".to_string(),
})?;
```

```javascript
// Frontend listens
import { listen } from "@tauri-apps/api/event";

listen("file-changed", (event) => {
    console.log(`File changed: ${event.payload.path}`);
    refreshFileTree();
});
```

Events are used for: file watcher notifications, sidecar status changes, streaming LLM tokens, background task progress.

### Tauri Plugins

Tauri has a plugin system for extending the Rust backend:

- **tauri-plugin-pty:** Manages pseudo-terminals for the terminal emulator
- **tauri-plugin-fs:** Extended file system access
- **tauri-plugin-shell:** Spawning and managing child processes (the Python sidecar)
- **tauri-plugin-store:** Persistent key-value storage

Plugins are Rust crates that hook into Tauri's lifecycle and expose new commands to the frontend.

---

## 3. SolidJS: Fine-Grained Reactivity

### The Problem with Manual DOM Manipulation

In plain JavaScript, updating the UI means manually finding elements and changing them:

```javascript
document.getElementById("task-count").textContent = tasks.length;
document.getElementById("task-list").innerHTML = tasks.map(t => `<li>${t.title}</li>`).join("");
```

For a complex app with hundreds of interactive elements, this becomes unmaintainable. You lose track of which data affects which DOM elements.

### React's Approach: The Virtual DOM

React solves this by letting you declare what the UI *should look like* for a given state, and it figures out what to change:

```jsx
function TaskList({ tasks }) {
    return (
        <div>
            <h2>{tasks.length} tasks</h2>
            <ul>
                {tasks.map(t => <li key={t.id}>{t.title}</li>)}
            </ul>
        </div>
    );
}
```

When `tasks` changes, React:
1. Re-runs the entire component function
2. Produces a new virtual DOM tree (a lightweight JavaScript object)
3. **Diffs** the new virtual DOM against the previous one
4. Applies only the actual DOM changes

This diffing process adds overhead. For most apps, it's fine. For an app with a terminal emitting thousands of lines per second and an editor with real-time syntax highlighting, it can become a bottleneck.

### SolidJS's Approach: Signals and Direct DOM Updates

SolidJS eliminates the virtual DOM entirely. Instead of re-running component functions on every state change, it uses **signals** — reactive primitives that directly update the specific DOM nodes that depend on them.

```jsx
import { createSignal, For } from "solid-js";

function TaskList() {
    const [tasks, setTasks] = createSignal([]);

    return (
        <div>
            <h2>{tasks().length} tasks</h2>
            <ul>
                <For each={tasks()}>
                    {(task) => <li>{task.title}</li>}
                </For>
            </ul>
        </div>
    );
}
```

This looks similar to React, but what happens under the hood is very different:

1. `createSignal` creates a reactive value with a getter (`tasks()`) and setter (`setTasks`)
2. When the component first renders, SolidJS tracks which DOM nodes read which signals
3. The `<h2>` reads `tasks().length` → SolidJS notes: "this text node depends on `tasks`"
4. When `setTasks` is called with new data, SolidJS updates **only the text node and the list** — not the entire component
5. The component function itself **never re-runs** after initial render

### Signals: The Reactive Primitive

A signal is a value that notifies its dependents when it changes:

```jsx
const [count, setCount] = createSignal(0);

// This text node subscribes to count automatically
<span>{count()}</span>

// When count changes, ONLY this span is updated
setCount(5);  // The span now shows "5" — nothing else re-renders
```

### Derived State with Memos

A **memo** is a computed value that automatically updates when its dependencies change:

```jsx
const [tasks, setTasks] = createSignal([]);
const completedCount = createMemo(() => tasks().filter(t => t.done).length);

// completedCount automatically recalculates when tasks changes
<span>{completedCount()} completed</span>
```

### Effects: Side Effects from Reactive Changes

An **effect** runs when its tracked dependencies change:

```jsx
createEffect(() => {
    // This runs whenever tasks() changes
    console.log(`Task count: ${tasks().length}`);
    // Could also: save to localStorage, call an API, update a chart, etc.
});
```

### Why SolidJS for This Project

| Scenario | React | SolidJS |
|----------|-------|---------|
| Terminal output (1000 lines/sec) | Virtual DOM diff on every batch → visible lag | Direct DOM append → smooth |
| Streaming LLM tokens | Re-renders component per token | Updates only the text node where tokens append |
| File tree with 10,000 entries | Full diff of tree component on any change | Updates only the changed node |
| Editor cursor position updates | Re-renders editor wrapper on every movement | No component re-render — CodeMirror handles it |

SolidJS's fine-grained reactivity means the UI work is proportional to the *amount of change*, not the *size of the component tree*. For an app with high-frequency updates in multiple panels simultaneously, this is a significant advantage.

---

## 4. How the Frontend Communicates

### The Data Flow

```
User action (click, type, etc.)
        │
        ▼
SolidJS event handler
        │
        ▼
invoke("command", { args })  ──► Tauri IPC ──► Rust handler
                                                    │
                                                    ▼
                                              (possibly) HTTP to Python sidecar
                                                    │
                                                    ▼
                                              Result returns through Rust
        │                                           │
        ◄───────────── Tauri IPC ◄──────────────────┘
        │
        ▼
Update signal with new data
        │
        ▼
SolidJS automatically updates affected DOM nodes
```

### Resource Pattern (Async Data Fetching)

SolidJS has a `createResource` primitive for async data that integrates with the reactive system:

```jsx
const [searchQuery, setSearchQuery] = createSignal("");

const [results] = createResource(searchQuery, async (query) => {
    if (!query) return [];
    return await invoke("search_entities", { query });
});

// results() is automatically updated when searchQuery changes
// results.loading tells you if the fetch is in progress
<Show when={!results.loading} fallback={<Spinner />}>
    <ResultList items={results()} />
</Show>
```

When `searchQuery` changes, `createResource` automatically calls the fetch function and updates the reactive result. The UI shows a spinner while loading and results when done — all declarative, no manual state management.

---

## 5. The Build Pipeline

### Frontend Build (Vite + SolidJS)

**Vite** is the frontend build tool. It:
1. Compiles SolidJS JSX to optimized JavaScript
2. Processes TailwindCSS utility classes
3. Bundles everything into minimal JS/CSS files
4. Outputs to a `dist/` directory that Tauri embeds in the binary

### Rust Build (Cargo)

**Cargo** compiles the Rust source into a native binary. This binary:
- Contains the Tauri runtime
- Contains SQLite (statically linked via `rusqlite`)
- Contains all Tauri command handlers
- Embeds the frontend's `dist/` directory as static assets

### Final Application

```
my-workspace-app (single binary, ~5-10 MB)
├── Rust runtime (Tauri, SQLite, IPC handlers)
├── Embedded frontend assets (SolidJS bundle, ~200 KB)
└── Bundled Python sidecar (separate binary or script)
```

The Python sidecar is distributed alongside the main binary but runs as a separate process. It could be:
- A PyInstaller-packaged binary (self-contained, ~100-200 MB with ML libraries)
- A Python script that runs in a bundled virtual environment
- A Docker container (heavier but more isolated)

The trade-off between these options is discussed in the tech stack and risk documents.

---

## 6. TailwindCSS: Utility-First Styling

### The Idea

Instead of writing CSS classes with semantic names and custom rules:

```css
.sidebar-header {
    display: flex;
    align-items: center;
    padding: 0.5rem 1rem;
    background-color: #1e293b;
    border-bottom: 1px solid #334155;
}
```

You compose utility classes directly in HTML:

```html
<div class="flex items-center px-4 py-2 bg-slate-800 border-b border-slate-700">
```

Each utility class maps to exactly one CSS property. `flex` = `display: flex`. `px-4` = `padding-left: 1rem; padding-right: 1rem`. `bg-slate-800` = `background-color: #1e293b`.

### Why Tailwind for This Project

- **No naming decisions:** You don't waste time naming CSS classes. The utility classes describe what they do.
- **Dead code elimination:** Tailwind v4 scans your source files and only includes the CSS for classes you actually use. The final CSS bundle is tiny.
- **Consistent design system:** Tailwind's spacing scale (4, 8, 12, 16...), color palette, and typography scale ensure visual consistency without a design system document.
- **Pairs well with component frameworks:** In SolidJS (or React), each component's styles are co-located with its markup. No separate CSS files to maintain.

---

## Key Takeaways

1. **Rust gives you performance and safety.** Ownership and borrowing eliminate memory bugs at compile time. Zero-cost abstractions mean high-level code runs like hand-optimized C.

2. **Tauri bridges Rust and web UI.** WebViews render your frontend; Rust handles the backend. IPC (invoke + events) connects them with type-safe serialization.

3. **SolidJS skips the virtual DOM.** Signals track fine-grained dependencies. Only the specific DOM nodes that depend on changed data are updated — no diffing, no re-rendering entire component trees.

4. **The reactive model matters for this app.** Terminal output, LLM streaming, file tree updates, and editor annotations all generate high-frequency UI changes. Fine-grained reactivity keeps the UI smooth.

5. **The build pipeline produces a small, fast binary.** Vite bundles the frontend (~200 KB), Cargo compiles the Rust backend with embedded SQLite, and the result is a single binary under 10 MB.

---

## Further Reading

- [The Rust Book](https://doc.rust-lang.org/book/) — The official and best way to learn Rust from scratch
- [Rust by Example](https://doc.rust-lang.org/rust-by-example/) — Learn Rust through annotated code examples
- [Tauri v2 Guides](https://tauri.app/start/) — Official Tauri documentation
- [SolidJS Tutorial](https://www.solidjs.com/tutorial/introduction_basics) — Interactive tutorial covering signals, effects, and control flow
- [SolidJS vs React: A Detailed Comparison](https://www.solidjs.com/guides/comparison) — Official comparison of reactivity models
- [TailwindCSS Documentation](https://tailwindcss.com/docs) — Complete utility class reference
