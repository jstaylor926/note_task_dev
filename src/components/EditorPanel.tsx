import { Show, For, createMemo, createSignal, createEffect, on, onMount } from 'solid-js';
import CodeMirrorEditor from './CodeMirrorEditor';
import { type EditorPaneNode, type EditorFile, type SerializedEditorState, type SerializedLayout } from '../lib/editorState';
import { fileRead, fileWrite } from '../lib/files';
import { getRunCommand } from '../lib/runFile';
import { getActiveSessionId } from '../lib/terminalState';
import { terminalStore } from '../lib/terminalStoreInstance';
import { ptyWrite } from '../lib/pty';
import { getLinksForFile } from '../lib/editorLinks';
import type { LinkWithEntity } from '../lib/entityLinks';
import { saveEditorLayout, getEditorLayout } from '../lib/tauri';
import { editorStore } from '../lib/editorStoreInstance';

export { editorStore };

export async function handleOpenFile(path: string) {
  editorStore.setLoading(true);
  try {
    const response = await fileRead(path);
    editorStore.openFile(response.path, response.content);
  } catch (e) {
    editorStore.setError(`Failed to open file: ${e}`);
  }
}

async function handleSave() {
  const file = editorStore.getActiveFile();
  if (!file) return;
  try {
    await fileWrite(file.path, file.content);
    editorStore.markSaved();
  } catch (e) {
    editorStore.setError(`Failed to save: ${e}`);
  }
}

function handleRunInTerminal() {
  const file = editorStore.getActiveFile();
  if (!file) return;
  const cmd = getRunCommand(file.path, file.language);
  if (!cmd) return;

  const tab = terminalStore.state.tabs[terminalStore.state.activeTabIndex];
  if (!tab) return;
  const sessionId = getActiveSessionId(tab.layout, terminalStore.state.activePaneId);
  if (!sessionId) return;

  const encoded = btoa(cmd + '\n');
  ptyWrite(sessionId, encoded);
}

function handleKeyDown(e: KeyboardEvent) {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key === 's') {
    e.preventDefault();
    handleSave();
  } else if (meta && e.key === 'w') {
    e.preventDefault();
    e.stopPropagation();
    editorStore.closeActiveFile();
  } else if (meta && e.key === 'Enter' && meta) {
    e.preventDefault();
    handleRunInTerminal();
  } else if (meta && e.key === '\\') {
    e.preventDefault();
    if (editorStore.state.activePaneId) {
      editorStore.splitPane(editorStore.state.activePaneId, e.shiftKey ? 'horizontal' : 'vertical');
    }
  }
}

function collectPaths(layout: SerializedLayout): string[] {
  if (layout.type === 'pane') {
    return layout.tabs.map((t) => t.path);
  }
  return layout.children.flatMap(collectPaths);
}

async function restoreEditorLayout() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const json = await getEditorLayout();
    if (!json) return;
    const serialized: SerializedEditorState = JSON.parse(json);
    const paths = collectPaths(serialized.layout);
    if (paths.length === 0) return;

    const fileContents = new Map<string, string>();
    const results = await Promise.allSettled(paths.map((p) => fileRead(p)));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        fileContents.set(result.value.path, result.value.content);
      }
    }
    if (fileContents.size > 0) {
      editorStore.restoreLayout(serialized, fileContents);
    }
  } catch (e) {
    console.error('Failed to restore editor layout:', e);
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function debouncedSaveLayout() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const serialized = editorStore.getSerializedState();
    saveEditorLayout(JSON.stringify(serialized)).catch((e) => {
      console.error('Failed to save editor layout:', e);
    });
  }, 1000);
}

