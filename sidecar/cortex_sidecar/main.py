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
