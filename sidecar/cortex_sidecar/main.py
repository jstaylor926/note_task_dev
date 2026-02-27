import argparse
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import lancedb
import pyarrow as pa
import uvicorn
from fastapi import FastAPI

from cortex_sidecar.chunking import chunk_file, chunk_text
from cortex_sidecar.routes.health import router as health_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("cortex-sidecar")


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
    """Resolve the application data directory (platform-aware)."""
    # Check for explicit override via environment variable
    env_dir = os.environ.get("CORTEX_DATA_DIR")
    if env_dir:
        return Path(env_dir)

    # macOS: ~/Library/Application Support/com.cortex.app
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "com.cortex.app"
    # Linux: ~/.local/share/com.cortex.app
    elif sys.platform == "linux":
        return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "com.cortex.app"
    # Windows: %APPDATA%/com.cortex.app
    else:
        return Path(os.environ.get("APPDATA", Path.home())) / "com.cortex.app"


from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid

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

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize LanceDB and Embedding model on startup."""
    data_dir = get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    lancedb_path = data_dir / "lancedb"
    logger.info("Connecting to LanceDB at %s", lancedb_path)

    db = lancedb.connect(str(lancedb_path))
    schema = get_lancedb_schema()

    if "embeddings" not in db.list_tables().tables:
        logger.info("Creating 'embeddings' table")
        db.create_table("embeddings", schema=schema)

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

    logger.info("Sidecar ready")
    yield

    logger.info("Sidecar shutting down")

app = FastAPI(title="Cortex Sidecar", version="0.1.0", lifespan=lifespan)
app.include_router(health_router)

@app.post("/embed")
async def embed_text(req: EmbedRequest):
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
            "token_count": len(req.text.split()), # Rough estimate
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
    """Ingest a full file: chunk, embed, and store in one pass."""
    try:
        chunks = chunk_file(req.content, req.language, file_path=req.file_path)
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

            if chunk.entity_name and chunk.chunk_type in ("function", "class", "struct", "enum", "trait", "impl", "interface"):
                entities.append({
                    "name": chunk.entity_name,
                    "type": chunk.chunk_type,
                    "start_line": chunk.start_line,
                    "end_line": chunk.end_line,
                })

        table.add(records)
        logger.info("Ingested %d chunks from %s (%d entities)", len(records), req.file_path, len(entities))
        return {"chunk_count": len(records), "entities": entities}
    except Exception as e:
        logger.error("Ingest failed for %s: %s", req.file_path, e)
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/embeddings")
async def delete_embeddings(source_file: str):
    """Delete all embeddings for a given source file."""
    try:
        table = app.state.lancedb.open_table("embeddings")
        table.delete(f"source_file = '{source_file}'")
        logger.info("Deleted embeddings for %s", source_file)
        return {"status": "success", "source_file": source_file}
    except Exception as e:
        logger.error("Delete failed for %s: %s", source_file, e)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/search")
async def search_embeddings(query: str, limit: int = 5):
    try:
        if app.state.model:
            vector = app.state.model.encode(query).tolist()
        else:
            vector = [0.1] * 384
            
        table = app.state.lancedb.open_table("embeddings")
        results = table.search(vector).limit(limit).to_list()
        
        # Clean up results (remove vectors for response)
        for r in results:
            if "vector" in r:
                del r["vector"]
                
        return {"results": results}
    except Exception as e:
        logger.error("Search failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


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
