import argparse
import logging
import os
import re
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import uuid

import lancedb
import pyarrow as pa
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from cortex_sidecar.chunking import chunk_file, chunk_text
from cortex_sidecar.routes.health import router as health_router
from cortex_sidecar.routes.chat import router as chat_router
from cortex_sidecar.agents.base import AgentManager
from cortex_sidecar.agents.research_daemon import ResearchDaemon

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("cortex-sidecar")

SAFE_FILTER_VALUE_RE = re.compile(r"^[A-Za-z0-9_./:\\\- ]+$")

# Global agent manager
agent_manager = AgentManager()


def sanitize_filter_value(field: str, value: str) -> str:
    if not value:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "INVALID_FILTER",
                    "message": f"{field} cannot be empty",
                    "retryable": False,
                }
            },
        )
    if not SAFE_FILTER_VALUE_RE.fullmatch(value):
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "INVALID_FILTER",
                    "message": f"{field} contains unsupported characters",
                    "retryable": False,
                }
            },
        )
    return value.replace("'", "''")


def get_lancedb_schema() -> pa.Schema:
    """Define the LanceDB embedding table schema."""
    return pa.schema(
        [
            pa.field("vector", pa.list_(pa.float32(), 384)),
            pa.field("text", pa.utf8()),
            pa.field("source_type", pa.utf8()),
            pa.field("source_file", pa.utf8()),
            pa.field("entity_id", pa.utf8()),
            pa.field("chunk_type", pa.utf8()),
            pa.field("chunk_index", pa.int32()),
            pa.field("language", pa.utf8()),
            pa.field("git_branch", pa.utf8()),
            pa.field("token_count", pa.int32()),
            pa.field("created_at", pa.utf8()),
            pa.field("updated_at", pa.utf8()),
        ]
    )


def get_data_dir() -> Path:
    """Resolve the application data directory (platform-aware).

    Returns:
        Path object pointing to the application data directory.
    """
    # Check for explicit override via environment variable
    env_dir = os.environ.get("CORTEX_DATA_DIR")
    if env_dir:
        return Path(env_dir)

    # macOS: ~/Library/Application Support/com.cortex.app
    if sys.platform == "darwin":
        return (
            Path.home() / "Library" / "Application Support" / "com.cortex.app"
        )
    # Linux: ~/.local/share/com.cortex.app
    elif sys.platform == "linux":
        return (
            Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
            / "com.cortex.app"
        )
    # Windows: %APPDATA%/com.cortex.app
    else:
        return Path(os.environ.get("APPDATA", Path.home())) / "com.cortex.app"

class EmbedRequest(BaseModel):
    text: str
    metadata: Optional[Dict[str, Any]] = None

class IngestRequest(BaseModel):
    file_path: str
    content: str
    language: str = "text"
    source_type: str = "unknown"
    git_branch: str = "main"

class SearchRequest(BaseModel):
    query: str
    limit: int = 5

class ExtractReferencesRequest(BaseModel):
    text: str
    known_symbols: List[str] = []

class ExtractCodeTodosRequest(BaseModel):
    source: str
    file_path: str = ""

