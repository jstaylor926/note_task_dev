import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const __clearListeners = (await import('@tauri-apps/api/event') as any).__clearListeners;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __clearListeners();
});

describe('IndexingStatus', () => {
  it('renders idle state by default', async () => {
    const { default: IndexingStatus } = await import('../IndexingStatus');
    const { container } = render(() => <IndexingStatus />);
    expect(container.textContent).toContain('Indexed');
  });

  it('displays progress when indexing event is received', async () => {
    const { default: IndexingStatus } = await import('../IndexingStatus');
    const { container } = render(() => <IndexingStatus />);

    // Simulate an indexing progress event
    await (emit as ReturnType<typeof vi.fn>)('indexing:progress', {
      completed: 45,
      total: 100,
      current_file: '/project/src/main.rs',
      is_idle: false,
    });

    expect(container.textContent).toContain('45');
    expect(container.textContent).toContain('100');
  });

  it('shows file name during active indexing', async () => {
    const { default: IndexingStatus } = await import('../IndexingStatus');
    const { container } = render(() => <IndexingStatus />);

    await (emit as ReturnType<typeof vi.fn>)('indexing:progress', {
      completed: 3,
      total: 10,
      current_file: '/project/src/watcher.rs',
      is_idle: false,
    });

    expect(container.textContent).toContain('watcher.rs');
  });

  it('transitions back to idle when indexing completes', async () => {
    const { default: IndexingStatus } = await import('../IndexingStatus');
    const { container } = render(() => <IndexingStatus />);

    // Active indexing
    await (emit as ReturnType<typeof vi.fn>)('indexing:progress', {
      completed: 9,
      total: 10,
      current_file: '/project/last.ts',
      is_idle: false,
    });

    expect(container.textContent).not.toContain('Indexed');

    // Indexing complete
    await (emit as ReturnType<typeof vi.fn>)('indexing:progress', {
      completed: 10,
      total: 10,
      current_file: null,
      is_idle: true,
    });

    expect(container.textContent).toContain('Indexed');
  });

  it('cleans up event listener on unmount', async () => {
    const { default: IndexingStatus } = await import('../IndexingStatus');
    const { unmount } = render(() => <IndexingStatus />);
    // Should not throw
    unmount();
  });
});
