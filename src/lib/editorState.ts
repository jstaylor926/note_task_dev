import { createStore, produce } from 'solid-js/store';
import { getLanguageFromPath } from './codemirrorLanguages';

export interface EditorFile {
  path: string;
  content: string;
  savedContent: string;
  language: string | undefined;
}

export type EditorPaneNode =
  | { 
      type: 'pane'; 
      id: string; 
      tabs: EditorFile[]; 
      activeTabIndex: number; 
    }
  | {
      type: 'split';
      id: string;
      direction: 'horizontal' | 'vertical';
      children: EditorPaneNode[];
      sizes: number[];
    };

interface EditorState {
  layout: EditorPaneNode;
  activePaneId: string | null;
  isLoading: boolean;
  error: string | null;
}

const LARGE_FILE_LINE_THRESHOLD = 50000;

let nextId = 0;
function genId(prefix: string): string {
  return `${prefix}-${++nextId}`;
}

export function resetIdCounter() {
  nextId = 0;
}

export function createEditorStore() {
  const initialPane: EditorPaneNode = {
    type: 'pane',
    id: genId('pane'),
    tabs: [],
    activeTabIndex: 0,
  };

  const [state, setState] = createStore<EditorState>({
    layout: initialPane,
    activePaneId: initialPane.id,
    isLoading: false,
    error: null,
  });

  function openFile(path: string, content: string) {
    // Check if file is already open in ANY pane
    const existing = findTabInLayout(state.layout, path);
    if (existing) {
      setActivePane(existing.paneId);
      setTabInPane(existing.paneId, existing.tabIndex);
      return;
    }

    const language = getLanguageFromPath(path);
    const file: EditorFile = { path, content, savedContent: content, language };

    setState(
      produce((s) => {
        const pane = findPaneByIdMut(s.layout, s.activePaneId || '');
        if (pane && pane.type === 'pane') {
          pane.tabs.push(file);
          pane.activeTabIndex = pane.tabs.length - 1;
        } else {
          // Fallback: if no active pane, or it's a split (shouldn't happen), add to first pane found
          const firstPane = getFirstPaneMut(s.layout);
          if (firstPane) {
            firstPane.tabs.push(file);
            firstPane.activeTabIndex = firstPane.tabs.length - 1;
            s.activePaneId = firstPane.id;
          }
        }
        s.isLoading = false;
        s.error = null;
      }),
    );
  }

  function setLoading(loading: boolean) {
    setState('isLoading', loading);
  }

  function setError(error: string | null) {
    setState(
      produce((s) => {
        s.error = error;
        s.isLoading = false;
      }),
    );
  }

  function updateContent(content: string) {
    setState(
      produce((s) => {
        const pane = findPaneByIdMut(s.layout, s.activePaneId || '');
        if (pane && pane.type === 'pane') {
          const file = pane.tabs[pane.activeTabIndex];
          if (file) {
            file.content = content;
          }
        }
      }),
    );
  }

  function markSaved() {
    setState(
      produce((s) => {
        const pane = findPaneByIdMut(s.layout, s.activePaneId || '');
        if (pane && pane.type === 'pane') {
          const file = pane.tabs[pane.activeTabIndex];
          if (file) {
            file.savedContent = file.content;
          }
        }
      }),
    );
  }

  function closeTab(paneId: string, tabIndex: number) {
    setState(
      produce((s) => {
        const pane = findPaneByIdMut(s.layout, paneId);
        if (!pane || pane.type !== 'pane') return;

        pane.tabs.splice(tabIndex, 1);
        if (pane.tabs.length === 0) {
          // If it's not the last pane, we might want to remove it
          // but for now, let's just keep empty panes
          pane.activeTabIndex = 0;
        } else if (pane.activeTabIndex >= pane.tabs.length) {
          pane.activeTabIndex = pane.tabs.length - 1;
        }
        s.error = null;
      }),
    );
  }

  function closeActiveFile() {
    if (state.activePaneId) {
      const pane = findPaneById(state.layout, state.activePaneId);
      if (pane && pane.type === 'pane') {
        closeTab(pane.id, pane.activeTabIndex);
      }
    }
  }

  function setActivePane(paneId: string) {
    setState('activePaneId', paneId);
  }

  function setTabInPane(paneId: string, tabIndex: number) {
    setState(
      produce((s) => {
        const pane = findPaneByIdMut(s.layout, paneId);
        if (pane && pane.type === 'pane') {
          if (tabIndex >= 0 && tabIndex < pane.tabs.length) {
            pane.activeTabIndex = tabIndex;
          }
        }
      })
    );
  }

  function splitPane(paneId: string, direction: 'horizontal' | 'vertical') {
    setState(
      produce((s) => {
        const pane = findPaneByIdMut(s.layout, paneId);
        if (!pane || pane.type !== 'pane') return;

        // Create a new pane with a copy of the active tab
        const activeFile = pane.tabs[pane.activeTabIndex];
        const newPane: EditorPaneNode = {
          type: 'pane',
          id: genId('pane'),
          tabs: activeFile ? [{ ...activeFile }] : [],
          activeTabIndex: 0,
        };

        s.layout = splitNodeInLayout(s.layout, paneId, direction, newPane);
        s.activePaneId = newPane.id;
      })
    );
  }

  function closePane(paneId: string) {
    setState(
      produce((s) => {
        // Don't close the last pane
        if (s.layout.type === 'pane' && s.layout.id === paneId) return;

        s.layout = removeNodeFromLayout(s.layout, paneId);
        // Ensure activePaneId is still valid
        const activePane = findPaneById(s.layout, s.activePaneId || '');
        if (!activePane) {
          const first = getFirstPane(s.layout);
          s.activePaneId = first ? first.id : null;
        }
      })
    );
  }

  function resizeSplit(splitId: string, sizes: number[]) {
    setState(
      produce((s) => {
        updateSplitSize(s.layout, splitId, sizes);
      })
    );
  }

  function isDirty(paneId: string, tabIndex: number): boolean {
    const pane = findPaneById(state.layout, paneId);
    if (!pane || pane.type !== 'pane') return false;
    const tab = pane.tabs[tabIndex];
    if (!tab) return false;
    return tab.content !== tab.savedContent;
  }

  function isAnyDirty(): boolean {
    return anyInLayout(state.layout, (pane) => 
      pane.type === 'pane' && pane.tabs.some(t => t.content !== t.savedContent)
    );
  }

  function getActiveFile(): EditorFile | null {
    if (!state.activePaneId) return null;
    const pane = findPaneById(state.layout, state.activePaneId);
    if (pane && pane.type === 'pane') {
      return pane.tabs[pane.activeTabIndex] || null;
    }
    return null;
  }

  return {
    state,
    openFile,
    setLoading,
    setError,
    updateContent,
    markSaved,
    closeTab,
    closeActiveFile,
    setActivePane,
    setTabInPane,
    splitPane,
    closePane,
    resizeSplit,
    getActiveFile,
    isDirty,
    isAnyDirty,
  };
}

