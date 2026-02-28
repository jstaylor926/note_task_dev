import { describe, it, expect, vi } from 'vitest';

// Mock the language helper to avoid importing CodeMirror internals
vi.mock('../codemirrorLanguages', () => ({
  getLanguageFromPath: vi.fn((path: string) => {
    const dot = path.lastIndexOf('.');
    if (dot === -1) return undefined;
    return path.slice(dot + 1).toLowerCase();
  }),
}));

describe('editorState', () => {
  it('starts with no active file', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    expect(store.state.activeFile).toBeNull();
    expect(store.state.isLoading).toBe(false);
    expect(store.state.error).toBeNull();
  });

  it('opens a file with content and language detection', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/src/main.py', 'print("hello")');

    expect(store.state.activeFile).not.toBeNull();
    expect(store.state.activeFile!.path).toBe('/src/main.py');
    expect(store.state.activeFile!.content).toBe('print("hello")');
    expect(store.state.activeFile!.savedContent).toBe('print("hello")');
    expect(store.state.activeFile!.language).toBe('py');
  });

  it('detects rust language from file extension', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/src/lib.rs', 'fn main() {}');
    expect(store.state.activeFile!.language).toBe('rs');
  });

  it('isDirty returns false for freshly opened file', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/test.txt', 'original');
    expect(store.isDirty()).toBe(false);
  });

  it('isDirty returns true after content change', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/test.txt', 'original');
    store.updateContent('modified');
    expect(store.isDirty()).toBe(true);
    expect(store.state.activeFile!.content).toBe('modified');
    expect(store.state.activeFile!.savedContent).toBe('original');
  });

  it('isDirty returns false after markSaved', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/test.txt', 'original');
    store.updateContent('modified');
    expect(store.isDirty()).toBe(true);
    store.markSaved();
    expect(store.isDirty()).toBe(false);
    expect(store.state.activeFile!.savedContent).toBe('modified');
  });

  it('isDirty returns false when no file is open', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    expect(store.isDirty()).toBe(false);
  });

  it('closeFile clears active file', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/test.txt', 'content');
    expect(store.state.activeFile).not.toBeNull();
    store.closeFile();
    expect(store.state.activeFile).toBeNull();
  });

  it('setLoading sets loading state', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.setLoading(true);
    expect(store.state.isLoading).toBe(true);
    store.setLoading(false);
    expect(store.state.isLoading).toBe(false);
  });

  it('setError sets error and clears loading', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.setLoading(true);
    store.setError('File not found');
    expect(store.state.error).toBe('File not found');
    expect(store.state.isLoading).toBe(false);
  });

  it('openFile clears error state', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.setError('Some error');
    store.openFile('/test.txt', 'content');
    expect(store.state.error).toBeNull();
  });

  it('isLargeFile returns false for small files', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/test.txt', 'line 1\nline 2\nline 3');
    expect(store.isLargeFile()).toBe(false);
  });

  it('isLargeFile returns true for files over 50000 lines', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    const largeContent = Array(50001).fill('line').join('\n');
    store.openFile('/test.txt', largeContent);
    expect(store.isLargeFile()).toBe(true);
  });

  it('isLargeFile returns false when no file is open', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    expect(store.isLargeFile()).toBe(false);
  });

  it('opening a new file replaces the active file', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/first.txt', 'first');
    store.openFile('/second.py', 'second');
    expect(store.state.activeFile!.path).toBe('/second.py');
    expect(store.state.activeFile!.content).toBe('second');
  });
});
