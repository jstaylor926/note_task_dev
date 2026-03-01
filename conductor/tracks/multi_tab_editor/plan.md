# Multi-tab Editor Implementation Plan

## Phase 1: Core State Refactor
- [x] **Data Model Update**: Refactor `editorState.ts` to support the recursive `EditorPaneNode` tree.
- [x] **Pane Management**: Implement `splitPane`, `closePane`, `setActivePane`, and `moveTabBetweenPanes` in the store.
- [x] **File Operations**: Update `openFile` to target the active pane.

## Phase 2: Component Refactoring
- [x] **Recursive Renderer**: Create `EditorPaneContainer.tsx` to recursively render splits and panes.
- [x] **Pane Component**: Create `EditorPane.tsx` which contains its own tab bar, breadcrumbs, and `CodeMirrorEditor`.
- [x] **Tab Bar**: Implement a reusable `EditorTabBar.tsx` for individual panes.

## Phase 3: Split Features
- [x] **Split Dividers**: Integrate `SplitContainer.tsx` (or a variant) into the editor layout.
- [x] **Keyboard Shortcuts**: Register global shortcuts for splitting and navigating panes.
- [ ] **Layout Preservation**: Ensure the layout tree can be serialized and restored.

## Phase 4: UI Polish
- [ ] **Active Indicator**: Visual highlight for the currently focused pane.
- [ ] **Tab Drag & Drop**: (Optional/Stretch) Allow dragging tabs between panes.
- [ ] **Context Menu**: Add "Split Up/Down/Left/Right" to tab context menus.

## Verification
- [ ] **Split Stability**: Verify that adding and removing nested splits doesn't crash the UI.
- [ ] **File Sync**: Ensure multiple views of the same file stay in sync (if allowed) or handle duplication correctly.
- [ ] **Performance**: Test with 5+ splits and multiple large files.
