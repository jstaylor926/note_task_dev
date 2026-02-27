"""Tests for the chunking module."""

from cortex_sidecar.chunking import Chunk, chunk_text


def test_chunk_text_basic():
    text = "one two three four five six seven eight nine ten"
    chunks = chunk_text(text, chunk_size=5, overlap=2)

    # 10 words, chunk_size=5, overlap=2 -> step=3 -> chunks at [0:5], [3:8], [6:10]
    assert len(chunks) == 3
    assert chunks[0].index == 0
    assert chunks[0].text == "one two three four five"
    assert chunks[1].index == 1
    assert chunks[1].text == "four five six seven eight"
    assert chunks[2].index == 2
    assert chunks[2].text == "seven eight nine ten"


def test_chunk_text_empty():
    assert chunk_text("") == []
    assert chunk_text("   ") == []


def test_chunk_text_single_chunk():
    text = "hello world"
    chunks = chunk_text(text, chunk_size=10, overlap=2)

    assert len(chunks) == 1
    assert chunks[0].text == "hello world"
    assert chunks[0].index == 0


def test_chunk_text_overlap():
    # 10 words, chunk_size=4, overlap=2 -> step=2
    text = "a b c d e f g h i j"
    chunks = chunk_text(text, chunk_size=4, overlap=2)

    assert chunks[0].text == "a b c d"
    assert chunks[1].text == "c d e f"
    assert chunks[2].text == "e f g h"
    assert chunks[3].text == "g h i j"


def test_chunk_text_no_overlap():
    text = "a b c d e f"
    chunks = chunk_text(text, chunk_size=3, overlap=0)

    assert len(chunks) == 2
    assert chunks[0].text == "a b c"
    assert chunks[1].text == "d e f"


def test_chunk_default_type():
    chunks = chunk_text("hello world", chunk_size=10, overlap=0)
    assert chunks[0].chunk_type == "text"


def test_chunk_metadata_defaults():
    chunks = chunk_text("hello world", chunk_size=10, overlap=0)
    chunk = chunks[0]
    assert chunk.start_line is None
    assert chunk.end_line is None
    assert chunk.entity_name is None
    assert chunk.context_header is None
