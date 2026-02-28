import { Show, For, createMemo } from 'solid-js';
import CodeMirrorEditor from './CodeMirrorEditor';
import { createEditorStore } from '../lib/editorState';
import { fileRead, fileWrite } from '../lib/files';
import { getRunCommand } from '../lib/runFile';
import { getActiveSessionId } from '../lib/terminalState';
import { terminalStore } from '../lib/terminalStoreInstance';
import { ptyWrite } from '../lib/pty';

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

function EditorPanel() {
  const activeFile = createMemo(() => editorStore.getActiveFile());
  const isLarge = createMemo(() => editorStore.isLargeFile());

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

      {/* Editor header bar showing language */}
      <Show when={activeFile()}>
        {(file) => (
          <div class="h-6 flex items-center px-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
            <Show when={isLarge()}>
              <span class="text-xs text-[var(--color-error)] mr-2">
                Large file - read-only mode
              </span>
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
