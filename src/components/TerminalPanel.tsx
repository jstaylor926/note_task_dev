import { onMount, onCleanup, For, Show, createEffect, createSignal } from 'solid-js';
import { type PaneNode, getActiveSessionId } from '../lib/terminalState';
import { terminalStore } from '../lib/terminalStoreInstance';
import { translateTerminalCommand, type TerminalTranslateResponse } from '../lib/tauri';
import XtermInstance from './XtermInstance';
import PaneContainer from './PaneContainer';
import ChatPanel from './ChatPanel';

function TerminalPanel() {
  const { state, addTab, removeTab, setActiveTab, setActivePaneId, splitPane, closePane, resizeSplit } =
    terminalStore;

  const [showTranslate, setShowTranslate] = createSignal(false);
  const [translateQuery, setTranslateQuery] = createSignal("");
  const [isTranslating, setIsTranslating] = createSignal(false);
  const [translation, setTranslation] = createSignal<TerminalTranslateResponse | null>(null);
  const [showChat, setShowChat] = createSignal(false);
  const [chatWidth, setChatWidth] = createSignal(320);
  let chatContainerRef: HTMLDivElement | undefined;

  const handleTranslate = async (e: Event) => {
    e.preventDefault();
    const query = translateQuery().trim();
    if (!query || isTranslating()) return;

    setIsTranslating(true);
    setTranslation(null);
    try {
      const res = await translateTerminalCommand(query);
      setTranslation(res);
    } catch (e) {
      console.error("Translation failed:", e);
    } finally {
      setIsTranslating(false);
    }
  };

  const runSuggestedCommand = () => {
    const res = translation();
    const tab = state.tabs[state.activeTabIndex];
    if (res && tab && state.activePaneId) {
      const sessionId = getActiveSessionId(tab.layout, state.activePaneId);
      if (!sessionId) return;
      const event = new CustomEvent('terminal:run-command', {
        detail: { sessionId, command: res.command }
      });
      window.dispatchEvent(event);
      setShowTranslate(false);
      setTranslation(null);
      setTranslateQuery("");
    }
  };

  function handleChatResizeMouseDown(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = chatWidth();

    function onMouseMove(moveEvent: MouseEvent) {
      const delta = startX - moveEvent.clientX;
      const containerWidth = chatContainerRef?.clientWidth ?? 800;
      const maxWidth = containerWidth * 0.5;
      const newWidth = Math.max(200, Math.min(maxWidth, startWidth + delta));
      setChatWidth(newWidth);
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

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
        <div class="ml-auto flex items-center gap-1 pr-2 border-l border-[var(--color-border)] ml-2">
          <button
            class={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${
              showTranslate()
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
            onClick={() => setShowTranslate(!showTranslate())}
          >
            ASK AI
          </button>
          <button
            class={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${
              showChat()
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
            onClick={() => setShowChat(!showChat())}
          >
            CHAT
          </button>
        </div>
      </div>

      {/* NL to Shell UI */}
      <Show when={showTranslate()}>
        <div class="bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)] p-2">
          <form onSubmit={handleTranslate} class="flex gap-2">
            <input
              type="text"
              autofocus
              value={translateQuery()}
              onInput={(e) => setTranslateQuery(e.currentTarget.value)}
              placeholder="What do you want to do? (e.g., 'list all ts files')"
              class="flex-1 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="submit"
              disabled={isTranslating() || !translateQuery().trim()}
              class="px-3 py-1 bg-[var(--color-accent)] text-white text-xs rounded hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {isTranslating() ? "Translating..." : "Translate"}
            </button>
            <button 
              type="button"
              onClick={() => {
                setShowTranslate(false);
                setTranslation(null);
                setTranslateQuery("");
              }}
              class="px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              Cancel
            </button>
          </form>

          <Show when={translation()}>
            <div class="mt-2 p-2 bg-[var(--color-bg-primary)] rounded border border-[var(--color-accent)]/30">
              <div class="flex items-center justify-between mb-1">
                <span class="text-[10px] font-bold text-[var(--color-accent)] uppercase tracking-tight">Suggested Command</span>
                <span class="text-[10px] text-[var(--color-text-secondary)]">Confidence: {(translation()!.confidence * 100).toFixed(0)}%</span>
              </div>
              <code class="block text-xs text-[var(--color-text-primary)] bg-black/30 p-1.5 rounded mb-2 font-mono">{translation()!.command}</code>
              <p class="text-[11px] text-[var(--color-text-secondary)] mb-2 italic">{translation()!.explanation}</p>
              <button
                onClick={runSuggestedCommand}
                class="text-[10px] font-bold text-white bg-[var(--color-success)] px-2 py-1 rounded hover:opacity-90"
              >
                Execute Command
              </button>
            </div>
          </Show>
        </div>
      </Show>

      {/* Active tab content + chat split */}
      <div ref={chatContainerRef} class="flex-1 min-h-0 flex flex-row">
        <div class="flex-1 min-h-0 min-w-0">
          <Show when={state.tabs[state.activeTabIndex]}>
            {(tab) => (
              <PaneContainer
                node={tab().layout}
                activePaneId={state.activePaneId}
                onFocusPane={setActivePaneId}
                onResizeSplit={resizeSplit}
                onExit={(paneId) => closePane(tab().id, paneId)}
              />
            )}
          </Show>
        </div>
        <Show when={showChat()}>
          <div
            class="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
            onMouseDown={handleChatResizeMouseDown}
          />
          <div
            class="shrink-0 min-h-0 overflow-hidden"
            style={{ width: `${chatWidth()}px` }}
          >
            <ChatPanel />
          </div>
        </Show>
      </div>
    </div>
  );
}

export default TerminalPanel;
