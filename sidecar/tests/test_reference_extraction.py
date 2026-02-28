"""Tests for reference extraction module."""

import pytest
from cortex_sidecar.reference_extraction import (
    extract_references,
    ExtractedReference,
    extract_code_todos,
    CodeTodo,
)


class TestURLExtraction:
    def test_extracts_http_url(self):
        refs = extract_references("Check https://example.com for docs")
        urls = [r for r in refs if r.ref_type == "url"]
        assert len(urls) == 1
        assert urls[0].text == "https://example.com"
        assert urls[0].confidence == 1.0

    def test_extracts_http_url_with_path(self):
        refs = extract_references("See http://example.com/docs/api?q=1")
        urls = [r for r in refs if r.ref_type == "url"]
        assert len(urls) == 1
        assert urls[0].text == "http://example.com/docs/api?q=1"

    def test_extracts_multiple_urls(self):
        text = "Visit https://a.com and https://b.com"
        refs = extract_references(text)
        urls = [r for r in refs if r.ref_type == "url"]
        assert len(urls) == 2


class TestFilePathExtraction:
    def test_extracts_simple_file_path(self):
        refs = extract_references("Look at src/main.rs for the entry point")
        paths = [r for r in refs if r.ref_type == "file_path"]
        assert len(paths) == 1
        assert paths[0].text == "src/main.rs"
        assert paths[0].confidence == 1.0

    def test_extracts_nested_path(self):
        refs = extract_references("The file src/components/SearchPanel.tsx is important")
        paths = [r for r in refs if r.ref_type == "file_path"]
        assert len(paths) == 1
        assert paths[0].text == "src/components/SearchPanel.tsx"

    def test_extracts_python_path(self):
        refs = extract_references("Check lib/utils.py")
        paths = [r for r in refs if r.ref_type == "file_path"]
        assert len(paths) == 1
        assert paths[0].text == "lib/utils.py"

    def test_does_not_match_url_as_file_path(self):
        refs = extract_references("Visit https://example.com/path/file.html")
        paths = [r for r in refs if r.ref_type == "file_path"]
        assert len(paths) == 0  # Should be captured as URL instead


class TestActionItemExtraction:
    def test_extracts_todo(self):
        refs = extract_references("TODO fix this later")
        items = [r for r in refs if r.ref_type == "action_item"]
        assert len(items) == 1
        assert items[0].text == "TODO"
        assert items[0].confidence == 0.9

    def test_extracts_fixme(self):
        refs = extract_references("FIXME: broken logic here")
        items = [r for r in refs if r.ref_type == "action_item"]
        assert len(items) == 1
        assert items[0].text == "FIXME"

    def test_extracts_hack_and_xxx(self):
        refs = extract_references("HACK around the issue. XXX needs review")
        items = [r for r in refs if r.ref_type == "action_item"]
        assert len(items) == 2

    def test_case_insensitive(self):
        refs = extract_references("todo: do this")
        items = [r for r in refs if r.ref_type == "action_item"]
        assert len(items) == 1


class TestCodeSymbolExtraction:
    def test_backtick_symbol(self):
        refs = extract_references("The `SearchPanel` component handles search")
        symbols = [r for r in refs if r.ref_type == "code_symbol"]
        assert len(symbols) == 1
        assert symbols[0].text == "SearchPanel"
        assert symbols[0].confidence == 1.0

    def test_multiple_backtick_symbols(self):
        refs = extract_references("Use `funcA` and `funcB` together")
        symbols = [r for r in refs if r.ref_type == "code_symbol"]
        assert len(symbols) == 2
        assert symbols[0].text == "funcA"
        assert symbols[1].text == "funcB"

    def test_fuzzy_match_exact(self):
        refs = extract_references(
            "The SearchPanel is a component",
            known_symbols=["SearchPanel", "NotesPanel"],
        )
        symbols = [r for r in refs if r.ref_type == "code_symbol"]
        assert len(symbols) == 1
        assert symbols[0].text == "SearchPanel"
        assert symbols[0].confidence == 1.0

    def test_fuzzy_match_snake_case(self):
        refs = extract_references(
            "Call compute_sha256 for hashing",
            known_symbols=["compute_sha256", "detect_language"],
        )
        symbols = [r for r in refs if r.ref_type == "code_symbol"]
        assert len(symbols) == 1
        assert symbols[0].text == "compute_sha256"

    def test_fuzzy_match_below_threshold_excluded(self):
        refs = extract_references(
            "The Component works well",
            known_symbols=["SearchPanel"],
        )
        symbols = [r for r in refs if r.ref_type == "code_symbol"]
        # "Component" is not similar enough to "SearchPanel"
        assert len(symbols) == 0


