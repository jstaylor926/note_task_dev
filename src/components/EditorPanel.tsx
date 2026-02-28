import { Show, For, createMemo, createSignal, createEffect, on } from 'solid-js';
import CodeMirrorEditor from './CodeMirrorEditor';
import { createEditorStore } from '../lib/editorState';
import { fileRead, fileWrite } from '../lib/files';
import { getRunCommand } from '../lib/runFile';
import { getActiveSessionId } from '../lib/terminalState';
import { terminalStore } from '../lib/terminalStoreInstance';
import { ptyWrite } from '../lib/pty';
import { getLinksForFile } from '../lib/editorLinks';
import type { LinkWithEntity } from '../lib/entityLinks';

const editorStore = createEditorStore();

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
    editorStore.closeFile();
  } else if (meta && e.key === 'Enter') {
    e.preventDefault();
    handleRunInTerminal();
  }
}

const TYPE_COLORS: Record<string, string> = {
  note: '#6366f1',
  task: '#f59e0b',
  function: '#10b981',
  class: '#3b82f6',
  struct: '#8b5cf6',
  file: '#64748b',
};

function EditorPanel() {
  const activeFile = createMemo(() => editorStore.getActiveFile());
  const isLarge = createMemo(() => editorStore.isLargeFile());
  const [relatedLinks, setRelatedLinks] = createSignal<LinkWithEntity[]>([]);
  const [showRelated, setShowRelated] = createSignal(false);

  // Load related links when the active file changes
  createEffect(
    on(
      () => activeFile()?.path,
      (path) => {
        setRelatedLinks([]);
        setShowRelated(false);
        if (path) {
          getLinksForFile(path).then(setRelatedLinks).catch(() => {});
        }
      },
    ),
  );

  function handleRelatedClick(link: LinkWithEntity) {
    setShowRelated(false);
    if (link.linked_entity_type === 'note') {
      // Navigate to note via noteStore
      import('../lib/noteStoreInstance').then(({ noteStore }) => {
        noteStore.selectNote(link.linked_entity_id);
      });
    } else if (link.linked_source_file) {
      handleOpenFile(link.linked_source_file);
    }
  }

  return (
    <div
      class="h-full w-full flex flex-col bg-[var(--color-bg-primary)]"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Tab bar */}
      <Show when={editorStore.state.tabs.length > 0}>
        <div class="flex items-center h-8 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div class="flex-1 flex items-center overflow-x-auto">
            <For each={editorStore.state.tabs}>
              {(tab, index) => {
                const dirty = createMemo(() => editorStore.isDirty(index()));
                const fileName = createMemo(() => {
                  const parts = tab.file.path.split('/');
                  return parts[parts.length - 1];
                });

                return (
                  <button
                    class={`px-3 h-full text-xs flex items-center gap-1 border-r border-[var(--color-border)] ${
                      index() === editorStore.state.activeTabIndex
                        ? 'bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]/50'
                    }`}
                    onClick={() => editorStore.setActiveTab(index())}
                    data-testid={`editor-tab-${index()}`}
                  >
                    <span class="font-mono truncate">
                      {fileName()}
                      <Show when={dirty()}>
                        <span class="text-[var(--color-accent)] ml-0.5">*</span>
                      </Show>
                    </span>
                    <span
                      class="ml-1 hover:text-[var(--color-text-primary)] text-[10px] leading-none"
                      onClick={(e) => {
                        e.stopPropagation();
                        editorStore.closeTab(tab.id);
                      }}
                      data-testid={`editor-tab-close-${index()}`}
                    >
                      x
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* Editor header bar showing language + related links */}
      <Show when={activeFile()}>
        {(file) => (
          <div class="h-6 flex items-center px-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0 relative">
            <Show when={isLarge()}>
              <span class="text-xs text-[var(--color-error)] mr-2">
                Large file - read-only mode
              </span>
            </Show>
            <Show when={relatedLinks().length > 0}>
              <button
                onClick={() => setShowRelated(!showRelated())}
                class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 transition-colors"
                data-testid="related-links-badge"
              >
                {relatedLinks().length} {relatedLinks().length === 1 ? 'link' : 'links'}
              </button>
              <Show when={showRelated()}>
                <div class="absolute top-6 left-2 z-50 w-64 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-lg" data-testid="related-links-dropdown">
                  <div class="px-2 py-1.5 border-b border-[var(--color-border)] text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Related
                  </div>
                  <div class="max-h-48 overflow-y-auto">
                    <For each={relatedLinks()}>
                      {(link) => (
                        <button
                          onClick={() => handleRelatedClick(link)}
                          class="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-[var(--color-bg-panel)] transition-colors"
                          data-testid="related-link-item"
                        >
                          <span
                            class="inline-block px-1 py-0.5 rounded text-[8px] font-medium text-white flex-shrink-0"
                            style={{ 'background-color': TYPE_COLORS[link.linked_entity_type] ?? '#64748b' }}
                          >
                            {link.linked_entity_type}
                          </span>
                          <span class="text-[11px] text-[var(--color-text-primary)] truncate">
                            {link.linked_entity_title}
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </Show>
            <span class="ml-auto text-xs text-[var(--color-text-secondary)] font-mono">
              {file().language ?? 'plain text'}
            </span>
          </div>
        )}
      </Show>

      {/* Main editor area */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <Show
          when={!editorStore.state.isLoading}
          fallback={
            <div class="h-full flex items-center justify-center">
              <span class="text-sm text-[var(--color-text-secondary)]">
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
            <Show
              when={activeFile()}
              fallback={<WelcomeView onOpenFile={handleOpenFile} />}
            >
              {(file) => (
                <CodeMirrorEditor
                  content={file().content}
                  language={file().language}
                  readonly={isLarge()}
                  onContentChange={(content) =>
                    editorStore.updateContent(content)
                  }
                />
              )}
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}

function WelcomeView(props: { onOpenFile: (path: string) => void }) {
  return (
    <div class="h-full flex flex-col items-center justify-center text-[var(--color-text-secondary)]">
      <div class="text-lg font-semibold mb-2">Cortex Editor</div>
      <div class="text-sm mb-4">Open a file to start editing</div>
      <div class="text-xs space-y-1">
        <div>
          <kbd class="px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-primary)] font-mono">
            Cmd+P
          </kbd>
          <span class="ml-2">Quick open file</span>
        </div>
        <div>
          <kbd class="px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-primary)] font-mono">
            Cmd+S
          </kbd>
          <span class="ml-2">Save file</span>
        </div>
      </div>
    </div>
  );
}

export default EditorPanel;
