import logging

from fastapi import APIRouter, Request

logger = logging.getLogger("cortex-sidecar")
router = APIRouter()


@router.get("/health")
async def health_check(request: Request):
    """Health check endpoint called by the Rust backend.

    Returns sidecar status and LanceDB connectivity.
    """
    lancedb_status = "unknown"

    try:
        db = request.app.state.lancedb
        if db is not None:
            # Verify LanceDB is accessible by listing tables
            _ = db.table_names()
            lancedb_status = "ok"
        else:
            lancedb_status = "not initialized"
    except Exception as e:
        logger.error("LanceDB health check failed: %s", e)
        lancedb_status = f"error: {e}"

    return {
        "status": "ok",
        "version": "0.1.0",
        "lancedb": lancedb_status,
    }
