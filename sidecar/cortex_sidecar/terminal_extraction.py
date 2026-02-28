"""Terminal error extraction — extract actionable tasks from terminal output."""

import re
from dataclasses import dataclass


@dataclass
class TerminalTask:
    text: str           # Suggested task title
    error_type: str     # "compile_error", "test_failure", "runtime_error"
    source_text: str    # Original error text (the matched line)
    confidence: float


# Compile error patterns
COMPILE_ERROR_PATTERNS = [
    re.compile(r"error\[E\d+\]:\s*(.+)", re.IGNORECASE),
    re.compile(r"^error:\s*(.+)", re.MULTILINE),
    re.compile(r"SyntaxError:\s*(.+)"),
    re.compile(r"TypeError:\s*(.+)"),
]

# Test failure patterns
TEST_FAILURE_PATTERNS = [
    re.compile(r"FAILED\s+(.+)"),
    re.compile(r"FAIL:\s*(.+)"),
    re.compile(r"(test\S*)\s+.*FAILED", re.IGNORECASE),
    re.compile(r"assertion\s+failed:?\s*(.+)", re.IGNORECASE),
]

# Runtime error patterns
RUNTIME_ERROR_PATTERNS = [
    re.compile(r"panic!?\(.+\)"),
    re.compile(r"thread '.*' panicked at '(.+)'"),
    re.compile(r"Traceback \(most recent call last\)"),
    re.compile(r"(\w*Exception):\s*(.+)"),
    re.compile(r"segfault|segmentation fault", re.IGNORECASE),
]


def extract_terminal_tasks(output: str) -> list[TerminalTask]:
    """Extract actionable tasks from terminal output.

    Scans for compile errors, test failures, and runtime errors,
    producing a deduplicated list of suggested tasks.

    Args:
        output: The terminal output text to scan.

    Returns:
        List of TerminalTask objects extracted from the output.
    """
    tasks: list[TerminalTask] = []
    seen_texts: set[str] = set()

    def add_task(text: str, error_type: str, source_text: str, confidence: float) -> None:
        text = text.strip()
        if not text or text in seen_texts:
            return
        # Truncate very long texts
        if len(text) > 200:
            text = text[:200] + "..."
        seen_texts.add(text)
        tasks.append(TerminalTask(
            text=text,
            error_type=error_type,
            source_text=source_text.strip(),
            confidence=confidence,
        ))

    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        # Check compile errors (confidence=0.95)
        for pattern in COMPILE_ERROR_PATTERNS:
            m = pattern.search(stripped)
            if m:
                task_text = m.group(1) if m.lastindex else stripped
                add_task(f"Fix: {task_text}", "compile_error", stripped, 0.95)
                break

        # Check test failures (confidence=0.9)
        for pattern in TEST_FAILURE_PATTERNS:
            m = pattern.search(stripped)
            if m:
                task_text = m.group(1) if m.lastindex else stripped
                add_task(f"Fix failing test: {task_text}", "test_failure", stripped, 0.9)
                break

        # Check runtime errors (confidence=0.85)
        for pattern in RUNTIME_ERROR_PATTERNS:
            m = pattern.search(stripped)
            if m:
                if m.lastindex and m.lastindex >= 1:
                    groups = m.groups()
                    task_text = groups[-1] if len(groups) > 1 else groups[0]
                else:
                    task_text = stripped
                add_task(f"Fix runtime error: {task_text}", "runtime_error", stripped, 0.85)
                break

    return tasks