class TestOverlapDedup:
    def test_url_takes_precedence_over_file_path(self):
        text = "See https://example.com/src/main.rs for details"
        refs = extract_references(text)
        # The URL should be extracted; overlapping file path should be suppressed
        urls = [r for r in refs if r.ref_type == "url"]
        paths = [r for r in refs if r.ref_type == "file_path"]
        assert len(urls) == 1
        assert len(paths) == 0

    def test_backtick_takes_precedence_over_fuzzy(self):
        text = "Use `SearchPanel` component"
        refs = extract_references(text, known_symbols=["SearchPanel"])
        symbols = [r for r in refs if r.ref_type == "code_symbol"]
        # Should only match once (backtick), not also fuzzy
        assert len(symbols) == 1
        assert symbols[0].confidence == 1.0


class TestMixedContent:
    def test_mixed_references(self):
        text = (
            "TODO: Check https://docs.rs for `SearchPanel` in src/components/SearchPanel.tsx"
        )
        refs = extract_references(text)
        types = {r.ref_type for r in refs}
        assert "url" in types
        assert "action_item" in types
        assert "code_symbol" in types
        assert "file_path" in types

    def test_empty_text(self):
        refs = extract_references("")
        assert refs == []

    def test_no_references(self):
        refs = extract_references("Just some plain text with nothing special")
        # May get some matches depending on tokens, but should be minimal
        action_items = [r for r in refs if r.ref_type == "action_item"]
        assert len(action_items) == 0

    def test_offsets_are_correct(self):
        text = "See `myFunc` here"
        refs = extract_references(text)
        symbols = [r for r in refs if r.ref_type == "code_symbol"]
        assert len(symbols) == 1
        assert text[symbols[0].start : symbols[0].end] == "`myFunc`"


class TestCodeTodoExtraction:
    def test_rust_double_slash_todo(self):
        source = '// TODO: refactor this function\nfn main() {}'
        todos = extract_code_todos(source)
        assert len(todos) == 1
        assert todos[0].text == "refactor this function"
        assert todos[0].marker == "TODO"
        assert todos[0].line_number == 1
        assert todos[0].confidence == 1.0

    def test_python_hash_fixme(self):
        source = '# FIXME: handle edge case\ndef foo():\n    pass'
        todos = extract_code_todos(source)
        assert len(todos) == 1
        assert todos[0].text == "handle edge case"
        assert todos[0].marker == "FIXME"
        assert todos[0].line_number == 1

    def test_multiple_todos(self):
        source = (
            "fn main() {\n"
            "    // TODO: add error handling\n"
            "    let x = 1;\n"
            "    // HACK: workaround for bug\n"
            "}\n"
        )
        todos = extract_code_todos(source)
        assert len(todos) == 2
        assert todos[0].marker == "TODO"
        assert todos[0].line_number == 2
        assert todos[1].marker == "HACK"
        assert todos[1].line_number == 4

    def test_case_insensitive(self):
        source = "# todo: lower case todo\n# Fixme: mixed case"
        todos = extract_code_todos(source)
        assert len(todos) == 2
        assert todos[0].marker == "TODO"
        assert todos[1].marker == "FIXME"

    def test_no_false_positives_on_todoist(self):
        source = "// Using todoist API for task management\nlet client = todoist.new();"
        todos = extract_code_todos(source)
        # "todoist" should not match — the pattern requires a separator after the marker
        assert len(todos) == 0

    def test_block_comment_todo(self):
        source = "/* TODO: implement caching */\nfn cache() {}"
        todos = extract_code_todos(source)
        assert len(todos) == 1
        assert todos[0].text == "implement caching */"
        # The */ is captured since regex takes rest of line; this is acceptable

    def test_empty_todo_text_skipped(self):
        source = "// TODO:\n// FIXME: real issue"
        todos = extract_code_todos(source)
        assert len(todos) == 1
        assert todos[0].marker == "FIXME"