// ─── Helper Functions ───────────────────────────────────────────────

function updateSplitSize(node: EditorPaneNode, splitId: string, sizes: number[]) {
  if (node.type === 'split') {
    if (node.id === splitId) {
      node.sizes = sizes;
      return;
    }
    for (const child of node.children) {
      updateSplitSize(child, splitId, sizes);
    }
  }
}

function findTabInLayout(node: EditorPaneNode, path: string): { paneId: string, tabIndex: number } | null {
  if (node.type === 'pane') {
    const idx = node.tabs.findIndex(t => t.path === path);
    if (idx !== -1) return { paneId: node.id, tabIndex: idx };
    return null;
  }
  for (const child of node.children) {
    const found = findTabInLayout(child, path);
    if (found) return found;
  }
  return null;
}

function findPaneById(node: EditorPaneNode, id: string): EditorPaneNode | null {
  if (node.id === id) return node;
  if (node.type === 'split') {
    for (const child of node.children) {
      const found = findPaneById(child, id);
      if (found) return found;
    }
  }
  return null;
}

function findPaneByIdMut(node: EditorPaneNode, id: string): EditorPaneNode | null {
  if (node.id === id) return node;
  if (node.type === 'split') {
    for (const child of node.children) {
      const found = findPaneByIdMut(child, id);
      if (found) return found;
    }
  }
  return null;
}

function getFirstPane(node: EditorPaneNode): { type: 'pane', id: string } | null {
  if (node.type === 'pane') return node;
  if (node.children.length > 0) return getFirstPane(node.children[0]);
  return null;
}

function getFirstPaneMut(node: any): any {
  if (node.type === 'pane') return node;
  if (node.children && node.children.length > 0) return getFirstPaneMut(node.children[0]);
  return null;
}

function anyInLayout(node: EditorPaneNode, predicate: (n: EditorPaneNode) => boolean): boolean {
  if (predicate(node)) return true;
  if (node.type === 'split') {
    return node.children.some(child => anyInLayout(child, predicate));
  }
  return false;
}

function splitNodeInLayout(
  node: EditorPaneNode,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  newNode: EditorPaneNode,
): EditorPaneNode {
  if (node.type === 'pane') {
    if (node.id === targetId) {
      return {
        type: 'split',
        id: genId('split'),
        direction,
        children: [node, newNode],
        sizes: [50, 50],
      };
    }
    return node;
  }

  return {
    ...node,
    children: node.children.map((child) =>
      splitNodeInLayout(child, targetId, direction, newNode),
    ),
  };
}

function removeNodeFromLayout(node: EditorPaneNode, targetId: string): EditorPaneNode {
  if (node.type === 'pane') return node;

  const filtered = node.children.filter((child) => {
    if (child.type === 'pane') return child.id !== targetId;
    return true;
  });

  const recursed = filtered.map((child) => removeNodeFromLayout(child, targetId));

  if (recursed.length === 0) {
    // This shouldn't happen with our logic, but handle it
    return node;
  }

  if (recursed.length === 1) return recursed[0];

  const equalSize = 100 / recursed.length;
  return {
    ...node,
    children: recursed,
    sizes: recursed.map(() => equalSize),
  };
}

