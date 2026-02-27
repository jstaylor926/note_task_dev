"""Tests for the chunking module."""

from cortex_sidecar.chunking import (
    Chunk,
    chunk_code,
    chunk_config,
    chunk_file,
    chunk_markdown,
    chunk_text,
)


# ---------------------------------------------------------------------------
# Word-window fallback tests
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Tree-sitter code chunking tests
# ---------------------------------------------------------------------------

def test_chunk_python_functions():
    source = """\
import os

def hello():
    print("hi")

def world(x):
    return x + 1
"""
    chunks = chunk_code(source, "python", file_path="app.py")
    assert chunks is not None
    assert len(chunks) == 3  # preamble + 2 functions

    preamble = chunks[0]
    assert preamble.chunk_type == "preamble"
    assert "import os" in preamble.text

    hello_chunk = chunks[1]
    assert hello_chunk.entity_name == "hello"
    assert hello_chunk.chunk_type == "function"
    assert hello_chunk.start_line is not None
    assert hello_chunk.context_header is not None
    assert "Function: hello" in hello_chunk.context_header

    world_chunk = chunks[2]
    assert world_chunk.entity_name == "world"
    assert world_chunk.chunk_type == "function"


def test_chunk_python_class():
    source = """\
class MyClass:
    def method_one(self):
        return 1

    def method_two(self):
        return 2
"""
    chunks = chunk_code(source, "python", file_path="cls.py")
    assert chunks is not None
    # Should have 1 chunk for the whole class (top-level)
    assert len(chunks) == 1
    assert chunks[0].entity_name == "MyClass"
    assert chunks[0].chunk_type == "class"


def test_chunk_rust_items():
    source = """\
use std::io;

fn main() {
    println!("hello");
}

struct Point {
    x: f64,
    y: f64,
}

impl Point {
    fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}
"""
    chunks = chunk_code(source, "rust", file_path="main.rs")
    assert chunks is not None
    assert len(chunks) >= 3  # preamble + fn + struct + impl

    types = [c.chunk_type for c in chunks]
    assert "function" in types
    assert "struct" in types
    assert "impl" in types


def test_chunk_typescript_functions():
    source = """\
import { useState } from 'react';

function App() {
  return <div>Hello</div>;
}

class MyComponent {
  render() {
    return null;
  }
}
"""
    # Use "javascript" since TS without types is valid JS
    chunks = chunk_code(source, "javascript", file_path="app.js")
    assert chunks is not None
    assert len(chunks) >= 2  # at least function + class

    names = [c.entity_name for c in chunks if c.entity_name]
    assert "App" in names
    assert "MyComponent" in names


def test_chunk_code_unsupported_language():
    result = chunk_code("hello", "haskell", file_path="main.hs")
    assert result is None


def test_chunk_code_no_definitions():
    # Pure comments / no top-level defs -> returns None to fall back
    source = "# just a comment\nx = 1\n"
    result = chunk_code(source, "python", file_path="script.py")
    assert result is None


def test_chunk_code_line_numbers():
    source = """\
def first():
    pass

def second():
    pass
"""
    chunks = chunk_code(source, "python", file_path="funcs.py")
    assert chunks is not None
    for chunk in chunks:
        assert chunk.start_line is not None
        assert chunk.end_line is not None
        assert chunk.start_line <= chunk.end_line


# ---------------------------------------------------------------------------
# Markdown chunking tests
# ---------------------------------------------------------------------------

def test_chunk_markdown_by_headings():
    source = """\
# Introduction

Welcome to the project.

## Features

- Feature A
- Feature B

## Installation

Run `pip install`.
"""
    chunks = chunk_markdown(source, file_path="README.md")
    assert len(chunks) == 3

    assert chunks[0].entity_name == "Introduction"
    assert chunks[0].chunk_type == "section"
    assert "Welcome" in chunks[0].text

    assert chunks[1].entity_name == "Features"
    assert chunks[2].entity_name == "Installation"


def test_chunk_markdown_empty():
    assert chunk_markdown("") == []


# ---------------------------------------------------------------------------
# Config chunking tests
# ---------------------------------------------------------------------------

def test_chunk_config_toml():
    source = """\
[package]
name = "cortex"
version = "0.1.0"

[dependencies]
serde = "1"
tokio = "1"
"""
    chunks = chunk_config(source, file_path="Cargo.toml")
    assert len(chunks) >= 2
    names = [c.entity_name for c in chunks]
    assert "package" in names
    assert "dependencies" in names
    assert all(c.chunk_type == "config" for c in chunks)


def test_chunk_config_yaml():
    source = """\
name: my-app
version: 1.0

dependencies:
  express: ^4.0
  lodash: ^4.0
"""
    chunks = chunk_config(source, file_path="config.yaml")
    assert len(chunks) >= 2


# ---------------------------------------------------------------------------
# Chunk router tests
# ---------------------------------------------------------------------------

def test_chunk_file_routes_python():
    source = "def hello():\n    pass\n"
    chunks = chunk_file(source, "python", file_path="hello.py")
    assert len(chunks) >= 1
    assert any(c.entity_name == "hello" for c in chunks)


def test_chunk_file_routes_markdown():
    source = "# Title\nSome text\n"
    chunks = chunk_file(source, "markdown", file_path="doc.md")
    assert len(chunks) == 1
    assert chunks[0].chunk_type == "section"


def test_chunk_file_routes_config():
    source = "[section]\nkey = value\n"
    chunks = chunk_file(source, "toml", file_path="cfg.toml")
    assert len(chunks) >= 1
    assert chunks[0].chunk_type == "config"


def test_chunk_file_fallback_to_word_window():
    source = "just some plain text content here"
    chunks = chunk_file(source, "text", file_path="notes.txt")
    assert len(chunks) >= 1
    assert chunks[0].chunk_type == "text"


def test_chunk_file_empty():
    assert chunk_file("", "python") == []
    assert chunk_file("   ", "rust") == []