function EditorPanel() {
  onMount(() => {
    console.log("EditorPanel mounted, initial layout:", editorStore.state.layout);
    restoreEditorLayout();
  });

  // Watch layout changes and persist with debounce
  createEffect(
    on(
      () => JSON.stringify(editorStore.getSerializedState()),
      () => {
        debouncedSaveLayout();
      },
      { defer: true },
    ),
  );

  return (
    <div
      class="h-full w-full flex flex-col bg-[var(--color-bg-primary)] overflow-hidden"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <Show
        when={!editorStore.state.isLoading}
        fallback={
          <div class="h-full flex items-center justify-center">
            <span class="text-sm text-[var(--color-text-secondary)] animate-pulse">
              Loading...
            </span>
          </div>
        }
      >
        <Show
          when={!editorStore.state.error}
          fallback={
            <div class="h-full flex items-center justify-center">
              <span class="text-sm text-[var(--color-error)]">
                {editorStore.state.error}
              </span>
            </div>
          }
        >
          <div class="flex-1 min-h-0 relative">
            <EditorPaneContainer node={editorStore.state.layout} />
          </div>
        </Show>
      </Show>
    </div>
  );
}

function EditorPaneContainer(props: { node: EditorPaneNode }) {
  if (props.node.type === 'pane') {
    return <EditorPane id={props.node.id} />;
  }

  const direction = props.node.direction;
  const children = props.node.children;
  const sizes = props.node.sizes;

  return (
    <div
      class={`h-full w-full flex ${
        direction === 'vertical' ? 'flex-row' : 'flex-col'
      }`}
    >
      <For each={children}>
        {(child, index) => (
          <>
            <div
              style={{
                [direction === 'vertical' ? 'width' : 'height']: `${sizes[index()]}%`,
              }}
              class="overflow-hidden flex-shrink-0"
            >
              <EditorPaneContainer node={child} />
            </div>
            {index() < children.length - 1 && (
              <div
                class={`shrink-0 bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors z-10 ${
                  direction === 'vertical'
                    ? 'w-1 cursor-col-resize'
                    : 'h-1 cursor-row-resize'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startPos = direction === 'vertical' ? e.clientX : e.clientY;
                  const startSizes = [...sizes];
                  const container = (e.target as HTMLElement).parentElement;
                  if (!container) return;
                  const totalSize = direction === 'vertical' ? container.clientWidth : container.clientHeight;

                  const onMouseMove = (moveEvent: MouseEvent) => {
                    const currentPos = direction === 'vertical' ? moveEvent.clientX : moveEvent.clientY;
                    const delta = ((currentPos - startPos) / totalSize) * 100;
                    const newSizes = [...startSizes];
                    newSizes[index()] = Math.max(10, startSizes[index()] + delta);
                    newSizes[index() + 1] = Math.max(10, startSizes[index() + 1] - delta);
                    const total = newSizes.reduce((a, b) => a + b, 0);
                    editorStore.resizeSplit(props.node.id, newSizes.map(s => (s / total) * 100));
                  };

                  const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                  };

                  document.addEventListener('mousemove', onMouseMove);
                  document.addEventListener('mouseup', onMouseUp);
                }}
              />
            )}
          </>
        )}
      </For>
    </div>
  );
}

function EditorPane(props: { id: string }) {
  const pane = createMemo(() => {
    return findPaneById(editorStore.state.layout, props.id);
  });

  const isActive = createMemo(() => editorStore.state.activePaneId === props.id);
  const activeFile = createMemo(() => {
    const p = pane();
    if (p && p.type === 'pane') {
      return p.tabs[p.activeTabIndex];
    }
    return null;
  });

  return (
    <div 
      class={`h-full w-full flex flex-col min-h-0 relative ${isActive() ? 'ring-1 ring-[var(--color-accent)]/20 z-10' : ''}`}
      onClick={() => editorStore.setActivePane(props.id)}
    >
      <EditorTabBar paneId={props.id} />
      <div class="flex-1 min-h-0 relative bg-[var(--color-bg-primary)]">
        <Show 
          when={activeFile()} 
          fallback={<WelcomeView onOpenFile={handleOpenFile} />}
        >
          {(file) => (
            <CodeMirrorEditor
              content={file().content}
              path={file().path}
              language={file().language}
              onContentChange={(content) => editorStore.updateContent(content)}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

function EditorTabBar(props: { paneId: string }) {
  const pane = createMemo(() => {
    return findPaneById(editorStore.state.layout, props.paneId);
  });
  const paneNode = createMemo(() => {
    const current = pane();
    return current && current.type === 'pane' ? current : null;
  });

  return (
    <div class="flex items-center h-8 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] overflow-x-auto no-scrollbar">
      <For each={paneNode()?.tabs ?? []}>
        {(tab, index) => {
          const isTabActive = createMemo(() => paneNode()?.activeTabIndex === index());
          const dirty = createMemo(() => editorStore.isDirty(props.paneId, index()));
          const fileName = tab.path.split('/').pop() || 'untitled';

          return (
            <button
              data-testid={`editor-tab-${index()}`}
              class={`px-3 h-full text-xs flex items-center gap-2 border-r border-[var(--color-border)] whitespace-nowrap transition-colors ${
                isTabActive()
                  ? 'bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-[inset_0_-1px_0_var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]/50'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                editorStore.setActivePane(props.paneId);
                editorStore.setTabInPane(props.paneId, index());
              }}
            >
              <span class="font-mono">
                {fileName}
                <Show when={dirty()}>
                  <span class="text-[var(--color-accent)] ml-1">*</span>
                </Show>
              </span>
              <span
                data-testid={`editor-tab-close-${index()}`}
                class="hover:bg-white/10 rounded-sm p-0.5 text-[10px] leading-none transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  editorStore.closeTab(props.paneId, index());
                }}
              >
                ✕
              </span>
            </button>
          );
        }}
      </For>
      <div class="flex-1 h-full min-w-4" onClick={() => editorStore.setActivePane(props.paneId)} />
      <Show when={(paneNode()?.tabs.length ?? 0) > 0}>
        <div class="flex items-center px-2 gap-1 border-l border-[var(--color-border)] h-full bg-[var(--color-bg-secondary)]">
           <button 
            class="p-1 hover:bg-white/10 rounded transition-colors text-[var(--color-text-secondary)]" 
            onClick={(e) => { e.stopPropagation(); editorStore.splitPane(props.paneId, 'vertical'); }}
            title="Split Vertically"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg>
          </button>
          <button 
            class="p-1 hover:bg-white/10 rounded transition-colors text-[var(--color-text-secondary)]" 
            onClick={(e) => { e.stopPropagation(); editorStore.closePane(props.paneId); }}
            title="Close Pane"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </Show>
    </div>
  );
}

