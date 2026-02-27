import os
import shutil
from pathlib import Path
import pytest
import lancedb
import pyarrow as pa
from cortex_sidecar.main import get_lancedb_schema, get_data_dir

TEST_DATA_DIR = Path("./test_data")

@pytest.fixture
def clean_data_dir():
    if TEST_DATA_DIR.exists():
        shutil.rmtree(TEST_DATA_DIR)
    TEST_DATA_DIR.mkdir(parents=True)
    os.environ["CORTEX_DATA_DIR"] = str(TEST_DATA_DIR)
    yield TEST_DATA_DIR
    if TEST_DATA_DIR.exists():
        shutil.rmtree(TEST_DATA_DIR)
    del os.environ["CORTEX_DATA_DIR"]

def test_get_lancedb_schema():
    schema = get_lancedb_schema()
    assert isinstance(schema, pa.Schema)
    assert "vector" in schema.names
    assert "text" in schema.names
    assert schema.field("vector").type.value_type == pa.float32()

def test_get_data_dir(clean_data_dir):
    data_dir = get_data_dir()
    assert data_dir == TEST_DATA_DIR

def test_db_initialization(clean_data_dir):
    # This test simulates what happens during the FastAPI lifespan
    # but we'll test the core logic.
    from fastapi import FastAPI
    from cortex_sidecar.main import lifespan
    import asyncio
    
    app = FastAPI()
    
    async def run_lifespan():
        async with lifespan(app):
            assert hasattr(app.state, "lancedb")
            assert isinstance(app.state.lancedb, lancedb.db.LanceDBConnection)
            
            # Check if table 'embeddings' exists (we'll implement this)
            table_names = app.state.lancedb.list_tables().tables
            assert "embeddings" in table_names
            
            table = app.state.lancedb.open_table("embeddings")
            assert table.schema == get_lancedb_schema()

def test_main_entry_point(monkeypatch):
    import cortex_sidecar.main
    from unittest.mock import MagicMock
    
    mock_run = MagicMock()
    monkeypatch.setattr("uvicorn.run", mock_run)
    monkeypatch.setattr("sys.argv", ["main.py", "--port", "9500"])
    
    cortex_sidecar.main.main()
    
    # Check if uvicorn.run was called with the expected port
    args, kwargs = mock_run.call_args
    assert kwargs["port"] == 9500
