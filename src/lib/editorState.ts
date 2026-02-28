import { createStore, produce } from 'solid-js/store';
import { getLanguageFromPath } from './codemirrorLanguages';

export interface EditorFile {
  path: string;
  content: string;
  savedContent: string;
  language: string | undefined;
}

interface EditorState {
  activeFile: EditorFile | null;
  isLoading: boolean;
  error: string | null;
}

const LARGE_FILE_LINE_THRESHOLD = 50000;

export function createEditorStore() {
  const [state, setState] = createStore<EditorState>({
    activeFile: null,
    isLoading: false,
    error: null,
  });

  function openFile(path: string, content: string) {
    const language = getLanguageFromPath(path);
    setState(
      produce((s) => {
        s.activeFile = {
          path,
          content,
          savedContent: content,
          language,
        };
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
        if (s.activeFile) {
          s.activeFile.content = content;
        }
      }),
    );
  }

  function markSaved() {
    setState(
      produce((s) => {
        if (s.activeFile) {
          s.activeFile.savedContent = s.activeFile.content;
        }
      }),
    );
  }

  function closeFile() {
    setState(
      produce((s) => {
        s.activeFile = null;
        s.error = null;
      }),
    );
  }

  function isDirty(): boolean {
    const file = state.activeFile;
    if (!file) return false;
    return file.content !== file.savedContent;
  }

  function isLargeFile(): boolean {
    const file = state.activeFile;
    if (!file) return false;
    const lineCount = file.content.split('\n').length;
    return lineCount > LARGE_FILE_LINE_THRESHOLD;
  }

  return {
    state,
    openFile,
    setLoading,
    setError,
    updateContent,
    markSaved,
    closeFile,
    isDirty,
    isLargeFile,
  };
}
