"""Text chunking module for Cortex sidecar.

Provides multiple chunking strategies:
- Tree-sitter AST-based chunking for code (function/class boundaries)
- Heading-based chunking for Markdown
- Top-level key chunking for config files (YAML/TOML/JSON)
- Word-window fallback for everything else
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from tree_sitter import Language, Parser

logger = logging.getLogger("cortex-sidecar")

# Maximum chunk size in characters before falling back to word-window splitting
MAX_CHUNK_CHARS = 8000


@dataclass
class Chunk:
    """A single chunk of text with metadata."""

    text: str
    index: int
    start_line: int | None = None
    end_line: int | None = None
    entity_name: str | None = None
    chunk_type: str = "text"
    context_header: str | None = None


# ---------------------------------------------------------------------------
# Word-window fallback
# ---------------------------------------------------------------------------

def chunk_text(
    text: str,
    chunk_size: int = 500,
    overlap: int = 50,
) -> list[Chunk]:
    """Split text into overlapping word-window chunks."""
    words = text.split()
    if not words:
        return []

    chunks: list[Chunk] = []
    start = 0
    chunk_index = 0

    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk_text_str = " ".join(words[start:end])
        chunks.append(Chunk(text=chunk_text_str, index=chunk_index))

        if end == len(words):
            break

        step = max(chunk_size - overlap, 1)
        start += step
        chunk_index += 1

    return chunks


# ---------------------------------------------------------------------------
# Tree-sitter code chunking
# ---------------------------------------------------------------------------

# Node types that represent top-level definitions we want to chunk by
_CODE_NODE_TYPES: dict[str, set[str]] = {
    "python": {"function_definition", "class_definition"},
    "javascript": {"function_declaration", "class_declaration", "export_statement",
                    "lexical_declaration", "variable_declaration"},
    "typescript": {"function_declaration", "class_declaration", "export_statement",
                    "lexical_declaration", "variable_declaration", "interface_declaration",
                    "type_alias_declaration"},
    "rust": {"function_item", "struct_item", "enum_item", "impl_item",
             "trait_item", "mod_item", "const_item", "static_item",
             "type_item"},
}

# Maps language name to a callable that returns the tree-sitter language capsule
_TS_LANGUAGES: dict[str, object] = {}


def _get_ts_language(lang: str) -> Language | None:
    """Lazily load and cache tree-sitter language objects."""
    if lang in _TS_LANGUAGES:
        return _TS_LANGUAGES[lang]

    capsule = None
    try:
        if lang == "python":
            import tree_sitter_python as mod
            capsule = mod.language()
        elif lang == "javascript":
            import tree_sitter_javascript as mod
            capsule = mod.language()
        elif lang == "typescript":
            import tree_sitter_typescript as mod
            capsule = mod.language_typescript()
        elif lang == "tsx":
            import tree_sitter_typescript as mod
            capsule = mod.language_tsx()
        elif lang == "rust":
            import tree_sitter_rust as mod
            capsule = mod.language()
    except ImportError:
        logger.warning("tree-sitter grammar for %s not installed", lang)
        return None

    if capsule is not None:
        language = Language(capsule)
        _TS_LANGUAGES[lang] = language
        return language
    return None


def _extract_name(node, source_bytes: bytes) -> str | None:
    """Extract the name identifier from an AST node."""
    for child in node.children:
        if child.type == "identifier" or child.type == "type_identifier":
            return source_bytes[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
    return None


def _build_context_header(file_path: str, entity_name: str | None, chunk_type: str) -> str:
    """Build a context header like 'File: path | Function: name'."""
    parts = [f"File: {file_path}"]
    if entity_name:
        label = chunk_type.capitalize() if chunk_type != "text" else "Entity"
        parts.append(f"{label}: {entity_name}")
    return " | ".join(parts)


def _chunk_type_from_node(node_type: str) -> str:
    """Map a tree-sitter node type to a human-readable chunk type."""
    if "class" in node_type:
        return "class"
    if "function" in node_type or "method" in node_type:
        return "function"
    if "struct" in node_type:
        return "struct"
    if "enum" in node_type:
        return "enum"
    if "impl" in node_type:
        return "impl"
    if "trait" in node_type:
        return "trait"
    if "interface" in node_type:
        return "interface"
    if "type" in node_type:
        return "type"
    if "mod" in node_type:
        return "module"
    return "code"


def chunk_code(
    source: str,
    language: str,
    file_path: str = "",
) -> list[Chunk] | None:
    """Chunk source code using tree-sitter AST boundaries.

    Returns None if the language is not supported (caller should fall back).
    """
    ts_lang = _get_ts_language(language)
    if ts_lang is None:
        return None

    target_types = _CODE_NODE_TYPES.get(language)
    if target_types is None:
        return None

    parser = Parser(ts_lang)
    source_bytes = source.encode("utf-8")
    tree = parser.parse(source_bytes)
    root = tree.root_node

    chunks: list[Chunk] = []
    lines = source.splitlines(keepends=True)

    # Collect top-level definition nodes
    definition_nodes = []
    for child in root.children:
        if child.type in target_types:
            definition_nodes.append(child)

    if not definition_nodes:
        # No top-level definitions found — fall back
        return None

    # Collect preamble (imports, comments before first definition)
    first_start = definition_nodes[0].start_byte
    preamble = source_bytes[:first_start].decode("utf-8", errors="replace").strip()

    chunk_index = 0

    if preamble:
        chunks.append(Chunk(
            text=preamble,
            index=chunk_index,
            start_line=1,
            end_line=definition_nodes[0].start_point[0],
            chunk_type="preamble",
            context_header=_build_context_header(file_path, None, "preamble"),
        ))
        chunk_index += 1

    for node in definition_nodes:
        node_text = source_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
        entity_name = _extract_name(node, source_bytes)
        ctype = _chunk_type_from_node(node.type)
        start_line = node.start_point[0] + 1  # 1-indexed
        end_line = node.end_point[0] + 1

        # If the chunk is too large, split it with word-window fallback
        if len(node_text) > MAX_CHUNK_CHARS:
            sub_chunks = chunk_text(node_text)
            for sc in sub_chunks:
                sc.index = chunk_index
                sc.start_line = start_line
                sc.end_line = end_line
                sc.entity_name = entity_name
                sc.chunk_type = ctype
                sc.context_header = _build_context_header(file_path, entity_name, ctype)
                chunks.append(sc)
                chunk_index += 1
        else:
            chunks.append(Chunk(
                text=node_text,
                index=chunk_index,
                start_line=start_line,
                end_line=end_line,
                entity_name=entity_name,
                chunk_type=ctype,
                context_header=_build_context_header(file_path, entity_name, ctype),
            ))
            chunk_index += 1

    return chunks


# ---------------------------------------------------------------------------
# Markdown heading-based chunking
# ---------------------------------------------------------------------------

def chunk_markdown(source: str, file_path: str = "") -> list[Chunk]:
    """Chunk Markdown by heading boundaries."""
    lines = source.splitlines(keepends=True)
    if not lines:
        return []

    sections: list[tuple[str | None, int, list[str]]] = []
    current_heading: str | None = None
    current_start = 1
    current_lines: list[str] = []

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("#"):
            # Save previous section
            if current_lines:
                sections.append((current_heading, current_start, current_lines))
            current_heading = stripped.lstrip("#").strip()
            current_start = i + 1
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        sections.append((current_heading, current_start, current_lines))

    chunks: list[Chunk] = []
    for idx, (heading, start_line, section_lines) in enumerate(sections):
        text = "".join(section_lines).strip()
        if not text:
            continue
        chunks.append(Chunk(
            text=text,
            index=idx,
            start_line=start_line,
            end_line=start_line + len(section_lines) - 1,
            entity_name=heading,
            chunk_type="section",
            context_header=_build_context_header(file_path, heading, "section"),
        ))

    return chunks


# ---------------------------------------------------------------------------
# Config file chunking (YAML/TOML/JSON — simple line-based top-level split)
# ---------------------------------------------------------------------------

def chunk_config(source: str, file_path: str = "") -> list[Chunk]:
    """Chunk config files by top-level keys (simple line-based heuristic)."""
    lines = source.splitlines(keepends=True)
    if not lines:
        return []

    sections: list[tuple[str, int, list[str]]] = []
    current_key: str | None = None
    current_start = 1
    current_lines: list[str] = []

    for i, line in enumerate(lines):
        stripped = line.rstrip()
        # Top-level key: starts at column 0, not a comment, not blank
        if stripped and not stripped[0].isspace() and not stripped.startswith("#") and not stripped.startswith("//"):
            if current_lines and current_key is not None:
                sections.append((current_key, current_start, current_lines))
            # Extract key name (before : or =)
            key = stripped.split(":")[0].split("=")[0].strip().strip("[]").strip('"').strip("'")
            current_key = key
            current_start = i + 1
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines and current_key is not None:
        sections.append((current_key, current_start, current_lines))

    chunks: list[Chunk] = []
    for idx, (key, start_line, section_lines) in enumerate(sections):
        text = "".join(section_lines).strip()
        if not text:
            continue
        chunks.append(Chunk(
            text=text,
            index=idx,
            start_line=start_line,
            end_line=start_line + len(section_lines) - 1,
            entity_name=key,
            chunk_type="config",
            context_header=_build_context_header(file_path, key, "config"),
        ))

    return chunks


# ---------------------------------------------------------------------------
# Chunk router — dispatches to the best strategy per language
# ---------------------------------------------------------------------------

_CODE_LANGUAGES = {"python", "javascript", "typescript", "tsx", "rust"}
_MARKDOWN_LANGUAGES = {"markdown"}
_CONFIG_LANGUAGES = {"toml", "yaml", "json"}


def chunk_file(
    content: str,
    language: str,
    file_path: str = "",
) -> list[Chunk]:
    """Route to the best chunking strategy for the given language.

    Falls back to word-window chunking if no specialized strategy applies.
    """
    if not content.strip():
        return []

    if language in _CODE_LANGUAGES:
        result = chunk_code(content, language, file_path=file_path)
        if result is not None:
            return result
        # Fall through to word-window if tree-sitter couldn't parse

    if language in _MARKDOWN_LANGUAGES:
        return chunk_markdown(content, file_path=file_path)

    if language in _CONFIG_LANGUAGES:
        return chunk_config(content, file_path=file_path)

    # Default: word-window
    return chunk_text(content)
