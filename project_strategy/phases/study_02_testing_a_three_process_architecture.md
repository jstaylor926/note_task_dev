# Study Guide: Testing a Three-Process Architecture

> This guide covers how to test an application built from three separate processes (Rust, Python, frontend) that communicate over IPC. It explains testing strategies at each level — unit, integration, end-to-end — and the specific challenges of testing across process boundaries.

---

## 1. The Testing Pyramid

The classic testing pyramid applies, but with adjustments for a multi-process architecture:

```
         /\
        /  \        End-to-End Tests
       / E2E\       (fewest — slow, brittle, but test real behavior)
      /------\
     /        \     Integration Tests
    / Integra- \    (moderate — test IPC, data flow across boundaries)
   /  tion      \
  /--------------\
 /                \  Unit Tests
/    Unit Tests    \ (most — fast, isolated, test logic in each process)
\__________________/
```

**Unit tests** verify logic within a single process. **Integration tests** verify communication across process boundaries. **End-to-end tests** verify complete user workflows through all three processes.

---

## 2. Unit Testing Each Process

### Rust Unit Tests (Cargo test)

Rust has built-in testing. Tests live alongside source code:

```rust
// src/db.rs
pub fn compute_content_hash(content: &[u8]) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_content_hash_deterministic() {
        let hash1 = compute_content_hash(b"hello world");
        let hash2 = compute_content_hash(b"hello world");
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_content_hash_changes_on_different_input() {
        let hash1 = compute_content_hash(b"hello world");
        let hash2 = compute_content_hash(b"hello worlds");
        assert_ne!(hash1, hash2);
    }
}
```

Run with `cargo test`. The `#[cfg(test)]` attribute means the test module is only compiled during testing, never in production.

**What to unit test in Rust:**
- Database initialization and migration logic
- Content hashing functions
- IPC command argument validation
- Sidecar health check parsing
- File path manipulation and ignore pattern matching

### Python Unit Tests (pytest)

```python
# tests/test_chunking.py
import pytest
from sidecar.services.chunking import smart_chunk_python

def test_function_extraction():
    code = '''
def hello():
    return "world"

def goodbye():
    return "farewell"
'''
    chunks = smart_chunk_python(code, "test.py")
    assert len(chunks) == 2
    assert chunks[0].name == "hello"
    assert chunks[1].name == "goodbye"

def test_class_with_methods():
    code = '''
class MyClass:
    def method_a(self):
        pass
    def method_b(self):
        pass
'''
    chunks = smart_chunk_python(code, "test.py")
    # Depending on strategy: 1 class chunk or 2 method chunks
    assert len(chunks) >= 1
```

Run with `uv run pytest` (or `pytest` if the venv is activated).

**What to unit test in Python:**
- tree-sitter parsing and chunk extraction
- Embedding generation (mock the model, test the pipeline)
- Entity extraction patterns (NER regex, action language detection)
- Session state payload composition
- LLM prompt construction
- Confidence score calculation

### Frontend Unit Tests (Vitest)

**Vitest** is a fast test runner built on Vite (same config, same transforms):

```typescript
// src/lib/search.test.ts
import { describe, it, expect } from 'vitest';
import { mergeSearchResults, deduplicateResults } from './search';

describe('mergeSearchResults', () => {
    it('combines vector and keyword results', () => {
        const vectorResults = [{ id: '1', score: 0.9 }, { id: '2', score: 0.8 }];
        const keywordResults = [{ id: '2', score: 0.7 }, { id: '3', score: 0.6 }];

        const merged = mergeSearchResults(vectorResults, keywordResults, 0.7);
        expect(merged).toHaveLength(3);
        // id '2' should have combined score
        expect(merged.find(r => r.id === '2').score).toBeGreaterThan(0.8);
    });
});
```

**What to unit test in the frontend:**
- Data transformation functions (search result merging, score calculation)
- Signal/store logic (state management)
- Utility functions (formatting, parsing)
- Component rendering (basic — that components mount without errors)

---

## 3. Integration Testing Across Process Boundaries

### The Challenge

Unit tests within a single process are straightforward — you call a function and check the result. But testing across process boundaries requires:

1. Starting the other process(es)
2. Sending a request through the IPC channel
3. Waiting for a response
4. Checking the result AND any side effects (database changes, file writes)

### Testing Rust ↔ Python (HTTP)

Since the Python sidecar is an HTTP server, integration tests can use standard HTTP testing:

