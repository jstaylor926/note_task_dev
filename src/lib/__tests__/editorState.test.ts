import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'solid-js';
import type { SerializedEditorState } from '../editorState';

vi.mock('../codemirrorLanguages', () => ({
  getLanguageFromPath: vi.fn((path: string) => {
    const dot = path.lastIndexOf('.');
    if (dot === -1) return undefined;
    return path.slice(dot + 1).toLowerCase();
  }),
}));

beforeEach(async () => {
  const { resetIdCounter } = await import('../editorState');
  resetIdCounter();
});

describe('editorState (pane-tree API)', () => {
  it('starts with an empty pane layout', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      expect(store.state.layout.type).toBe('pane');
      expect(store.state.activePaneId).not.toBeNull();
      expect(store.state.isLoading).toBe(false);
      expect(store.state.error).toBeNull();
      expect(store.getActiveFile()).toBeNull();
      if (store.state.layout.type === 'pane') {
        expect(store.state.layout.tabs.length).toBe(0);
      }
      dispose();
    });
  });

  it('opens a file as a new tab in the active pane', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/src/main.py', 'print("hello")');

      const layout = store.state.layout;
      expect(layout.type).toBe('pane');
      if (layout.type === 'pane') {
        expect(layout.tabs.length).toBe(1);
        expect(layout.activeTabIndex).toBe(0);
      }
      const file = store.getActiveFile();
      expect(file).not.toBeNull();
      expect(file!.path).toBe('/src/main.py');
      expect(file!.content).toBe('print("hello")');
      expect(file!.savedContent).toBe('print("hello")');
      expect(file!.language).toBe('py');
      dispose();
    });
  });

  it('opens multiple files as separate tabs', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/first.txt', 'first');
      store.openFile('/second.py', 'second');

      if (store.state.layout.type === 'pane') {
        expect(store.state.layout.tabs.length).toBe(2);
        expect(store.state.layout.activeTabIndex).toBe(1);
      }
      expect(store.getActiveFile()!.path).toBe('/second.py');
      dispose();
    });
  });

  it('deduplicates — switches to existing tab instead of creating new', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/first.txt', 'first');
      store.openFile('/second.py', 'second');
      store.openFile('/first.txt', 'first again');

      if (store.state.layout.type === 'pane') {
        expect(store.state.layout.tabs.length).toBe(2);
        expect(store.state.layout.activeTabIndex).toBe(0);
      }
      expect(store.getActiveFile()!.path).toBe('/first.txt');
      expect(store.getActiveFile()!.content).toBe('first');
      dispose();
    });
  });

  it('setTabInPane switches between tabs', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'a');
      store.openFile('/b.txt', 'b');
      store.openFile('/c.txt', 'c');

      const paneId = store.state.activePaneId!;
      store.setTabInPane(paneId, 0);
      expect(store.getActiveFile()!.path).toBe('/a.txt');
      store.setTabInPane(paneId, 2);
      expect(store.getActiveFile()!.path).toBe('/c.txt');
      dispose();
    });
  });

  it('closeTab removes a tab and adjusts activeTabIndex', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'a');
      store.openFile('/b.txt', 'b');
      store.openFile('/c.txt', 'c');

      const paneId = store.state.activePaneId!;
      // Active is at index 2 (c.txt), close index 1 (b.txt)
      store.closeTab(paneId, 1);

      if (store.state.layout.type === 'pane') {
        expect(store.state.layout.tabs.length).toBe(2);
      }
      expect(store.getActiveFile()!.path).toBe('/c.txt');
      dispose();
    });
  });

  it('closeTab adjusts when closing the last tab index', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'a');
      store.openFile('/b.txt', 'b');

      const paneId = store.state.activePaneId!;
      // Active is at index 1 (b.txt), close it
      store.closeTab(paneId, 1);

      if (store.state.layout.type === 'pane') {
        expect(store.state.layout.tabs.length).toBe(1);
        expect(store.state.layout.activeTabIndex).toBe(0);
      }
      expect(store.getActiveFile()!.path).toBe('/a.txt');
      dispose();
    });
  });

  it('closeTab results in empty pane when last tab closed', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'a');

      const paneId = store.state.activePaneId!;
      store.closeTab(paneId, 0);

      if (store.state.layout.type === 'pane') {
        expect(store.state.layout.tabs.length).toBe(0);
      }
      expect(store.getActiveFile()).toBeNull();
      dispose();
    });
  });

  it('closeActiveFile closes the active tab', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'a');
      store.openFile('/b.txt', 'b');

      store.closeActiveFile();

      if (store.state.layout.type === 'pane') {
        expect(store.state.layout.tabs.length).toBe(1);
      }
      expect(store.getActiveFile()!.path).toBe('/a.txt');
      dispose();
    });
  });

  it('isDirty returns false for freshly opened file', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/test.txt', 'original');
      const paneId = store.state.activePaneId!;
      expect(store.isDirty(paneId, 0)).toBe(false);
      dispose();
    });
  });

  it('isDirty returns true after content change', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/test.txt', 'original');
      store.updateContent('modified');
      const paneId = store.state.activePaneId!;
      expect(store.isDirty(paneId, 0)).toBe(true);
      dispose();
    });
  });

  it('isDirty returns false after markSaved', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/test.txt', 'original');
      store.updateContent('modified');
      store.markSaved();
      const paneId = store.state.activePaneId!;
      expect(store.isDirty(paneId, 0)).toBe(false);
      dispose();
    });
  });

  it('isAnyDirty returns true if any tab is dirty', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'a');
      store.openFile('/b.txt', 'b');

      expect(store.isAnyDirty()).toBe(false);
      store.updateContent('b-modified');
      expect(store.isAnyDirty()).toBe(true);
      dispose();
    });
  });

  it('setLoading and setError work correctly', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.setLoading(true);
      expect(store.state.isLoading).toBe(true);
      store.setError('Some error');
      expect(store.state.error).toBe('Some error');
      expect(store.state.isLoading).toBe(false);
      dispose();
    });
  });

  it('openFile clears error state', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.setError('Some error');
      store.openFile('/test.txt', 'content');
      expect(store.state.error).toBeNull();
      dispose();
    });
  });

  // ─── Split / Close Pane ─────────────────────────────────────────────

  it('splitPane creates a split layout with two children', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'a');

      const originalPaneId = store.state.activePaneId!;
      store.splitPane(originalPaneId, 'vertical');

      expect(store.state.layout.type).toBe('split');
      if (store.state.layout.type === 'split') {
        expect(store.state.layout.direction).toBe('vertical');
        expect(store.state.layout.children.length).toBe(2);
        expect(store.state.layout.sizes).toEqual([50, 50]);
      }
      // Active pane should be the new pane
      expect(store.state.activePaneId).not.toBe(originalPaneId);
      dispose();
    });
  });

  it('closePane removes a pane from split and collapses', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'a');

      const originalPaneId = store.state.activePaneId!;
      store.splitPane(originalPaneId, 'vertical');

      const newPaneId = store.state.activePaneId!;
      // Close the new pane — should collapse back to single pane
      store.closePane(newPaneId);

      expect(store.state.layout.type).toBe('pane');
      expect(store.state.activePaneId).toBe(originalPaneId);
      dispose();
    });
  });

  it('closePane does nothing when trying to close the last pane', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      const paneId = store.state.activePaneId!;
      store.closePane(paneId);

      // Should still be a pane
      expect(store.state.layout.type).toBe('pane');
      expect(store.state.activePaneId).toBe(paneId);
      dispose();
    });
  });

  it('resizeSplit updates split sizes', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'a');

      const paneId = store.state.activePaneId!;
      store.splitPane(paneId, 'vertical');

      expect(store.state.layout.type).toBe('split');
      const splitId = store.state.layout.id;
      store.resizeSplit(splitId, [30, 70]);

      if (store.state.layout.type === 'split') {
        expect(store.state.layout.sizes).toEqual([30, 70]);
      }
      dispose();
    });
  });

  it('setActivePane switches the active pane', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'a');

      const firstPaneId = store.state.activePaneId!;
      store.splitPane(firstPaneId, 'vertical');
      const secondPaneId = store.state.activePaneId!;

      expect(store.state.activePaneId).toBe(secondPaneId);
      store.setActivePane(firstPaneId);
      expect(store.state.activePaneId).toBe(firstPaneId);
      dispose();
    });
  });

  // ─── Serialization / Restore ────────────────────────────────────────

  it('getSerializedState strips file content, keeps paths', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'aaa content');
      store.openFile('/b.py', 'bbb content');

      const serialized = store.getSerializedState();
      expect(serialized.activePaneId).toBe(store.state.activePaneId);
      expect(serialized.layout.type).toBe('pane');
      if (serialized.layout.type === 'pane') {
        expect(serialized.layout.tabs.length).toBe(2);
        expect(serialized.layout.tabs[0].path).toBe('/a.txt');
        expect(serialized.layout.tabs[1].path).toBe('/b.py');
        // Content should NOT be present
        expect((serialized.layout.tabs[0] as any).content).toBeUndefined();
        expect((serialized.layout.tabs[0] as any).savedContent).toBeUndefined();
      }
      dispose();
    });
  });

  it('restoreLayout rebuilds tree with file contents from disk', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();

      const serialized: SerializedEditorState = {
        layout: {
          type: 'pane',
          id: 'pane-1',
          tabs: [
            { path: '/a.txt', language: 'txt' },
            { path: '/b.py', language: 'py' },
          ],
          activeTabIndex: 1,
        },
        activePaneId: 'pane-1',
      };

      const fileContents = new Map([
        ['/a.txt', 'restored a'],
        ['/b.py', 'restored b'],
      ]);

      store.restoreLayout(serialized, fileContents);

      expect(store.state.layout.type).toBe('pane');
      if (store.state.layout.type === 'pane') {
        expect(store.state.layout.tabs.length).toBe(2);
        expect(store.state.layout.tabs[0].content).toBe('restored a');
        expect(store.state.layout.tabs[1].content).toBe('restored b');
        expect(store.state.layout.activeTabIndex).toBe(1);
      }
      expect(store.state.activePaneId).toBe('pane-1');
      dispose();
    });
  });

  it('restoreLayout handles missing files gracefully', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();

      const serialized: SerializedEditorState = {
        layout: {
          type: 'pane',
          id: 'pane-1',
          tabs: [
            { path: '/exists.txt', language: 'txt' },
            { path: '/deleted.txt', language: 'txt' },
          ],
          activeTabIndex: 1,
        },
        activePaneId: 'pane-1',
      };

      // Only /exists.txt is available
      const fileContents = new Map([['/exists.txt', 'content']]);

      store.restoreLayout(serialized, fileContents);

      if (store.state.layout.type === 'pane') {
        expect(store.state.layout.tabs.length).toBe(1);
        expect(store.state.layout.tabs[0].path).toBe('/exists.txt');
        // activeTabIndex clamped to 0
        expect(store.state.layout.activeTabIndex).toBe(0);
      }
      dispose();
    });
  });

  it('round-trip: serialize then restore produces equivalent layout', async () => {
    const { createEditorStore } = await import('../editorState');
    createRoot((dispose) => {
      const store = createEditorStore();
      store.openFile('/a.txt', 'content a');
      store.openFile('/b.py', 'content b');

      const paneId = store.state.activePaneId!;
      store.splitPane(paneId, 'vertical');

      const serialized = store.getSerializedState();

      // Create a fresh store and restore
      const store2 = createEditorStore();
      const fileContents = new Map([
        ['/a.txt', 'content a'],
        ['/b.py', 'content b'],
      ]);
      store2.restoreLayout(serialized, fileContents);

      expect(store2.state.layout.type).toBe('split');
      if (store2.state.layout.type === 'split') {
        expect(store2.state.layout.children.length).toBe(2);
        expect(store2.state.layout.direction).toBe('vertical');
      }
      dispose();
    });
  });
});
