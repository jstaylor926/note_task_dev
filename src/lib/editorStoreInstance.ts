import { createEditorStore } from './editorState';

// Shared singleton editor store used across panels without importing the full EditorPanel module.
export const editorStore = createEditorStore();

