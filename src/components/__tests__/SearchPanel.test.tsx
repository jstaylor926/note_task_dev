import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SearchPanel', () => {
  it('renders search input', async () => {
    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const input = container.querySelector('input[type="text"]');
    expect(input).toBeTruthy();
  });

  it('shows placeholder text', async () => {
    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.placeholder).toContain('Search');
  });

  it('calls semantic_search command on form submit', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [{
        text: 'Cortex is an AI workspace',
        source_file: 'README.md',
        chunk_index: 0,
        created_at: '2026-02-27T00:00:00',
      }],
      query: 'AI workspace',
    });

    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.input(input, { target: { value: 'AI workspace' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('semantic_search', {
        query: 'AI workspace',
        limit: 10,
      });
    });
  });

  it('displays search results with source file references', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [
        {
          text: 'Cortex is an AI workspace for developers.',
          source_file: 'README.md',
          chunk_index: 0,
          created_at: '2026-02-27T00:00:00',
        },
        {
          text: 'File watcher monitors the workspace directory.',
          source_file: 'src/watcher.rs',
          chunk_index: 1,
          created_at: '2026-02-27T00:00:00',
        },
      ],
      query: 'workspace',
    });

    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.input(input, { target: { value: 'workspace' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(container.textContent).toContain('README.md');
      expect(container.textContent).toContain('src/watcher.rs');
    });
  });

  it('shows empty state when no results found', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [],
      query: 'nonexistent',
    });

    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.input(input, { target: { value: 'nonexistent' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(container.textContent).toContain('No results');
    });
  });

  it('shows error state when search fails', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Sidecar unreachable'),
    );

    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.input(input, { target: { value: 'test' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(container.textContent?.toLowerCase()).toContain('error');
    });
  });
});
