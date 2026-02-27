import { onMount, onCleanup, For, Show, createEffect } from 'solid-js';
import { createTerminalStore, type PaneNode } from '../lib/terminalState';
import XtermInstance from './XtermInstance';
import PaneContainer from './PaneContainer';

function TerminalPanel() {
  const { state, addTab, removeTab, setActiveTab, setActivePaneId, splitPane, closePane, resizeSplit } =
    createTerminalStore();

  onMount(() => {
    // Create initial tab
    addTab();
  });

  // Keyboard shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === 't') {
      e.preventDefault();
      addTab();
    } else if (meta && e.key === 'w') {
      e.preventDefault();
      const tab = state.tabs[state.activeTabIndex];
      if (tab && state.activePaneId) {
        closePane(tab.id, state.activePaneId);
      }
    } else if (meta && e.key === 'd') {
      e.preventDefault();
      const tab = state.tabs[state.activeTabIndex];
      if (tab && state.activePaneId) {
        splitPane(tab.id, state.activePaneId, e.shiftKey ? 'horizontal' : 'vertical');
      }
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div class="h-full w-full bg-[var(--color-bg-primary)] flex flex-col">
      {/* Tab bar */}
      <div class="flex items-center h-8 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div class="flex-1 flex items-center overflow-x-auto">
          <For each={state.tabs}>
            {(tab, index) => (
              <button
                class={`px-3 h-full text-xs flex items-center gap-1 border-r border-[var(--color-border)] ${
                  index() === state.activeTabIndex
                    ? 'bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]/50'
                }`}
                onClick={() => setActiveTab(index())}
              >
                <span>{tab.title}</span>
                <span
                  class="ml-1 hover:text-[var(--color-text-primary)] text-[10px] leading-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTab(tab.id);
                  }}
                >
                  x
                </span>
              </button>
            )}
          </For>
        </div>
        <button
          class="px-2 h-full text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          onClick={() => addTab()}
          title="New Terminal (Cmd+T)"
        >
          +
        </button>
      </div>

      {/* Active tab content */}
      <div class="flex-1 min-h-0">
        <Show when={state.tabs[state.activeTabIndex]}>
          {(tab) => (
            <PaneContainer
              node={tab().layout}
              activePaneId={state.activePaneId}
              onFocusPane={setActivePaneId}
              onResizeSplit={resizeSplit}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

export default TerminalPanel;