```python
# tests/integration/test_search_pipeline.py
import pytest
import httpx
import asyncio

@pytest.fixture
async def sidecar():
    """Start the sidecar for testing."""
    import subprocess
    proc = subprocess.Popen(["uv", "run", "python", "main.py", "--port", "9401"])
    await asyncio.sleep(2)  # Wait for startup
    yield "http://127.0.0.1:9401"
    proc.terminate()

@pytest.mark.asyncio
async def test_index_and_search(sidecar, tmp_path):
    """Full pipeline: index a file, then search for its content."""
    # Create a test file
    test_file = tmp_path / "test.py"
    test_file.write_text('def calculate_attention(q, k, v):\n    return q @ k.T @ v\n')

    # Trigger indexing
    async with httpx.AsyncClient(base_url=sidecar) as client:
        response = await client.post("/api/v1/index/start", json={
            "directories": [str(tmp_path)]
        })
        assert response.status_code == 200

        # Wait for indexing to complete
        await asyncio.sleep(3)

        # Search for the function
        response = await client.post("/api/v1/search", json={
            "query": "attention mechanism",
            "limit": 5
        })
        assert response.status_code == 200
        results = response.json()
        assert len(results) > 0
        assert "calculate_attention" in results[0]["text"]
```

### Testing Frontend ↔ Rust (Tauri IPC)

Tauri provides a testing framework for IPC commands:

```rust
// src-tauri/tests/ipc_test.rs
#[cfg(test)]
mod tests {
    use tauri::test::{mock_builder, MockRuntime};

    #[test]
    fn test_health_check_command() {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![health_check])
            .build(tauri::generate_context!())
            .unwrap();

        // Simulate frontend invoke
        let result = tauri::test::invoke(&app, "health_check", ())
            .expect("health check should succeed");

        assert_eq!(result.tauri, "ok");
    }
}
```

For more realistic tests, you can also test the HTTP API directly (since all frontend calls go through Rust to the sidecar):

```bash
# Start the app in test mode, then call the sidecar API directly
curl http://127.0.0.1:9400/health
# {"status": "ok", "version": "0.1.0"}
```

### Database Integration Tests

Test that data flows correctly through the pipeline and persists:

```python
# tests/integration/test_session_state.py
async def test_session_capture_and_restore(sidecar, test_db):
    """Session state survives capture → kill → restore."""
    async with httpx.AsyncClient(base_url=sidecar) as client:
        # Set up some state
        await client.post("/api/v1/chat", json={"message": "Working on attention"})

        # Capture session
        response = await client.post("/api/v1/session/capture")
        assert response.status_code == 200
        capture_id = response.json()["session_id"]

        # Verify it's in the database
        response = await client.get("/api/v1/session/latest")
        state = response.json()
        assert state["id"] == capture_id
        assert "attention" in state["payload"]["active_chat_summary"].lower()
```

---

## 4. Mocking External Dependencies

### Mocking the LLM

LLM calls are slow, expensive, and non-deterministic. For testing, mock them:

```python
# tests/conftest.py
from unittest.mock import patch, AsyncMock

@pytest.fixture
def mock_llm():
    """Replace litellm.acompletion with a deterministic mock."""
    with patch("litellm.acompletion", new_callable=AsyncMock) as mock:
        mock.return_value = MockCompletion(
            content="The issue is a CUDA out of memory error. Reduce batch size.",
            usage={"prompt_tokens": 100, "completion_tokens": 50}
        )
        yield mock
```

This lets you test:
- That the correct context is being sent to the LLM
- That the response is parsed and stored correctly
- That error handling works when the LLM fails
- All without network calls or API costs

### Mocking the File System

For testing the file watcher and indexing pipeline, use temporary directories:

```python
@pytest.fixture
def project_dir(tmp_path):
    """Create a realistic temporary project structure."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "main.py").write_text("def main():\n    print('hello')\n")
    (src / "utils.py").write_text("def helper():\n    return 42\n")
    (tmp_path / ".gitignore").write_text("__pycache__\n*.pyc\n")
    return tmp_path
```

### Mocking the Embedding Model

Loading `all-MiniLM-L6-v2` takes seconds and uses hundreds of MB of RAM. For unit tests:

```python
@pytest.fixture
def mock_embedder():
    """Return fixed-length random vectors instead of real embeddings."""
    import numpy as np

    def fake_embed(texts):
        return [np.random.randn(384).tolist() for _ in texts]

    with patch("sidecar.services.embedding.embed_texts", side_effect=fake_embed):
        yield
```

For integration tests that need semantic accuracy, use the real model but test against a small corpus.

---

## 5. Performance Testing

### What to Measure

Each phase document specifies performance targets:

| Metric | Target | How to Measure |
|--------|--------|---------------|
| File change → embedding stored | < 5 seconds | Timer from file write to LanceDB upsert |
| Semantic search latency | < 500ms | Timer from API call to response |
| Session state capture | < 3 seconds | Timer from trigger to SQLite write |
| Terminal responsiveness | No visible lag | Manual assessment + profiling |
| Editor keystroke latency | < 16ms (60fps) | Chrome DevTools Performance tab |

