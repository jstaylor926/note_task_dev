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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize LanceDB on startup, cleanup on shutdown."""
    data_dir = get_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)

    lancedb_path = data_dir / "lancedb"
    logger.info("Connecting to LanceDB at %s", lancedb_path)

    db = lancedb.connect(str(lancedb_path))

    app.state.lancedb = db
    app.state.lancedb_schema = get_lancedb_schema()
    app.state.data_dir = data_dir

    logger.info("Sidecar ready")
    yield

    logger.info("Sidecar shutting down")


app = FastAPI(title="Cortex Sidecar", version="0.1.0", lifespan=lifespan)
app.include_router(health_router)


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
