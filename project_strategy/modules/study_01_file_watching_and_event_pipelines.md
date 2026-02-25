# Study Guide: File Watching, Debouncing, and Event-Driven Pipelines

> This guide explains how the context engine stays in sync with your filesystem in real time — detecting file changes, avoiding redundant work, and flowing data through multi-stage processing pipelines. These patterns underpin everything from embedding generation to session state capture.

---

## 1. File Watching: How Computers Detect File Changes

### The Naive Approach: Polling

The simplest way to detect file changes is polling — check every file every N seconds to see if it changed:

```python
import time, os

def poll_directory(path, interval=2):
    known = {}
    while True:
        for f in os.listdir(path):
            mtime = os.path.getmtime(f)
            if f not in known or known[f] != mtime:
                print(f"Changed: {f}")
                known[f] = mtime
        time.sleep(interval)
```

This works but wastes CPU cycles constantly scanning files that haven't changed. For a workspace with thousands of files, polling every 2 seconds means thousands of `stat()` system calls — even when nothing has changed.

### The Better Approach: OS-Level File System Notifications

Modern operating systems provide kernel-level APIs that *notify* your application when files change, instead of requiring you to ask:

| OS | API | How It Works |
|----|-----|-------------|
| Linux | **inotify** | Your program registers interest in specific directories. The kernel sends events (IN_MODIFY, IN_CREATE, IN_DELETE) through a file descriptor when changes occur. |
| macOS | **FSEvents** | A framework-level API that reports changes to directories. Batches events and delivers them with slight delay. |
| Windows | **ReadDirectoryChangesW** | Win32 API that monitors a directory for changes and delivers events asynchronously. |

These APIs are **event-driven** — your program sleeps until the OS wakes it up with a change notification. Zero CPU usage during idle periods.

### Libraries That Wrap These APIs

Writing directly against inotify or FSEvents is platform-specific and complex. Libraries abstract the platform differences:

**In Rust: `notify`**
The Tauri backend uses the `notify` crate, which wraps inotify (Linux), FSEvents (macOS), and ReadDirectoryChangesW (Windows) behind a unified Rust API.

```rust
use notify::{Watcher, RecursiveMode, watcher};

let (tx, rx) = channel();
let mut watcher = watcher(tx, Duration::from_millis(300))?;
watcher.watch("/path/to/project", RecursiveMode::Recursive)?;

for event in rx {
    match event {
        Ok(event) => handle_file_change(event),
        Err(e) => log_error(e),
    }
}
```

