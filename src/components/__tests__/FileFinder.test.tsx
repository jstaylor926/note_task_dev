import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FileFinder', () => {
  function setupMocks() {
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('/project') // getWorkspaceRoot
      .mockResolvedValueOnce([
        { path: '/project/src/main.rs', relative_path: 'src/main.rs', is_dir: false, extension: 'rs' },
        { path: '/project/src/lib.ts', relative_path: 'src/lib.ts', is_dir: false, extension: 'ts' },
        { path: '/project/package.json', relative_path: 'package.json', is_dir: false, extension: 'json' },
      ]);
  }

  it('renders overlay and input', async () => {
    setupMocks();
    const { default: FileFinder } = await import('../FileFinder');
    render(() => <FileFinder onSelect={() => {}} onClose={() => {}} />);

    expect(screen.getByTestId('file-finder-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('file-finder-input')).toBeInTheDocument();
  });

  it('shows file results after loading', async () => {
    setupMocks();
    const { default: FileFinder } = await import('../FileFinder');
    render(() => <FileFinder onSelect={() => {}} onClose={() => {}} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('file-finder-result-0')).toBeInTheDocument();
    });

    expect(screen.getByTestId('file-finder-result-0').textContent).toContain('src/main.rs');
  });

  it('filters results when typing', async () => {
    setupMocks();
    const { default: FileFinder } = await import('../FileFinder');
    render(() => <FileFinder onSelect={() => {}} onClose={() => {}} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('file-finder-result-0')).toBeInTheDocument();
    });

    const input = screen.getByTestId('file-finder-input');
    fireEvent.input(input, { target: { value: 'package' } });

    await vi.waitFor(() => {
      // Only package.json should match
      expect(screen.getByTestId('file-finder-result-0').textContent).toContain('package.json');
      expect(screen.queryByTestId('file-finder-result-1')).toBeNull();
    });
  });

  it('calls onSelect on Enter', async () => {
    setupMocks();
    const onSelect = vi.fn();
    const { default: FileFinder } = await import('../FileFinder');
    render(() => <FileFinder onSelect={onSelect} onClose={() => {}} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('file-finder-result-0')).toBeInTheDocument();
    });

    const input = screen.getByTestId('file-finder-input');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('/project/src/main.rs');
  });

  it('calls onClose on Escape', async () => {
    setupMocks();
    const onClose = vi.fn();
    const { default: FileFinder } = await import('../FileFinder');
    render(() => <FileFinder onSelect={() => {}} onClose={onClose} />);

    const input = screen.getByTestId('file-finder-input');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('navigates with arrow keys', async () => {
    setupMocks();
    const onSelect = vi.fn();
    const { default: FileFinder } = await import('../FileFinder');
    render(() => <FileFinder onSelect={onSelect} onClose={() => {}} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('file-finder-result-0')).toBeInTheDocument();
    });

    const input = screen.getByTestId('file-finder-input');

    // Move down to second result
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('/project/src/lib.ts');
  });
});