### Benchmarking With Realistic Data

Performance on 10 files doesn't predict performance on 10,000 files. Create realistic test corpora:

```python
# tests/perf/generate_test_corpus.py
def generate_python_project(root, num_files=1000, lines_per_file=200):
    """Generate a realistic Python project for performance testing."""
    for i in range(num_files):
        module = root / f"module_{i:04d}.py"
        functions = []
        for j in range(lines_per_file // 20):  # ~10 functions per file
            functions.append(f"""
def function_{j}(x, y):
    \"\"\"Process {j} data.\"\"\"
    result = x * y + {j}
    return result
""")
        module.write_text("\n".join(functions))
```

### Profiling

**Python:** Use `cProfile` or `py-spy` to identify bottlenecks:
```bash
uv run python -m cProfile -o profile.out main.py
# Analyze with snakeviz
uv run snakeviz profile.out
```

**Rust:** Use `cargo flamegraph` to generate flame graphs:
```bash
cargo install flamegraph
cargo flamegraph --bin my-workspace
```

**Frontend:** Chrome DevTools Performance tab records everything: JavaScript execution, DOM updates, paint operations, layout thrashing.

---

## 6. Crash and Recovery Testing

Given the three-process architecture, crash testing is essential:

### Sidecar Crash Recovery

```python
async def test_sidecar_crash_recovery(app):
    """Kill the sidecar, verify Rust restarts it."""
    # Get current sidecar PID
    health = await invoke("health_check")
    assert health["sidecar"] == "ok"

    # Kill the sidecar process
    import signal, os
    os.kill(sidecar_pid, signal.SIGKILL)

    # Wait for Rust to detect and restart
    await asyncio.sleep(5)

    # Verify sidecar is back
    health = await invoke("health_check")
    assert health["sidecar"] == "ok"
```

### Database Crash Safety

```python
async def test_crash_during_session_capture(app, test_db):
    """Simulate crash during write — WAL should protect the database."""
    # Start a session capture
    # Kill the process mid-write (before COMMIT)
    # Restart
    # Verify: last committed state is intact, incomplete write was rolled back
    pass
```

### UI Recovery

Test that the frontend handles sidecar unavailability gracefully:
- Search returns "Service temporarily unavailable" instead of crashing
- Chat shows "AI assistant offline — reconnecting..."
- Indexing status shows "paused" during sidecar restart

---

## 7. Test Organization

```
project-root/
├── src-tauri/
│   └── tests/               # Rust integration tests
│       ├── ipc_test.rs
│       └── db_test.rs
│
├── src/
│   └── __tests__/           # Frontend unit tests (Vitest)
│       ├── search.test.ts
│       └── components/
│
├── sidecar/
│   └── tests/               # Python tests
│       ├── unit/
│       │   ├── test_chunking.py
│       │   ├── test_ner.py
│       │   └── test_session.py
│       ├── integration/
│       │   ├── test_pipeline.py
│       │   └── test_search.py
│       └── perf/
│           ├── test_indexing_speed.py
│           └── generate_test_corpus.py
│
└── tests/                    # Cross-process E2E tests
    ├── e2e_session_handoff.py
    └── e2e_search_workflow.py
```

### Running Tests

```bash
# All Rust tests
cargo test

# All Python tests
cd sidecar && uv run pytest

# All frontend tests
pnpm test

# Integration tests only
cd sidecar && uv run pytest tests/integration/

# Performance tests
cd sidecar && uv run pytest tests/perf/ -v --benchmark
```

---

## Key Takeaways

1. **Test each process in isolation first.** Unit tests within Rust, Python, and the frontend are fast, reliable, and should cover most logic.

2. **Integration tests cross process boundaries.** Test HTTP APIs directly. Start the sidecar, make requests, check results and side effects.

3. **Mock expensive dependencies.** LLM calls, embedding models, and large file systems should be mocked in unit tests. Use real dependencies in targeted integration tests.

4. **Performance test with realistic data.** 10 files won't expose the bugs that 10,000 files will. Generate test corpora at expected scale.

5. **Crash testing is non-optional.** The three-process model means any process can die independently. Test that the system recovers gracefully.

6. **WAL mode makes database crash testing straightforward.** Uncommitted transactions are automatically rolled back on restart.

---

## Further Reading

- [Cargo Test Documentation](https://doc.rust-lang.org/cargo/commands/cargo-test.html) — Rust testing reference
- [pytest Documentation](https://docs.pytest.org/) — Python testing framework
- [Vitest Documentation](https://vitest.dev/) — Frontend testing framework
- [Tauri Testing Guide](https://v2.tauri.app/develop/tests/) — Testing Tauri commands
- [py-spy](https://github.com/benfred/py-spy) — Python profiler for production code
