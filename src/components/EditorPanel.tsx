import { Show, createMemo } from 'solid-js';
import CodeMirrorEditor from './CodeMirrorEditor';
import { createEditorStore } from '../lib/editorState';
import { fileRead, fileWrite } from '../lib/files';

const editorStore = createEditorStore();

export { editorStore };

async function handleOpenFile(path: string) {
  editorStore.setLoading(true);
  try {
    const response = await fileRead(path);
    editorStore.openFile(response.path, response.content);
  } catch (e) {
    editorStore.setError(`Failed to open file: ${e}`);
  }
}

async function handleSave() {
  const file = editorStore.state.activeFile;
  if (!file) return;
  try {
    await fileWrite(file.path, file.content);
    editorStore.markSaved();
  } catch (e) {
    editorStore.setError(`Failed to save: ${e}`);
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    handleSave();
  }
}

function EditorPanel() {
  const isDirty = createMemo(() => editorStore.isDirty());
  const isLarge = createMemo(() => editorStore.isLargeFile());
  const fileName = createMemo(() => {
    const file = editorStore.state.activeFile;
    if (!file) return '';
    const parts = file.path.split('/');
    return parts[parts.length - 1];
  });

  return (
    <div
      class="h-full w-full flex flex-col bg-[var(--color-bg-primary)]"
      onKeyDown={handleKeyDown}
    >
      {/* Editor header bar */}
      <Show when={editorStore.state.activeFile}>
        <div class="h-8 flex items-center px-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
          <span class="text-xs text-[var(--color-text-primary)] font-mono truncate">
            {fileName()}
            <Show when={isDirty()}>
              <span class="text-[var(--color-accent)] ml-1" title="Unsaved changes">
                *
              </span>
            </Show>
          </span>
          <Show when={isLarge()}>
            <span class="text-xs text-[var(--color-error)] ml-2">
              Large file - read-only mode
            </span>
          </Show>
          <span class="ml-auto text-xs text-[var(--color-text-secondary)] font-mono">
            {editorStore.state.activeFile?.language ?? 'plain text'}
          </span>
        </div>
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
              when={editorStore.state.activeFile}
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
