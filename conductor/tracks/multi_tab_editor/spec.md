# Multi-tab Editor Specification

## 1. Goal
Provide a flexible and powerful workspace for code editing that supports multiple files open in parallel across a configurable layout of split panes.

## 2. Data Model
The editor layout will be represented as a tree:
- **EditorPaneNode**:
  - `type: 'pane'`: Contains an array of open `EditorFile` objects and an `activeFileIndex`.
  - `type: 'split'`: Contains `direction` ('horizontal' | 'vertical'), `children` (array of `EditorPaneNode`), and `sizes` (percentages).

## 3. UI Requirements
- **Individual Tab Bars**: Each pane has its own tab bar at the top.
- **Active Pane**: One pane is always "active" (focused). New files from the file tree/search open in the active pane.
- **Breadcrumbs/Header**: Each pane shows the path of the active file.
- **Split Controls**: Buttons or keyboard shortcuts to split the active pane.
- **Draggable Dividers**: Adjust split sizes by dragging.

## 4. Interactions
- **Opening a file**: If already open in any pane, switch to that tab. Otherwise, open in the active pane.
- **Splitting**: Duplicate the active tab into a new pane.
- **Closing**: Close a tab. If it was the last tab in a pane, remove the pane from the split layout (unless it's the root pane).

## 5. Keyboard Shortcuts
- `Cmd+`: Split vertically.
- `Cmd+Shift+`: Split horizontally.
- `Cmd+W`: Close active tab.
- `Ctrl+Tab`: Next tab in active pane.
- `Ctrl+Shift+Tab`: Previous tab in active pane.
- `Cmd+Option+Arrows`: Move focus between panes.
