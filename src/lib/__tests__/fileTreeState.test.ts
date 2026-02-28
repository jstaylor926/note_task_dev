import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fileTreeState', () => {
  it('starts with null root', async () => {
    const { createFileTreeStore } = await import('../fileTreeState');
    const store = createFileTreeStore();
    expect(store.state.root).toBeNull();
    expect(store.state.rootPath).toBeNull();
  });

  it('initRoot sets root node and loads children', async () => {
    const mockEntries = [
      { name: 'src', path: '/project/src', is_dir: true, extension: null, size: 0 },
      { name: 'main.rs', path: '/project/main.rs', is_dir: false, extension: 'rs', size: 100 },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntries);

    const { createFileTreeStore } = await import('../fileTreeState');
    const store = createFileTreeStore();
    await store.initRoot('/project');

    expect(store.state.rootPath).toBe('/project');
    expect(store.state.root).not.toBeNull();
    expect(store.state.root!.name).toBe('project');
    expect(store.state.root!.isExpanded).toBe(true);
    expect(store.state.root!.isLoading).toBe(false);
    expect(store.state.root!.children).toHaveLength(2);
    expect(store.state.root!.children![0].name).toBe('src');
    expect(store.state.root!.children![0].isDir).toBe(true);
    expect(store.state.root!.children![1].name).toBe('main.rs');
  });

  it('toggleExpand loads children on first expand', async () => {
    const rootEntries = [
      { name: 'src', path: '/project/src', is_dir: true, extension: null, size: 0 },
    ];
    const srcEntries = [
      { name: 'lib.rs', path: '/project/src/lib.rs', is_dir: false, extension: 'rs', size: 50 },
    ];
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootEntries)
      .mockResolvedValueOnce(srcEntries);

    const { createFileTreeStore } = await import('../fileTreeState');
    const store = createFileTreeStore();
    await store.initRoot('/project');

    expect(store.state.root!.children![0].children).toBeNull();

    await store.toggleExpand('/project/src');

    expect(store.state.root!.children![0].isExpanded).toBe(true);
    expect(store.state.root!.children![0].children).toHaveLength(1);
    expect(store.state.root!.children![0].children![0].name).toBe('lib.rs');
  });

  it('toggleExpand collapses an expanded node', async () => {
    const rootEntries = [
      { name: 'src', path: '/project/src', is_dir: true, extension: null, size: 0 },
    ];
    const srcEntries = [
      { name: 'lib.rs', path: '/project/src/lib.rs', is_dir: false, extension: 'rs', size: 50 },
    ];
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootEntries)
      .mockResolvedValueOnce(srcEntries);

    const { createFileTreeStore } = await import('../fileTreeState');
    const store = createFileTreeStore();
    await store.initRoot('/project');
    await store.toggleExpand('/project/src');

    expect(store.state.root!.children![0].isExpanded).toBe(true);

    await store.toggleExpand('/project/src');

    expect(store.state.root!.children![0].isExpanded).toBe(false);
    // Children should still be cached
    expect(store.state.root!.children![0].children).toHaveLength(1);
  });

  it('refreshNode reloads children', async () => {
    const rootEntries = [
      { name: 'a.txt', path: '/project/a.txt', is_dir: false, extension: 'txt', size: 10 },
    ];
    const refreshedEntries = [
      { name: 'a.txt', path: '/project/a.txt', is_dir: false, extension: 'txt', size: 10 },
      { name: 'b.txt', path: '/project/b.txt', is_dir: false, extension: 'txt', size: 20 },
    ];
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootEntries)
      .mockResolvedValueOnce(refreshedEntries);

    const { createFileTreeStore } = await import('../fileTreeState');
    const store = createFileTreeStore();
    await store.initRoot('/project');

    expect(store.state.root!.children).toHaveLength(1);

    await store.refreshNode('/project');

    expect(store.state.root!.children).toHaveLength(2);
  });
});