function WelcomeView(props: { onOpenFile: (path: string) => void }) {
  return (
    <div class="h-full flex flex-col items-center justify-center text-[var(--color-text-secondary)] p-8 text-center">
      <div class="text-lg font-semibold mb-2 text-[var(--color-text-primary)]">Cortex Editor</div>
      <div class="text-sm mb-6 max-w-xs">Open a file from the sidebar or search to start editing.</div>
      <div class="grid grid-cols-2 gap-x-8 gap-y-3 text-xs">
        <div class="flex items-center justify-end gap-2">
          <span class="text-[var(--color-text-secondary)]">Quick Open</span>
          <kbd class="px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-primary)] font-mono">Cmd+P</kbd>
        </div>
        <div class="flex items-center gap-2">
          <kbd class="px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-primary)] font-mono">Cmd+S</kbd>
          <span class="text-[var(--color-text-secondary)]">Save File</span>
        </div>
        <div class="flex items-center justify-end gap-2">
          <span class="text-[var(--color-text-secondary)]">Split Vertical</span>
          <kbd class="px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-primary)] font-mono">Cmd+\</kbd>
        </div>
        <div class="flex items-center gap-2">
          <kbd class="px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-primary)] font-mono">Cmd+W</kbd>
          <span class="text-[var(--color-text-secondary)]">Close Tab</span>
        </div>
      </div>
    </div>
  );
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

export default EditorPanel;
