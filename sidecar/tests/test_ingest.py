"""Tests for the /ingest and DELETE /embeddings endpoints."""

import os
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Set test mode before importing app
os.environ["CORTEX_TEST_MODE"] = "1"
TEST_DATA_DIR = Path("./test_ingest_data")
os.environ["CORTEX_DATA_DIR"] = str(TEST_DATA_DIR)

from cortex_sidecar.main import app


@pytest.fixture(autouse=True)
def clean_data_dir():
    if TEST_DATA_DIR.exists():
        shutil.rmtree(TEST_DATA_DIR)
    TEST_DATA_DIR.mkdir(parents=True)
    os.environ["CORTEX_DATA_DIR"] = str(TEST_DATA_DIR)
    yield
    if TEST_DATA_DIR.exists():
        shutil.rmtree(TEST_DATA_DIR)


@pytest.fixture
def client(clean_data_dir):
    with TestClient(app) as c:
        yield c


def test_ingest_basic(client):
    """POST /ingest should chunk, embed, and store a file's content."""
    data = {
        "file_path": "src/main.rs",
        "content": "fn main() { println!(\"Hello, world!\"); }",
        "language": "rust",
        "source_type": "code",
        "git_branch": "main",
    }
    response = client.post("/ingest", json=data)
    assert response.status_code == 200
    body = response.json()
    assert body["chunk_count"] >= 1
    assert isinstance(body["entities"], list)


def test_ingest_empty_content(client):
    """POST /ingest with empty content should return 0 chunks."""
    data = {
        "file_path": "empty.txt",
        "content": "",
    }
    response = client.post("/ingest", json=data)
    assert response.status_code == 200
    assert response.json()["chunk_count"] == 0


def test_ingest_then_search(client):
    """Ingested content should be searchable."""
    client.post("/ingest", json={
        "file_path": "README.md",
        "content": "Cortex is an AI-augmented workspace for developers",
        "language": "markdown",
        "source_type": "docs",
    })

    response = client.get("/search", params={"query": "AI workspace", "limit": 5})
    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) > 0
    assert results[0]["source_file"] == "README.md"


def test_ingest_preserves_metadata(client):
    """Ingested chunks should have correct metadata fields."""
    client.post("/ingest", json={
        "file_path": "lib/utils.py",
        "content": "def helper(): pass",
        "language": "python",
        "source_type": "code",
        "git_branch": "feature-branch",
    })

    response = client.get("/search", params={"query": "helper", "limit": 1})
    results = response.json()["results"]
    assert len(results) > 0
    result = results[0]
    assert result["source_file"] == "lib/utils.py"
    assert result["language"] == "python"
    assert result["source_type"] == "code"
    assert result["git_branch"] == "feature-branch"


def test_delete_embeddings(client):
    """DELETE /embeddings should remove all embeddings for a file."""
    # Ingest a file
    client.post("/ingest", json={
        "file_path": "to_delete.rs",
        "content": "fn delete_me() { }",
    })

    # Verify it exists
    response = client.get("/search", params={"query": "delete_me", "limit": 5})
    assert len(response.json()["results"]) > 0

    # Delete it
    response = client.delete("/embeddings", params={"source_file": "to_delete.rs"})
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    # Verify it's gone — search should return no results for that file
    response = client.get("/search", params={"query": "delete_me", "limit": 5})
    results = response.json()["results"]
    matching = [r for r in results if r["source_file"] == "to_delete.rs"]
    assert len(matching) == 0


def test_delete_embeddings_nonexistent(client):
    """DELETE /embeddings for a non-existent file should succeed (no-op)."""
    response = client.delete("/embeddings", params={"source_file": "nonexistent.rs"})
    assert response.status_code == 200
    assert response.json()["status"] == "success"


# --- Search filter tests ---


def _ingest_test_files(client):
    """Helper: ingest multiple files with different metadata for filter testing."""
    client.post("/ingest", json={
        "file_path": "src/main.rs",
        "content": "fn main() { println!(\"Hello\"); }",
        "language": "rust",
        "source_type": "code",
        "git_branch": "main",
    })
    client.post("/ingest", json={
        "file_path": "src/lib/utils.py",
        "content": "def helper(): return 42",
        "language": "python",
        "source_type": "code",
        "git_branch": "main",
    })
    client.post("/ingest", json={
        "file_path": "README.md",
        "content": "# Cortex\nAn AI workspace for developers",
        "language": "markdown",
        "source_type": "docs",
        "git_branch": "main",
    })
    client.post("/ingest", json={
        "file_path": "tests/test_main.py",
        "content": "def test_something(): assert True",
        "language": "python",
        "source_type": "test",
        "git_branch": "main",
    })


def test_search_filter_by_language(client):
    """GET /search with language filter returns only matching language."""
    _ingest_test_files(client)

    response = client.get("/search", params={"query": "function code", "limit": 10, "language": "rust"})
    assert response.status_code == 200
    results = response.json()["results"]
    for r in results:
        assert r["language"] == "rust"


def test_search_filter_by_source_type(client):
    """GET /search with source_type filter returns only matching type."""
    _ingest_test_files(client)

    response = client.get("/search", params={"query": "code", "limit": 10, "source_type": "docs"})
    assert response.status_code == 200
    results = response.json()["results"]
    for r in results:
        assert r["source_type"] == "docs"


def test_search_filter_by_file_path_prefix(client):
    """GET /search with file_path_prefix returns only files under that path."""
    _ingest_test_files(client)

    response = client.get("/search", params={"query": "code", "limit": 10, "file_path_prefix": "src/"})
    assert response.status_code == 200
    results = response.json()["results"]
    for r in results:
        assert r["source_file"].startswith("src/")


def test_search_returns_relevance_score(client):
    """GET /search results include a relevance_score between 0 and 1."""
    _ingest_test_files(client)

    response = client.get("/search", params={"query": "helper function", "limit": 5})
    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) > 0
    for r in results:
        assert "relevance_score" in r
        assert 0.0 <= r["relevance_score"] <= 1.0


def test_search_returns_query(client):
    """GET /search response includes the original query string."""
    _ingest_test_files(client)

    response = client.get("/search", params={"query": "workspace", "limit": 5})
    assert response.status_code == 200
    assert response.json()["query"] == "workspace"


def test_search_no_filter_returns_all_languages(client):
    """GET /search without filters returns results from multiple languages."""
    _ingest_test_files(client)

    response = client.get("/search", params={"query": "code function", "limit": 10})
    assert response.status_code == 200
    results = response.json()["results"]
    languages = {r["language"] for r in results}
    # With mock vectors all identical, we should get results from multiple languages
    assert len(languages) > 1
