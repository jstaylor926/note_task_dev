# Multi-tab/Split Editor Track

**ID:** `multi_tab_editor`
**Status:** In Progress
**Priority:** High
**Owner:** Gemini CLI

## Overview
Transform the current single-panel editor into a high-performance, multi-tab, recursive split-pane editor system. Each pane can host multiple tabs, and panes can be split horizontally or vertically.

## Key Goals
- **Recursive Splits**: Support infinite nesting of horizontal and vertical splits (similar to the terminal).
- **Multi-Tab Panes**: Each pane can have its own set of tabs.
- **Drag & Drop**: Allow dragging tabs between panes or to create new splits.
- **Improved Performance**: Ensure smooth rendering and fast tab switching.
- **State Persistence**: Preserve the layout and open files across app restarts.

## Documents
- [Specification](./spec.md)
- [Implementation Plan](./plan.md)
- [Metadata](./metadata.json)
