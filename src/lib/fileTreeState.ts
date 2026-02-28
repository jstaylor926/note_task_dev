import { createStore, produce } from 'solid-js/store';
import { fileListDirectory, type DirEntry } from './files';

export interface TreeNode {
  path: string;
  name: string;
  isDir: boolean;
  extension: string | null;
  children: TreeNode[] | null;
  isExpanded: boolean;
  isLoading: boolean;
}

interface FileTreeState {
  root: TreeNode | null;
  rootPath: string | null;
}

function dirEntryToNode(entry: DirEntry): TreeNode {
  return {
    path: entry.path,
    name: entry.name,
    isDir: entry.is_dir,
    extension: entry.extension,
    children: entry.is_dir ? null : null,
    isExpanded: false,
    isLoading: false,
  };
}

export function createFileTreeStore() {
  const [state, setState] = createStore<FileTreeState>({
    root: null,
    rootPath: null,
  });

  async function initRoot(rootPath: string) {
    const rootName = rootPath.split('/').pop() || rootPath;
    setState(
      produce((s) => {
        s.rootPath = rootPath;
        s.root = {
          path: rootPath,
          name: rootName,
          isDir: true,
          extension: null,
          children: null,
          isExpanded: true,
          isLoading: true,
        };
      }),
    );

    try {
      const entries = await fileListDirectory(rootPath);
      const children = entries.map(dirEntryToNode);
      setState(
        produce((s) => {
          if (s.root) {
            s.root.children = children;
            s.root.isLoading = false;
          }
        }),
      );
    } catch {
      setState(
        produce((s) => {
          if (s.root) {
            s.root.children = [];
            s.root.isLoading = false;
          }
        }),
      );
    }
  }

  async function toggleExpand(path: string) {
    const node = findNode(state.root, path);
    if (!node || !node.isDir) return;

    if (node.isExpanded) {
      setNodeProp(path, 'isExpanded', false);
      return;
    }

    if (node.children === null) {
      setNodeProp(path, 'isLoading', true);
      try {
        const entries = await fileListDirectory(path);
        const children = entries.map(dirEntryToNode);
        setState(
          produce((s) => {
            const n = findNodeMut(s.root, path);
            if (n) {
              n.children = children;
              n.isLoading = false;
              n.isExpanded = true;
            }
          }),
        );
      } catch {
        setState(
          produce((s) => {
            const n = findNodeMut(s.root, path);
            if (n) {
              n.children = [];
              n.isLoading = false;
              n.isExpanded = true;
            }
          }),
        );
      }
    } else {
      setNodeProp(path, 'isExpanded', true);
    }
  }

  async function refreshNode(path: string) {
    try {
      const entries = await fileListDirectory(path);
      const children = entries.map(dirEntryToNode);
      setState(
        produce((s) => {
          const n = findNodeMut(s.root, path);
          if (n) {
            n.children = children;
          }
        }),
      );
    } catch {
      // Ignore refresh failures
    }
  }

  function setNodeProp(path: string, prop: keyof TreeNode, value: boolean) {
    setState(
      produce((s) => {
        const n = findNodeMut(s.root, path);
        if (n) {
          (n as Record<string, unknown>)[prop] = value;
        }
      }),
    );
  }

  return {
    state,
    initRoot,
    toggleExpand,
    refreshNode,
  };
}

function findNode(node: TreeNode | null, path: string): TreeNode | null {
  if (!node) return null;
  if (node.path === path) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, path);
      if (found) return found;
    }
  }
  return null;
}

function findNodeMut(node: TreeNode | null, path: string): TreeNode | null {
  if (!node) return null;
  if (node.path === path) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeMut(child, path);
      if (found) return found;
    }
  }
  return null;
}
