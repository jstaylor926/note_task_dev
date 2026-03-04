import { onMount, onCleanup, For, Show, createMemo, createSignal } from 'solid-js';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createFileTreeStore, type TreeNode } from '../lib/fileTreeState';
import { getWorkspaceRoot, fileStat } from '../lib/files';
import { editorStore } from './EditorPanel';

const fileTreeStore = createFileTreeStore();

export { fileTreeStore };

function FileTreeNode(props: {
  node: TreeNode;
  depth: number;
  onFileSelect: (path: string) => void;
}) {
  const paddingLeft = () => `${props.depth * 12 + 8}px`;
  const isActive = createMemo(() => editorStore.getActiveFile()?.path === props.node.path);

  function handleClick() {
    if (props.node.isDir) {
      fileTreeStore.toggleExpand(props.node.path);
    } else {
      props.onFileSelect(props.node.path);
    }
  }

  return (
    <>
      <button
        class={`w-full text-left flex items-center h-6 px-1 text-xs transition-colors ${
          isActive() 
            ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] font-medium border-r-2 border-[var(--color-accent)]' 
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-panel)] hover:text-[var(--color-text-primary)]'
        }`}
        style={{ "padding-left": paddingLeft() }}
        onClick={handleClick}
        data-testid={`tree-node-${props.node.name}`}
      >
        <span class="w-4 flex items-center justify-center shrink-0 mr-1">
          <Show when={props.node.isDir} fallback={
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
          }>
            <Show when={props.node.isLoading} fallback={
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={props.node.isExpanded ? 'rotate-0' : '-rotate-90'}>
                <path d="m6 9 6 6 6-6"/>
              </svg>
            }>
              <div class="w-2 h-2 border border-current border-t-transparent rounded-full animate-spin" />
            </Show>
          </Show>
        </span>
        
        <Show when={props.node.isDir}>
          <span class="mr-1.5 text-amber-500/80">
            <Show when={props.node.isExpanded} fallback={
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 18H4V8h16v10zm-2-12H4V4h5.17l2 2H18v2z"/>
              </svg>
            }>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 18H4V8h16v10zm-2-12l-2-2H4v2h12z"/>
              </svg>
            </Show>
          </span>
        </Show>

        <span class="truncate">{props.node.name}</span>
      </button>
      <Show when={props.node.isDir && props.node.isExpanded && props.node.children}>
        <div class="overflow-hidden">
          <For each={props.node.children!}>
            {(child) => (
              <FileTreeNode
                node={child}
                depth={props.depth + 1}
                onFileSelect={props.onFileSelect}
              />
            )}
          </For>
        </div>
      </Show>
    </>
  );
}

function FileTree(props: { onFileSelect: (path: string) => void }) {
  let unlistenComplete: UnlistenFn | undefined;
  let unlistenDeleted: UnlistenFn | undefined;
  const [showPathInput, setShowPathInput] = createSignal(false);
  const [pathInput, setPathInput] = createSignal('');
  const [pathError, setPathError] = createSignal<string | null>(null);

  async function handleOpenFolder(e: Event) {
    e.preventDefault();
    const path = pathInput().trim();
    if (!path) return;
    setPathError(null);
    try {
      const stat = await fileStat(path);
      if (!stat.is_dir) {
        setPathError('Not a directory');
        return;
      }
      await fileTreeStore.initRoot(path);
      setShowPathInput(false);
      setPathInput('');
    } catch {
      setPathError('Path not found');
    }
  }

  onMount(async () => {
    try {
      const root = await getWorkspaceRoot();
      await fileTreeStore.initRoot(root);
    } catch {
      // Failed to get workspace root — may be in browser-only mode
    }

    unlistenComplete = await listen<{ file_path: string }>(
      'indexing:file-complete',
      (event) => {
        const filePath = event.payload.file_path;
        const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (parentDir && fileTreeStore.state.root) {
          fileTreeStore.refreshNode(parentDir);
        }
      },
    );

    unlistenDeleted = await listen<{ file_path: string }>(
      'indexing:file-deleted',
      (event) => {
        const filePath = event.payload.file_path;
        const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (parentDir && fileTreeStore.state.root) {
          fileTreeStore.refreshNode(parentDir);
        }
      },
    );
  });

  onCleanup(() => {
    unlistenComplete?.();
    unlistenDeleted?.();
  });

  return (
    <div class="h-full bg-[var(--color-bg-secondary)] flex flex-col">
      <div class="h-8 flex items-center px-3 border-b border-[var(--color-border)] shrink-0">
        <span class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
          Explorer
        </span>
        <button
          class="ml-auto text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          onClick={() => { setShowPathInput(!showPathInput()); setPathError(null); }}
          title="Open Folder"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h4a2 2 0 0 1 2 2v1"/>
            <path d="M14 15l2 2 4-4"/>
          </svg>
        </button>
      </div>
      <Show when={showPathInput()}>
        <form onSubmit={handleOpenFolder} class="px-2 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-panel)]">
          <input
            type="text"
            autofocus
            value={pathInput()}
            onInput={(e) => { setPathInput(e.currentTarget.value); setPathError(null); }}
            placeholder="Enter folder path..."
            class="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <Show when={pathError()}>
            <div class="text-[10px] text-[var(--color-error)] mt-1">{pathError()}</div>
          </Show>
        </form>
      </Show>
      <div class="flex-1 overflow-auto py-1">
        <Show
          when={fileTreeStore.state.root}
          fallback={
            <div class="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
              Loading...
            </div>
          }
        >
          {(root) => (
            <Show when={root().children}>
              <For each={root().children!}>
                {(child) => (
                  <FileTreeNode
                    node={child}
                    depth={0}
                    onFileSelect={props.onFileSelect}
                  />
                )}
              </For>
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
}

export default FileTree;
