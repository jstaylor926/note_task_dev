import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'solid-js';
import { createTerminalStore, resetIdCounter } from '../terminalState';

beforeEach(() => {
  resetIdCounter();
});

describe('terminalState', () => {
  it('starts with empty tabs', () => {
    createRoot((dispose) => {
      const { state } = createTerminalStore();
      expect(state.tabs.length).toBe(0);
      expect(state.activeTabIndex).toBe(0);
      expect(state.activePaneId).toBe(null);
      dispose();
    });
  });

  it('creates an initial tab with addTab', () => {
    createRoot((dispose) => {
      const { state, addTab } = createTerminalStore();
      addTab();
      expect(state.tabs.length).toBe(1);
      expect(state.tabs[0].title).toBe('Terminal 1');
      expect(state.tabs[0].layout.type).toBe('pane');
      expect(state.activePaneId).not.toBe(null);
      dispose();
    });
  });

  it('adds new tab and activates it', () => {
    createRoot((dispose) => {
      const { state, addTab } = createTerminalStore();
      addTab();
      addTab();
      expect(state.tabs.length).toBe(2);
      expect(state.activeTabIndex).toBe(1);
      expect(state.tabs[1].title).toBe('Terminal 2');
      dispose();
    });
  });

  it('removes tab and selects adjacent', () => {
    createRoot((dispose) => {
      const { state, addTab, removeTab, setActiveTab } = createTerminalStore();
      addTab();
      addTab();
      addTab();
      setActiveTab(1);

      const tabId = state.tabs[1].id;
      removeTab(tabId);

      expect(state.tabs.length).toBe(2);
      expect(state.activeTabIndex).toBe(1);
      dispose();
    });
  });

  it('removes last tab and resets state', () => {
    createRoot((dispose) => {
      const { state, addTab, removeTab } = createTerminalStore();
      addTab();
      const tabId = state.tabs[0].id;
      removeTab(tabId);
      expect(state.tabs.length).toBe(0);
      expect(state.activePaneId).toBe(null);
      dispose();
    });
  });

  it('splits pane vertically', () => {
    createRoot((dispose) => {
      const { state, addTab, splitPane } = createTerminalStore();
      addTab();
      const tabId = state.tabs[0].id;
      const paneId = state.activePaneId!;
      splitPane(tabId, paneId, 'vertical');

      const layout = state.tabs[0].layout;
      expect(layout.type).toBe('split');
      if (layout.type === 'split') {
        expect(layout.direction).toBe('vertical');
        expect(layout.children.length).toBe(2);
        expect(layout.sizes).toEqual([50, 50]);
      }
      dispose();
    });
  });

  it('closes pane and collapses parent split', () => {
    createRoot((dispose) => {
      const { state, addTab, splitPane, closePane } = createTerminalStore();
      addTab();
      const tabId = state.tabs[0].id;
      const originalPaneId = state.activePaneId!;
      splitPane(tabId, originalPaneId, 'vertical');

      // Active pane should now be the new pane
      const newPaneId = state.activePaneId!;
      expect(newPaneId).not.toBe(originalPaneId);

      // Close the new pane — should collapse back to single pane
      closePane(tabId, newPaneId);
      expect(state.tabs[0].layout.type).toBe('pane');
      dispose();
    });
  });

  it('closing last pane removes tab', () => {
    createRoot((dispose) => {
      const { state, addTab, closePane } = createTerminalStore();
      addTab();
      const tabId = state.tabs[0].id;
      const paneId = state.activePaneId!;
      closePane(tabId, paneId);
      expect(state.tabs.length).toBe(0);
      dispose();
    });
  });

  it('setActiveTab updates index', () => {
    createRoot((dispose) => {
      const { state, addTab, setActiveTab } = createTerminalStore();
      addTab();
      addTab();
      setActiveTab(0);
      expect(state.activeTabIndex).toBe(0);
      dispose();
    });
  });
});
