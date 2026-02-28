import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FileTree', () => {
  it('renders Explorer header', async () => {
    // Mock getWorkspaceRoot + fileListDirectory
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('/project') // getWorkspaceRoot
      .mockResolvedValueOnce([]); // fileListDirectory

    const { default: FileTree } = await import('../FileTree');
    render(() => <FileTree onFileSelect={() => {}} />);

    expect(screen.getByText('Explorer')).toBeInTheDocument();
  });

  it('renders root children after init', async () => {
    const rootEntries = [
      { name: 'src', path: '/project/src', is_dir: true, extension: null, size: 0 },
      { name: 'main.rs', path: '/project/main.rs', is_dir: false, extension: 'rs', size: 100 },
    ];
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('/project')
      .mockResolvedValueOnce(rootEntries);

    const { default: FileTree } = await import('../FileTree');
    render(() => <FileTree onFileSelect={() => {}} />);

    // Wait for async init
    await vi.waitFor(() => {
      expect(screen.getByTestId('tree-node-src')).toBeInTheDocument();
      expect(screen.getByTestId('tree-node-main.rs')).toBeInTheDocument();
    });
  });

  it('calls onFileSelect when clicking a file', async () => {
    const rootEntries = [
      { name: 'main.rs', path: '/project/main.rs', is_dir: false, extension: 'rs', size: 100 },
    ];
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('/project')
      .mockResolvedValueOnce(rootEntries);

    const onFileSelect = vi.fn();
    const { default: FileTree } = await import('../FileTree');
    render(() => <FileTree onFileSelect={onFileSelect} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('tree-node-main.rs')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('tree-node-main.rs'));
    expect(onFileSelect).toHaveBeenCalledWith('/project/main.rs');
  });

  it('expands directory on click', async () => {
    const rootEntries = [
      { name: 'src', path: '/project/src', is_dir: true, extension: null, size: 0 },
    ];
    const srcEntries = [
      { name: 'lib.rs', path: '/project/src/lib.rs', is_dir: false, extension: 'rs', size: 50 },
    ];
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('/project')
      .mockResolvedValueOnce(rootEntries)
      .mockResolvedValueOnce(srcEntries);

    const { default: FileTree } = await import('../FileTree');
    render(() => <FileTree onFileSelect={() => {}} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('tree-node-src')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('tree-node-src'));

    await vi.waitFor(() => {
      expect(screen.getByTestId('tree-node-lib.rs')).toBeInTheDocument();
    });
  });
});
