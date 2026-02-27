import os
import shutil
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

# Set test mode before importing app
os.environ["CORTEX_TEST_MODE"] = "1"
TEST_DATA_DIR = Path("./test_api_data")
os.environ["CORTEX_DATA_DIR"] = str(TEST_DATA_DIR)

from cortex_sidecar.main import app

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

@pytest.fixture(autouse=True)
def clean_data_dir():
    if TEST_DATA_DIR.exists():
        shutil.rmtree(TEST_DATA_DIR)
    TEST_DATA_DIR.mkdir(parents=True)
    yield
    if TEST_DATA_DIR.exists():
        shutil.rmtree(TEST_DATA_DIR)

def test_embed_endpoint(client):
    # Mock data for embedding
    data = {
        "text": "Cortex is an AI workspace.",
        "metadata": {
            "source_file": "README.md",
            "chunk_index": 0
        }
    }
    response = client.post("/embed", json=data)
    assert response.status_code == 200
    assert "status" in response.json()
    assert response.json()["status"] == "success"

def test_search_endpoint(client):
    # First embed something to search
    client.post("/embed", json={"text": "Cortex workspace"})
    
    params = {"query": "AI workspace", "limit": 5}
    response = client.get("/search", params=params)
    assert response.status_code == 200
    assert "results" in response.json()
    assert isinstance(response.json()["results"], list)
    assert len(response.json()["results"]) > 0
