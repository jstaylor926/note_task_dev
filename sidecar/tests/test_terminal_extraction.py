"""Tests for terminal error extraction module."""

import pytest
from cortex_sidecar.terminal_extraction import extract_terminal_tasks, TerminalTask


class TestCompileErrors:
    def test_rust_error_code(self):
        output = "error[E0308]: mismatched types\n  --> src/main.rs:10:5"
        tasks = extract_terminal_tasks(output)
        assert len(tasks) == 1
        assert tasks[0].error_type == "compile_error"
        assert "mismatched types" in tasks[0].text
        assert tasks[0].confidence == 0.95

    def test_generic_error(self):
        output = "error: cannot find value `x` in this scope"
        tasks = extract_terminal_tasks(output)
        assert len(tasks) >= 1
        compile_errs = [t for t in tasks if t.error_type == "compile_error"]
        assert len(compile_errs) >= 1

    def test_syntax_error(self):
        output = "SyntaxError: unexpected token ';'"
        tasks = extract_terminal_tasks(output)
        assert len(tasks) == 1
        assert tasks[0].error_type == "compile_error"
        assert "unexpected token" in tasks[0].text

    def test_type_error(self):
        output = "TypeError: 'NoneType' object is not subscriptable"
        tasks = extract_terminal_tasks(output)
        assert len(tasks) >= 1
        compile_errs = [t for t in tasks if t.error_type == "compile_error"]
        assert len(compile_errs) >= 1


class TestTestFailures:
    def test_failed_keyword(self):
        output = "FAILED tests/test_api.py::test_login - AssertionError"
        tasks = extract_terminal_tasks(output)
        assert len(tasks) >= 1
        test_fails = [t for t in tasks if t.error_type == "test_failure"]
        assert len(test_fails) >= 1

    def test_fail_prefix(self):
        output = "FAIL: test_authentication (tests.test_auth.AuthTest)"
        tasks = extract_terminal_tasks(output)
        test_fails = [t for t in tasks if t.error_type == "test_failure"]
        assert len(test_fails) >= 1

    def test_assertion_failed(self):
        output = "assertion failed: left == right\n  left: 1\n  right: 2"
        tasks = extract_terminal_tasks(output)
        assert len(tasks) >= 1
        test_fails = [t for t in tasks if t.error_type == "test_failure"]
        assert len(test_fails) >= 1


class TestRuntimeErrors:
    def test_python_traceback(self):
        output = "Traceback (most recent call last):\n  File 'main.py', line 5\nValueError: invalid literal"
        tasks = extract_terminal_tasks(output)
        assert len(tasks) >= 1
        runtime = [t for t in tasks if t.error_type == "runtime_error"]
        assert len(runtime) >= 1

    def test_rust_panic(self):
        output = "thread 'main' panicked at 'index out of bounds: the len is 0 but the index is 1'"
        tasks = extract_terminal_tasks(output)
        runtime = [t for t in tasks if t.error_type == "runtime_error"]
        assert len(runtime) >= 1


class TestMixedOutput:
    def test_mixed_errors(self):
        output = (
            "Compiling cortex v0.1.0\n"
            "error[E0425]: cannot find value `foo`\n"
            "FAILED tests/test_main.py::test_something\n"
            "Build complete.\n"
        )
        tasks = extract_terminal_tasks(output)
        error_types = {t.error_type for t in tasks}
        assert "compile_error" in error_types
        assert "test_failure" in error_types

    def test_no_false_positives(self):
        output = (
            "Compiling cortex v0.1.0\n"
            "Finished dev [unoptimized] target\n"
            "Running `target/debug/cortex`\n"
            "All tests passed.\n"
        )
        tasks = extract_terminal_tasks(output)
        assert len(tasks) == 0

    def test_dedup_identical_errors(self):
        output = (
            "error: cannot find value `x`\n"
            "error: cannot find value `x`\n"
        )
        tasks = extract_terminal_tasks(output)
        assert len(tasks) == 1

    def test_empty_output(self):
        tasks = extract_terminal_tasks("")
        assert tasks == []
