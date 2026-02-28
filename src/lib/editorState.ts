import { createStore, produce } from 'solid-js/store';
import { getLanguageFromPath } from './codemirrorLanguages';

export interface EditorFile {
  path: string;
  content: string;
  savedContent: string;
  language: string | undefined;
}

export interface EditorTab {
  id: string;
  file: EditorFile;
}

interface EditorState {
  tabs: EditorTab[];
  activeTabIndex: number;
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
  const [state, setState] = createStore<EditorState>({
    tabs: [],
    activeTabIndex: 0,
    isLoading: false,
    error: null,
  });

  function openFile(path: string, content: string) {
    const existing = findTabByPath(path);
    if (existing !== -1) {
      setActiveTab(existing);
      return;
    }

    const language = getLanguageFromPath(path);
    const tab: EditorTab = {
      id: genId('tab'),
      file: { path, content, savedContent: content, language },
    };

    setState(
      produce((s) => {
        s.tabs.push(tab);
        s.activeTabIndex = s.tabs.length - 1;
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
        const tab = s.tabs[s.activeTabIndex];
        if (tab) {
          tab.file.content = content;
        }
      }),
    );
  }

  function markSaved() {
    setState(
      produce((s) => {
        const tab = s.tabs[s.activeTabIndex];
        if (tab) {
          tab.file.savedContent = tab.file.content;
        }
      }),
    );
  }

  function closeTab(tabId: string) {
    setState(
      produce((s) => {
        const idx = s.tabs.findIndex((t) => t.id === tabId);
        if (idx === -1) return;
        s.tabs.splice(idx, 1);
        if (s.tabs.length === 0) {
          s.activeTabIndex = 0;
        } else if (s.activeTabIndex >= s.tabs.length) {
          s.activeTabIndex = s.tabs.length - 1;
        }
        s.error = null;
      }),
    );
  }

  function closeFile() {
    const tab = state.tabs[state.activeTabIndex];
    if (tab) {
      closeTab(tab.id);
    }
  }

  function setActiveTab(index: number) {
    if (index >= 0 && index < state.tabs.length) {
      setState('activeTabIndex', index);
    }
  }

  function findTabByPath(path: string): number {
    return state.tabs.findIndex((t) => t.file.path === path);
  }

  function isDirty(tabIndex?: number): boolean {
    const idx = tabIndex ?? state.activeTabIndex;
    const tab = state.tabs[idx];
    if (!tab) return false;
    return tab.file.content !== tab.file.savedContent;
  }

  function isAnyDirty(): boolean {
    return state.tabs.some((t) => t.file.content !== t.file.savedContent);
  }

  function isLargeFile(): boolean {
    const tab = state.tabs[state.activeTabIndex];
    if (!tab) return false;
    const lineCount = tab.file.content.split('\n').length;
    return lineCount > LARGE_FILE_LINE_THRESHOLD;
  }

  function getActiveFile(): EditorFile | null {
    return state.tabs[state.activeTabIndex]?.file ?? null;
  }

  return {
    state,
    openFile,
    setLoading,
    setError,
    updateContent,
    markSaved,
    closeTab,
    closeFile,
    setActiveTab,
    findTabByPath,
    isDirty,
    isAnyDirty,
    isLargeFile,
    getActiveFile,
  };
}
