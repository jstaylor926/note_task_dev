import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../codemirrorLanguages', () => ({
  getLanguageFromPath: vi.fn((path: string) => {
    const dot = path.lastIndexOf('.');
    if (dot === -1) return undefined;
    return path.slice(dot + 1).toLowerCase();
  }),
}));

describe('editorState (multi-tab)', () => {
  beforeEach(async () => {
    const { resetIdCounter } = await import('../editorState');
    resetIdCounter();
  });

  it('starts with no tabs', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    expect(store.state.tabs.length).toBe(0);
    expect(store.state.activeTabIndex).toBe(0);
    expect(store.state.isLoading).toBe(false);
    expect(store.state.error).toBeNull();
    expect(store.getActiveFile()).toBeNull();
  });

  it('opens a file as a new tab', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/src/main.py', 'print("hello")');

    expect(store.state.tabs.length).toBe(1);
    expect(store.state.activeTabIndex).toBe(0);
    const file = store.getActiveFile();
    expect(file).not.toBeNull();
    expect(file!.path).toBe('/src/main.py');
    expect(file!.content).toBe('print("hello")');
    expect(file!.savedContent).toBe('print("hello")');
    expect(file!.language).toBe('py');
  });

  it('opens multiple files as separate tabs', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/first.txt', 'first');
    store.openFile('/second.py', 'second');

    expect(store.state.tabs.length).toBe(2);
    expect(store.state.activeTabIndex).toBe(1);
    expect(store.getActiveFile()!.path).toBe('/second.py');
  });

  it('deduplicates — switches to existing tab instead of creating new', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/first.txt', 'first');
    store.openFile('/second.py', 'second');
    store.openFile('/first.txt', 'first again');

    expect(store.state.tabs.length).toBe(2);
    expect(store.state.activeTabIndex).toBe(0);
    expect(store.getActiveFile()!.path).toBe('/first.txt');
    // Content should NOT be replaced
    expect(store.getActiveFile()!.content).toBe('first');
  });

  it('setActiveTab switches between tabs', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/a.txt', 'a');
    store.openFile('/b.txt', 'b');
    store.openFile('/c.txt', 'c');

    store.setActiveTab(0);
    expect(store.getActiveFile()!.path).toBe('/a.txt');
    store.setActiveTab(2);
    expect(store.getActiveFile()!.path).toBe('/c.txt');
  });

  it('setActiveTab ignores out-of-range indices', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/a.txt', 'a');

    store.setActiveTab(-1);
    expect(store.state.activeTabIndex).toBe(0);
    store.setActiveTab(5);
    expect(store.state.activeTabIndex).toBe(0);
  });

  it('closeTab removes a tab and adjusts activeTabIndex', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/a.txt', 'a');
    store.openFile('/b.txt', 'b');
    store.openFile('/c.txt', 'c');

    const tabBId = store.state.tabs[1].id;
    store.setActiveTab(2);
    store.closeTab(tabBId);

    expect(store.state.tabs.length).toBe(2);
    // Active was at index 2, which is now 1 after removal of index 1
    expect(store.state.activeTabIndex).toBe(1);
    expect(store.getActiveFile()!.path).toBe('/c.txt');
  });

  it('closeTab adjusts when closing the last tab index', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/a.txt', 'a');
    store.openFile('/b.txt', 'b');

    // Active is tab 1 (b.txt)
    const tabBId = store.state.tabs[1].id;
    store.closeTab(tabBId);

    expect(store.state.tabs.length).toBe(1);
    expect(store.state.activeTabIndex).toBe(0);
    expect(store.getActiveFile()!.path).toBe('/a.txt');
  });

  it('closeTab results in empty state when last tab closed', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/a.txt', 'a');

    store.closeTab(store.state.tabs[0].id);

    expect(store.state.tabs.length).toBe(0);
    expect(store.getActiveFile()).toBeNull();
  });

  it('closeFile closes the active tab (backward compat)', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/a.txt', 'a');
    store.openFile('/b.txt', 'b');

    store.closeFile();

    expect(store.state.tabs.length).toBe(1);
    expect(store.getActiveFile()!.path).toBe('/a.txt');
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
  });

  it('isDirty returns false after markSaved', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/test.txt', 'original');
    store.updateContent('modified');
    store.markSaved();
    expect(store.isDirty()).toBe(false);
  });

  it('isDirty checks specific tab by index', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/a.txt', 'a');
    store.openFile('/b.txt', 'b');
    store.updateContent('b-modified');

    expect(store.isDirty(0)).toBe(false);
    expect(store.isDirty(1)).toBe(true);
  });

  it('isAnyDirty returns true if any tab is dirty', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/a.txt', 'a');
    store.openFile('/b.txt', 'b');

    expect(store.isAnyDirty()).toBe(false);
    store.updateContent('b-modified');
    expect(store.isAnyDirty()).toBe(true);
  });

  it('isDirty returns false when no tabs', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    expect(store.isDirty()).toBe(false);
  });

  it('findTabByPath returns index or -1', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.openFile('/a.txt', 'a');
    store.openFile('/b.txt', 'b');

    expect(store.findTabByPath('/a.txt')).toBe(0);
    expect(store.findTabByPath('/b.txt')).toBe(1);
    expect(store.findTabByPath('/c.txt')).toBe(-1);
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

  it('isLargeFile returns false when no tabs', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    expect(store.isLargeFile()).toBe(false);
  });

  it('setLoading and setError work correctly', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.setLoading(true);
    expect(store.state.isLoading).toBe(true);
    store.setError('Some error');
    expect(store.state.error).toBe('Some error');
    expect(store.state.isLoading).toBe(false);
  });

  it('openFile clears error state', async () => {
    const { createEditorStore } = await import('../editorState');
    const store = createEditorStore();
    store.setError('Some error');
    store.openFile('/test.txt', 'content');
    expect(store.state.error).toBeNull();
  });
});