**In Python: `watchdog`**
If the sidecar needed its own file watching (it doesn't in this architecture — Rust handles it and notifies Python), Python's `watchdog` library provides similar cross-platform watching.

### What Events Look Like

A typical file change event contains:

```
Event {
    kind: Modify(Data(Content)),   // What happened
    paths: ["/project/src/train.py"],  // Which file(s)
    timestamp: 2024-02-24T14:32:01Z,   // When
}
```

Event kinds include: Create, Modify (content or metadata), Remove, Rename. The watcher delivers these as a stream that your application processes one by one.

---

## 2. Debouncing: Taming the Event Storm

### The Problem

When you save a file in your editor, the OS might fire *multiple* events for what feels like a single action:

```
14:32:01.001  Modify: train.py    ← Editor writes temporary data
14:32:01.003  Modify: train.py    ← Editor writes more data
14:32:01.005  Modify: train.py    ← Editor flushes to disk
14:32:01.008  Modify: train.py    ← Editor updates metadata
```

Four events for one save. If each event triggers the full embedding pipeline (parse → chunk → embed → store), you'd process the same file four times in 7 milliseconds. This wastes CPU and can cause race conditions (what if the first run reads the file while the editor is still writing?).

### The Solution: Debouncing

**Debouncing** means: "wait for the events to stop coming before acting." The system sets a timer when the first event arrives. If more events arrive for the same file before the timer expires, the timer resets. Only when the timer expires (no new events for N milliseconds) does processing begin.

```
Event 1 (t=0ms)    → start timer (300ms)
Event 2 (t=2ms)    → reset timer (300ms from now)
Event 3 (t=4ms)    → reset timer (300ms from now)
Event 4 (t=7ms)    → reset timer (300ms from now)
... silence ...
Timer expires (t=307ms) → NOW process the file
```

Result: one processing run instead of four, and the file is guaranteed to be in its final state.

### Implementation Pattern

```rust
use std::collections::HashMap;
use tokio::time::{sleep, Duration, Instant};

struct Debouncer {
    pending: HashMap<PathBuf, Instant>,
    delay: Duration,
}

impl Debouncer {
    fn file_changed(&mut self, path: PathBuf) {
        // Always update the timestamp, resetting the timer
        self.pending.insert(path, Instant::now());
    }

    fn get_ready_files(&mut self) -> Vec<PathBuf> {
        let now = Instant::now();
        let ready: Vec<PathBuf> = self.pending.iter()
            .filter(|(_, timestamp)| now.duration_since(**timestamp) >= self.delay)
            .map(|(path, _)| path.clone())
            .collect();
        for path in &ready {
            self.pending.remove(path);
        }
        ready
    }
}
```

The context engine uses a 300ms debounce window — long enough to absorb multi-event saves, short enough to feel responsive.

### Debouncing vs. Throttling

These are often confused:

**Debouncing:** Wait for silence. Process only after events stop for N ms. Good when you want the *final* state.

**Throttling:** Process at most once every N ms, regardless of how many events arrive. Good when you want *periodic* updates during a sustained stream.

The file ingestion pipeline uses **debouncing** (wait for the save to finish). The UI might use **throttling** for displaying indexing progress (update the progress bar at most every 500ms, not on every chunk).

---

## 3. Content Hashing: Avoiding Redundant Work

### The Problem

Debouncing reduces duplicate processing for rapid-fire events, but there's another source of redundant work: files that are "modified" without actually changing content. This happens when:

- You open and save a file without editing it
- An editor reformats a file identically
- A build tool touches files (updating modification timestamps) without changing content
- Git operations (checkout, rebase) modify timestamps

### SHA-256 Content Hashing

The system computes a **SHA-256 hash** of each file's content. SHA-256 produces a 256-bit (64 hex character) digest that's effectively unique to the input content.

```
"def hello(): pass\n"  →  "a1b2c3d4e5f6...64 characters total"
```

If the content hasn't changed, the hash is identical, and the system skips re-processing:

```python
import hashlib

def sha256_of_file(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

def should_reindex(path: str, stored_hash: str) -> bool:
    current_hash = sha256_of_file(path)
    return current_hash != stored_hash
```

### Two Levels of Hashing

The context engine uses hashing at two granularities:

**File-level hash:** Stored in the `file_index` SQLite table. If the file hash hasn't changed, skip the entire file. Fast check — one hash computation per file.

**Chunk-level hash:** After parsing the file into chunks, each chunk's content is hashed individually. If a function's hash matches the stored chunk hash, skip re-embedding that function. This means editing one function in a 50-function file re-embeds only the changed function.

### Why SHA-256?

SHA-256 is a **cryptographic hash function**. It's designed to be:
- **Deterministic:** Same input always produces same output
- **Collision-resistant:** Practically impossible for two different inputs to produce the same hash. The birthday paradox gives a collision probability after about 2^128 hashes — a number so large it's computationally infeasible.
- **Fast:** Computing the hash of a typical source file takes microseconds

For this use case, a faster non-cryptographic hash (like xxHash) would also work. SHA-256 is chosen because it's universally available, well-understood, and the speed difference is negligible for file-sized inputs.

---

## 4. Event-Driven Pipelines

### What Is a Pipeline?

A **pipeline** is a sequence of processing stages where the output of one stage becomes the input of the next:

```
File Change → Debounce → Hash Check → Parse → Chunk → Embed → Store → Extract Entities → Update Graph
```

### Push vs. Pull Pipelines

**Pull pipelines** (like Unix pipes): The final stage pulls data through the system. Each stage blocks waiting for the previous stage to produce output. Simple but synchronous.

```bash
cat file.py | parse | chunk | embed > vectors.db
```

**Push pipelines** (event-driven): The first stage pushes data forward. Each stage processes asynchronously and pushes results to the next stage. The context engine uses this model.

```
File watcher emits event
    → Debouncer receives and buffers
        → Hash checker receives debounced event, decides to process or skip
            → Parser receives and produces AST
                → Chunker receives AST and produces chunks
                    → Embedder receives chunks and produces vectors
                        → Storage receives vectors and writes to LanceDB
```

### Async Stages and Back-Pressure

Each pipeline stage operates asynchronously. But what happens when one stage is slower than others?

**Example:** The file watcher detects 100 file changes. The embedder can only process 2 files per second (embedding is CPU-intensive). Without controls, the system would queue all 100 files, consuming memory and starving the UI of CPU resources.

**Back-pressure** is the solution: slower stages signal upstream stages to slow down. Implementation approaches:

**Bounded queues:** Each stage has a queue with a maximum size. When the queue is full, the upstream stage blocks (or drops) instead of adding more work.

```
[File Watcher] → Queue(max=50) → [Parser] → Queue(max=20) → [Embedder] → Queue(max=10) → [Storage]
```

**Batch processing:** Accumulate items and process them in batches at fixed intervals. The context engine uses this: "process every 2 seconds or when 10 changes accumulate, whichever comes first."

**CPU throttling:** The embedding thread pool is bounded (default: 2 threads). Even if 100 files are queued, only 2 are being embedded at any time, leaving CPU available for the editor and terminal.

---

## 5. Batching: Amortizing Overhead

### Why Batch?

Some operations have high per-call overhead but can process multiple items cheaply:

**Embedding:** Loading the model and warming up the GPU/CPU takes time. But once the model is ready, embedding 32 chunks is only marginally slower than embedding 1 chunk. The overhead is amortized across the batch.

```
Single embedding:     Load model (50ms) + Embed 1 chunk (5ms)  = 55ms per chunk
Batch of 32:          Load model (50ms) + Embed 32 chunks (40ms) = 2.8ms per chunk
```

**Database writes:** SQLite transactions have overhead (journal sync, lock acquisition). Writing 50 rows in one transaction is much faster than 50 separate single-row transactions.

```python
# Slow: 50 transactions
for chunk in chunks:
    db.execute("INSERT INTO ...", chunk)
    db.commit()

# Fast: 1 transaction
db.begin()
for chunk in chunks:
    db.execute("INSERT INTO ...", chunk)
db.commit()
```

### The Batch-and-Flush Pattern

The context engine uses a "batch-and-flush" pattern:

1. Incoming items are added to a batch buffer
2. When the buffer reaches a size threshold (e.g., 32 chunks) OR a time threshold (e.g., 2 seconds since last flush), the batch is processed
3. The buffer is cleared

```python
class BatchProcessor:
    def __init__(self, max_size=32, max_wait_seconds=2):
        self.buffer = []
        self.last_flush = time.time()
        self.max_size = max_size
        self.max_wait = max_wait_seconds

    def add(self, item):
        self.buffer.append(item)
        if len(self.buffer) >= self.max_size or self.time_to_flush():
            self.flush()

    def time_to_flush(self):
        return time.time() - self.last_flush >= self.max_wait

    def flush(self):
        if self.buffer:
            process_batch(self.buffer)
            self.buffer = []
            self.last_flush = time.time()
```

The size threshold handles bursty workloads (many files changed at once). The time threshold handles trickle workloads (one file changed, but we shouldn't wait forever for more).

---

## 6. Ignore Patterns: Filtering Noise

### Why Ignore Files?

A typical project directory contains many files that shouldn't be indexed:

- `node_modules/` — thousands of third-party files you don't need to search
- `__pycache__/` — compiled Python bytecode
- `.git/` — git internal files (changed on every commit)
- `dist/`, `build/` — build output that's regenerated from source
- `*.min.js` — minified JavaScript (meaningless to embed)
- Binary files (images, compiled binaries, datasets)

Indexing these wastes storage, CPU, and pollutes search results with irrelevant content.

### Glob Patterns

The system uses **glob patterns** (the same syntax as `.gitignore`) to specify what to ignore:

```
node_modules/**    → ignore everything under node_modules/
*.pyc              → ignore all .pyc files
__pycache__/**     → ignore all pycache directories
.git/**            → ignore git internals
*.min.js           → ignore minified JavaScript
dist/**            → ignore build output
```

The `**` pattern matches any depth of subdirectories. `*` matches any characters within a single path component.

### Layered Ignore Rules

Ignore patterns come from multiple sources, applied in order:

1. **Built-in defaults:** `.git/`, common binary extensions
2. **`.gitignore`:** The project's existing ignore rules (already maintained by the user)
3. **`.contextignore`:** A custom file specific to this tool, for ignoring things that git tracks but shouldn't be indexed (e.g., large data files, generated code)
4. **Per-profile overrides:** Different workspace profiles might ignore different directories

---

## 7. The Full Ingestion Pipeline, End to End

Putting every concept together, here's what happens when you save `train.py`:

```
14:32:01.005  OS fires Modify event for train.py
                │
14:32:01.005  File watcher receives event
                │
                ▼
14:32:01.005  Debouncer starts 300ms timer for train.py
                │
14:32:01.008  OS fires another Modify event (metadata update)
                │
14:32:01.008  Debouncer resets timer to 300ms from now
                │
                ... 300ms of silence ...
                │
14:32:01.308  Debouncer timer expires → emit "train.py changed"
                │
                ▼
14:32:01.310  Ignore check: train.py matches no ignore patterns → proceed
                │
                ▼
14:32:01.311  Hash check: SHA-256 of train.py content
              Compare with stored hash in file_index
              → Different! File content actually changed.
                │
                ▼
14:32:01.312  Add to batch buffer (currently 3 other files pending)
              Buffer size (4) < threshold (10) and timer hasn't expired
              → Wait for more
                │
                ... 1.7 seconds later, time threshold reached ...
                │
14:32:03.012  Batch flush: process 4 files together
                │
                ▼
14:32:03.015  Parse train.py with tree-sitter → AST
              Extract top-level constructs:
              → class Trainer (3 methods)
              → function main
                │
                ▼
14:32:03.020  Smart chunking: 5 chunks produced
              Hash each chunk, compare with stored chunk hashes:
              → Chunk "Trainer.train_epoch" hash changed (you edited this method)
              → 4 other chunks unchanged → skip re-embedding
                │
                ▼
14:32:03.025  Embed 1 changed chunk (batch with chunks from other 3 files)
              sentence-transformers produces 384-dim vector
                │
                ▼
14:32:03.080  Upsert vector to LanceDB (replace old embedding for this chunk)
                │
                ▼
14:32:03.085  Update file_index in SQLite (new hash, timestamp)
                │
                ▼
14:32:03.090  Entity extraction (async, lower priority):
              → Update CodeUnit entity for Trainer.train_epoch
              → Check for new TODO comments
              → Check for new import statements
                │
                ▼
14:32:03.120  Auto-linker runs on updated entity:
              → Semantic similarity check against existing entities
              → Any new links? Store in entity_links
                │
                ▼
14:32:03.150  Emit frontend event: "indexing complete for train.py"
              → UI updates file tree indicator, search index is current
```

Total time from save to fully indexed: **~2.1 seconds** (dominated by the debounce wait and batch wait). The actual processing takes ~140ms.

---

## Key Takeaways

1. **OS-level file watching beats polling.** The kernel notifies your app of changes — zero CPU during idle periods.

2. **Debouncing prevents redundant processing.** Wait for the event storm to settle before processing. 300ms is the sweet spot for file saves.

3. **Content hashing catches "phantom" changes.** A file's modification timestamp can change without its content changing. SHA-256 catches this.

4. **Two-level hashing (file + chunk) minimizes work.** Edit one function in a 50-function file? Re-embed one function, not fifty.

5. **Event-driven pipelines with back-pressure keep the system responsive.** Bounded queues and CPU throttling prevent background indexing from starving the UI.

6. **Batching amortizes overhead.** Process 32 chunks in one embedding call instead of 32 separate calls. Write 50 rows in one database transaction instead of 50.

7. **Layered ignore patterns reduce noise.** .gitignore + .contextignore + per-profile overrides keep irrelevant files out of the index.

---

## Further Reading

- [The `notify` Crate (Rust)](https://docs.rs/notify/latest/notify/) — Cross-platform file watching
- [inotify(7) Man Page](https://man7.org/linux/man-pages/man7/inotify.7.html) — Linux's file notification system
- [Debouncing and Throttling Explained](https://css-tricks.com/debouncing-throttling-explained-examples/) — Visual explanation with JavaScript examples
- [SQLite Performance Tuning](https://www.sqlite.org/lang_transaction.html) — Why batching writes in transactions matters