class ExtractTerminalTasksRequest(BaseModel):
    output: str

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize LanceDB and Embedding model on startup.

    Args:
        app: The FastAPI application instance.
    """
    data_dir = get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    lancedb_path = data_dir / "lancedb"
    logger.info("Connecting to LanceDB at %s", lancedb_path)

    db = lancedb.connect(str(lancedb_path))
    schema = get_lancedb_schema()

    if "embeddings" not in db.list_tables().tables:
        logger.info("Creating 'embeddings' table")
        db.create_table("embeddings", schema=schema)
    else:
        logger.info("Using existing 'embeddings' table")

    app.state.lancedb = db
    app.state.lancedb_schema = schema
    app.state.data_dir = data_dir

    # Load embedding model
    # During tests, we might want to skip this or use a mock
    if os.environ.get("CORTEX_TEST_MODE") == "1":
        logger.info("Test mode: Using mock embedding model")
        app.state.model = None
    else:
        from sentence_transformers import SentenceTransformer
        logger.info("Loading sentence-transformer model...")
        app.state.model = SentenceTransformer("all-MiniLM-L6-v2")

    # Ensure vector index exists for faster ANN search.
    try:
        table = db.open_table("embeddings")
        try:
            table.create_index("vector")
        except TypeError:
            table.create_index(metric="cosine")
        logger.info("LanceDB vector index ready on embeddings.vector")
    except Exception as e:
        # Non-fatal: some LanceDB versions may auto-manage index state.
        logger.warning("Could not ensure LanceDB vector index: %s", e)

    # Register and start agents
    agent_manager.register_agent(ResearchDaemon())
    await agent_manager.start_all()

    logger.info("Sidecar ready")
    yield

    await agent_manager.stop_all()
    logger.info("Sidecar shutting down")

app = FastAPI(title="Cortex Sidecar", version="0.1.0", lifespan=lifespan)
app.include_router(health_router)
app.include_router(chat_router)

@app.post("/embed")
async def embed_text(req: EmbedRequest):
    """Embed a single piece of text and store it in LanceDB.

    Args:
        req: The EmbedRequest containing text and optional metadata.

    Returns:
        A dictionary with status and the generated entity_id.

    Raises:
        HTTPException: If embedding or storage fails.
    """
    try:
        if app.state.model:
            vector = app.state.model.encode(req.text).tolist()
        else:
            # Mock vector for tests
            vector = [0.1] * 384

        table = app.state.lancedb.open_table("embeddings")

        metadata = req.metadata or {}

        record = {
            "vector": vector,
            "text": req.text,
            "source_type": metadata.get("source_type", "unknown"),
            "source_file": metadata.get("source_file", "unknown"),
            "entity_id": metadata.get("entity_id", str(uuid.uuid4())),
            "chunk_type": metadata.get("chunk_type", "text"),
            "chunk_index": metadata.get("chunk_index", 0),
            "language": metadata.get("language", "text"),
            "git_branch": metadata.get("git_branch", "main"),
            "token_count": len(req.text.split()),  # Rough estimate
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }

        table.add([record])
        return {"status": "success", "entity_id": record["entity_id"]}
    except Exception as e:
        logger.error("Embedding failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ingest")
async def ingest_file(req: IngestRequest):
    """Ingest a full file: chunk, embed, and store in one pass.

    Args:
        req: The IngestRequest containing file content and metadata.

    Returns:
        A dictionary with chunk_count and a list of extracted entities.

    Raises:
        HTTPException: If ingestion fails.
    """
    try:
        chunks = chunk_file(req.content, req.language, file_path=req.file_path, source_type=req.source_type)
        if not chunks:
            return {"chunk_count": 0, "entities": []}

        table = app.state.lancedb.open_table("embeddings")
        now = datetime.now().isoformat()
        records = []
        entities = []

        for chunk in chunks:
            # Prepend context header to text for richer embeddings
            embed_text = chunk.text
            if chunk.context_header:
                embed_text = chunk.context_header + "\n" + chunk.text

            if app.state.model:
                vector = app.state.model.encode(embed_text).tolist()
            else:
                vector = [0.1] * 384

            records.append({
                "vector": vector,
                "text": chunk.text,
                "source_type": req.source_type,
                "source_file": req.file_path,
                "entity_id": str(uuid.uuid4()),
                "chunk_type": chunk.chunk_type,
                "chunk_index": chunk.index,
                "language": req.language,
                "git_branch": req.git_branch,
                "token_count": len(chunk.text.split()),
                "created_at": now,
                "updated_at": now,
            })

            is_named_entity = (
                chunk.entity_name
                and chunk.chunk_type in (
                    "function", "class", "struct", "enum", "trait", "impl",
                    "interface"
                )
            )
            if is_named_entity:
                entities.append({
                    "name": chunk.entity_name,
                    "type": chunk.chunk_type,
                    "start_line": chunk.start_line,
                    "end_line": chunk.end_line,
                })

        table.add(records)
        logger.info(
            "Ingested %d chunks from %s (%d entities)",
            len(records), req.file_path, len(entities)
        )
        return {"chunk_count": len(records), "entities": entities}
    except Exception as e:
        logger.error("Ingest failed for %s: %s", req.file_path, e)
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/embeddings")
async def delete_embeddings(source_file: str):
    """Delete all embeddings for a given source file.

    Args:
        source_file: The path of the file to delete embeddings for.

    Returns:
        A dictionary with status and the source_file.

    Raises:
        HTTPException: If deletion fails.
    """
    try:
        source_file = sanitize_filter_value("source_file", source_file)
        table = app.state.lancedb.open_table("embeddings")
        table.delete(f"source_file = '{source_file}'")
        logger.info("Deleted embeddings for %s", source_file)
        return {"status": "success", "source_file": source_file}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Delete failed for %s: %s", source_file, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/search")
async def search_embeddings(
    query: str,
    limit: int = 10,
    language: Optional[str] = None,
    source_type: Optional[str] = None,
    chunk_type: Optional[str] = None,
    file_path_prefix: Optional[str] = None,
    git_branch: Optional[str] = None,
):
    """Search for similar embeddings in LanceDB.

    Args:
        query: The natural language search query.
        limit: Maximum number of results to return.
        language: Filter by programming language.
        source_type: Filter by source type (code, docs, etc.).
        chunk_type: Filter by chunk type (function, class, etc.).
        file_path_prefix: Filter by file path prefix.
        git_branch: Filter by git branch.

    Returns:
        A dictionary with search results and the original query.

    Raises:
        HTTPException: If search fails.
    """
    try:
        if app.state.model:
            vector = app.state.model.encode(query).tolist()
        else:
            vector = [0.1] * 384

        table = app.state.lancedb.open_table("embeddings")

        # Build filter conditions
        conditions = []
        if language:
            language = sanitize_filter_value("language", language)
            conditions.append(f"language = '{language}'")
        if source_type:
            source_type = sanitize_filter_value("source_type", source_type)
            conditions.append(f"source_type = '{source_type}'")
        if chunk_type:
            chunk_type = sanitize_filter_value("chunk_type", chunk_type)
            conditions.append(f"chunk_type = '{chunk_type}'")
        if git_branch:
            git_branch = sanitize_filter_value("git_branch", git_branch)
            conditions.append(f"git_branch = '{git_branch}'")
        if file_path_prefix:
            file_path_prefix = sanitize_filter_value("file_path_prefix", file_path_prefix)
            conditions.append(f"source_file LIKE '{file_path_prefix}%'")

        search = table.search(vector).limit(limit)
        if conditions:
            where_clause = " AND ".join(conditions)
            search = search.where(where_clause)

        results = search.to_list()

        # Clean up results and add relevance score
        for r in results:
            # LanceDB returns _distance (lower = more similar)
            distance = r.pop("_distance", None)
            r.pop("vector", None)
            # Convert distance to a 0-1 relevance score (1 = most relevant)
            if distance is not None:
                r["relevance_score"] = round(max(0.0, 1.0 - distance), 4)
            else:
                r["relevance_score"] = 0.0

        return {"results": results, "query": query}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Search failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract-references")
async def extract_references_endpoint(req: ExtractReferencesRequest):
    """Extract references (URLs, file paths, code symbols, action items) from text.

    Args:
        req: The ExtractReferencesRequest containing text and optional known symbols.

    Returns:
        A dictionary with a list of extracted references.
    """
    from dataclasses import asdict
    from cortex_sidecar.reference_extraction import extract_references

    refs = extract_references(req.text, req.known_symbols)
    return {"references": [asdict(r) for r in refs]}


@app.post("/extract-code-todos")
async def extract_code_todos_endpoint(req: ExtractCodeTodosRequest):
    """Extract TODO/FIXME comments from source code.

    Args:
        req: The ExtractCodeTodosRequest containing source code and optional file path.

    Returns:
        A dictionary with a list of extracted code TODOs.
    """
    from dataclasses import asdict
    from cortex_sidecar.reference_extraction import extract_code_todos

    todos = extract_code_todos(req.source)
    return {"todos": [asdict(t) for t in todos]}


@app.post("/extract-terminal-tasks")
async def extract_terminal_tasks_endpoint(req: ExtractTerminalTasksRequest):
    """Extract actionable tasks from terminal error output.

    Args:
        req: The ExtractTerminalTasksRequest containing terminal output.

    Returns:
        A dictionary with a list of extracted terminal tasks.
    """
    from dataclasses import asdict
    from cortex_sidecar.terminal_extraction import extract_terminal_tasks

    tasks = extract_terminal_tasks(req.output)
    return {"tasks": [asdict(t) for t in tasks]}


def main():
    parser = argparse.ArgumentParser(description="Cortex Python Sidecar")
    parser.add_argument("--port", type=int, default=9400, help="Port to listen on")
    parser.add_argument(
        "--host", type=str, default="127.0.0.1", help="Host to bind to"
    )
    args = parser.parse_args()

    logger.info("Starting sidecar on %s:%d", args.host, args.port)
    uvicorn.run(
        "cortex_sidecar.main:app",
        host=args.host,
        port=args.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
