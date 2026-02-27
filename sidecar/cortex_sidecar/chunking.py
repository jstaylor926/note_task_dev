"""Text chunking module for Cortex sidecar.

Provides word-window chunking as the default strategy.
Future phases will add tree-sitter AST-based chunking.
"""

from dataclasses import dataclass, field


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


def chunk_text(
    text: str,
    chunk_size: int = 500,
    overlap: int = 50,
) -> list[Chunk]:
    """Split text into overlapping word-window chunks.

    Args:
        text: The source text to chunk.
        chunk_size: Maximum number of words per chunk.
        overlap: Number of overlapping words between consecutive chunks.

    Returns:
        A list of Chunk objects.
    """
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
