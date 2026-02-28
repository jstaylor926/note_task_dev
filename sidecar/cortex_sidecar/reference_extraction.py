"""Reference extraction from free text.

Extracts URLs, file paths, action items, and code symbols from note content.
"""

import re
from dataclasses import dataclass


@dataclass
class ExtractedReference:
    text: str
    ref_type: str  # "code_symbol", "file_path", "url", "action_item"
    start: int
    end: int
    confidence: float


# Regex patterns
URL_RE = re.compile(r"https?://\S+")
FILE_PATH_RE = re.compile(
    r"(?<!\w)"  # Not preceded by a word character
    r"(?:[a-zA-Z0-9_./-]+/)"  # At least one directory component with /
    r"[a-zA-Z0-9_.-]+"  # Filename
    r"\.[a-zA-Z0-9]{1,10}"  # Extension
    r"(?!\w)"  # Not followed by a word character
)
ACTION_ITEM_RE = re.compile(
    r"\b(TODO|FIXME|HACK|XXX)\b",
    re.IGNORECASE,
)
BACKTICK_SYMBOL_RE = re.compile(r"`([^`]+)`")
CODE_TOKEN_RE = re.compile(
    r"(?<!\w)([A-Z][a-zA-Z0-9]+|[a-z]+(?:_[a-z0-9]+)+)(?!\w)"
)


def _overlaps(ref: ExtractedReference, existing: list[ExtractedReference]) -> bool:
    """Check if a reference overlaps with any existing reference."""
    for ex in existing:
        if ref.start < ex.end and ref.end > ex.start:
            return True
    return False


def extract_references(
    text: str, known_symbols: list[str] | None = None
) -> list[ExtractedReference]:
    """Extract references from free text.

    Extraction rules applied in order (deduplicating overlaps):
    1. URLs
    2. File paths
    3. Action items (TODO, FIXME, HACK, XXX)
    4. Code symbols (backtick-quoted, then fuzzy match against known_symbols)

    Args:
        text: The text to extract references from.
        known_symbols: Optional list of known code symbols for fuzzy matching.

    Returns:
        List of ExtractedReference objects, sorted by start position.
    """
    if known_symbols is None:
        known_symbols = []

    refs: list[ExtractedReference] = []

    # 1. URLs
    for m in URL_RE.finditer(text):
        ref = ExtractedReference(
            text=m.group(),
            ref_type="url",
            start=m.start(),
            end=m.end(),
            confidence=1.0,
        )
        if not _overlaps(ref, refs):
            refs.append(ref)

    # 2. File paths
    for m in FILE_PATH_RE.finditer(text):
        ref = ExtractedReference(
            text=m.group(),
            ref_type="file_path",
            start=m.start(),
            end=m.end(),
            confidence=1.0,
        )
        if not _overlaps(ref, refs):
            refs.append(ref)

    # 3. Action items
    for m in ACTION_ITEM_RE.finditer(text):
        ref = ExtractedReference(
            text=m.group(),
            ref_type="action_item",
            start=m.start(),
            end=m.end(),
            confidence=0.9,
        )
        if not _overlaps(ref, refs):
            refs.append(ref)

    # 4. Code symbols — backtick-quoted
    for m in BACKTICK_SYMBOL_RE.finditer(text):
        # Use the full match including backticks for position, but inner text for text field
        ref = ExtractedReference(
            text=m.group(1),
            ref_type="code_symbol",
            start=m.start(),
            end=m.end(),
            confidence=1.0,
        )
        if not _overlaps(ref, refs):
            refs.append(ref)

    # 4b. Code symbols — fuzzy match against known_symbols
    if known_symbols:
        from rapidfuzz import fuzz

        for m in CODE_TOKEN_RE.finditer(text):
            token = m.group(1)
            ref_candidate = ExtractedReference(
                text=token,
                ref_type="code_symbol",
                start=m.start(),
                end=m.end(),
                confidence=0.0,
            )
            if _overlaps(ref_candidate, refs):
                continue

            best_ratio = 0.0
            for sym in known_symbols:
                ratio = fuzz.ratio(token, sym)
                if ratio > best_ratio:
                    best_ratio = ratio

            if best_ratio >= 85:
                ref_candidate.confidence = round(best_ratio / 100, 2)
                refs.append(ref_candidate)

    refs.sort(key=lambda r: r.start)
    return refs


# ─── Code Comment TODO Extraction ────────────────────────────────────


@dataclass
class CodeTodo:
    text: str           # The TODO/FIXME text after the marker
    marker: str         # "TODO", "FIXME", "HACK", "XXX"
    line_number: int    # 1-indexed line number in the file
    confidence: float   # 1.0 for explicit markers


CODE_COMMENT_TODO_RE = re.compile(
    r"(?://|#|/\*|--|%)\s*(?P<marker>TODO|FIXME|HACK|XXX)[: \t]+(?P<text>[^\n]*)",
    re.IGNORECASE,
)


def extract_code_todos(source: str) -> list[CodeTodo]:
    """Extract TODO/FIXME comments from source code.

    Matches common comment prefixes (//, #, /*, --, %) followed by
    TODO, FIXME, HACK, or XXX markers.

    Args:
        source: The source code text to scan.

    Returns:
        List of CodeTodo objects found in the source.
    """
    todos: list[CodeTodo] = []
    for m in CODE_COMMENT_TODO_RE.finditer(source):
        text = m.group("text").strip()
        if not text:
            continue
        # Compute 1-indexed line number
        line_number = source[:m.start()].count("\n") + 1
        todos.append(
            CodeTodo(
                text=text,
                marker=m.group("marker").upper(),
                line_number=line_number,
                confidence=1.0,
            )
        )
    return todos
