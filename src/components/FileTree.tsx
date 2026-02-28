import { onMount, onCleanup, For, Show } from 'solid-js';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createFileTreeStore, type TreeNode } from '../lib/fileTreeState';
import { getWorkspaceRoot } from '../lib/files';

const fileTreeStore = createFileTreeStore();

export { fileTreeStore };

function FileTreeNode(props: {
  node: TreeNode;
  depth: number;
  onFileSelect: (path: string) => void;
}) {
  const paddingLeft = () => `${props.depth * 16}px`;

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
        class="w-full text-left flex items-center h-6 px-1 text-xs hover:bg-[var(--color-bg-panel)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        style={{ "padding-left": paddingLeft() }}
        onClick={handleClick}
        data-testid={`tree-node-${props.node.name}`}
      >
        <Show when={props.node.isDir}>
          <span class="w-4 text-center shrink-0">
            {props.node.isLoading ? '...' : props.node.isExpanded ? '\u25BE' : '\u25B8'}
          </span>
        </Show>
        <Show when={!props.node.isDir}>
          <span class="w-4 shrink-0" />
        </Show>
        <span class="truncate">{props.node.name}</span>
      </button>
      <Show when={props.node.isDir && props.node.isExpanded && props.node.children}>
        <For each={props.node.children!}>
          {(child) => (
            <FileTreeNode
              node={child}
              depth={props.depth + 1}
              onFileSelect={props.onFileSelect}
            />
          )}
        </For>
      </Show>
    </>
  );
}

function FileTree(props: { onFileSelect: (path: string) => void }) {
  let unlistenComplete: UnlistenFn | undefined;
  let unlistenDeleted: UnlistenFn | undefined;

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
      </div>
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
