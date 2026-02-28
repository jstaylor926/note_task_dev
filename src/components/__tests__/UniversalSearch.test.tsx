import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockResponse(results = [mockResult()]) {
  return {
    results,
    query: 'test',
    code_count: results.filter((r) => r.result_type === 'code').length,
    entity_count: results.filter((r) => r.result_type !== 'code').length,
  };
}

function mockResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    result_type: 'code',
    title: 'main',
    snippet: 'fn main() { println!("Hello"); }',
    source_file: 'src/main.rs',
    relevance_score: 0.85,
    metadata: null,
    ...overrides,
  };
}

describe('UniversalSearch', () => {
  it('renders overlay and input', async () => {
    const { default: UniversalSearch } = await import('../UniversalSearch');
    const { container } = render(() => (
      <UniversalSearch onSelect={() => {}} onClose={() => {}} />
    ));
    expect(container.querySelector('[data-testid="universal-search-overlay"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="universal-search-input"]')).toBeTruthy();
  });

  it('calls universal_search on input with debounce', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse());

    const { default: UniversalSearch } = await import('../UniversalSearch');
    const { container } = render(() => (
      <UniversalSearch onSelect={() => {}} onClose={() => {}} />
    ));
    const input = container.querySelector('[data-testid="universal-search-input"]') as HTMLInputElement;

    fireEvent.input(input, { target: { value: 'test query' } });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('universal_search', {
        query: 'test query',
        limit: 20,
      });
    });
  });

  it('displays mixed results with type badges', async () => {
    const results = [
      mockResult({ id: 'r1', result_type: 'code', title: 'main', source_file: 'src/main.rs', relevance_score: 0.90 }),
      mockResult({ id: 'n1', result_type: 'note', title: 'My Note', snippet: 'note body', source_file: null, relevance_score: 0.80 }),
      mockResult({ id: 't1', result_type: 'task', title: 'Fix bug', snippet: null, source_file: null, relevance_score: 0.75 }),
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(results));

    const { default: UniversalSearch } = await import('../UniversalSearch');
    const { container } = render(() => (
      <UniversalSearch onSelect={() => {}} onClose={() => {}} />
    ));
    const input = container.querySelector('[data-testid="universal-search-input"]') as HTMLInputElement;

    fireEvent.input(input, { target: { value: 'test' } });

    await waitFor(() => {
      expect(container.textContent).toContain('code');
      expect(container.textContent).toContain('note');
      expect(container.textContent).toContain('task');
      expect(container.textContent).toContain('main');
      expect(container.textContent).toContain('My Note');
      expect(container.textContent).toContain('Fix bug');
    });
  });

  it('keyboard navigation with ArrowDown/ArrowUp', async () => {
    const results = [
      mockResult({ id: 'r1', title: 'First' }),
      mockResult({ id: 'r2', title: 'Second' }),
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(results));

    const { default: UniversalSearch } = await import('../UniversalSearch');
    const { container } = render(() => (
      <UniversalSearch onSelect={() => {}} onClose={() => {}} />
    ));
    const input = container.querySelector('[data-testid="universal-search-input"]') as HTMLInputElement;

    fireEvent.input(input, { target: { value: 'test' } });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="universal-result-0"]')).toBeTruthy();
    });

    // First item is selected by default
    const first = container.querySelector('[data-testid="universal-result-0"]') as HTMLElement;
    expect(first.className).toContain('bg-[var(--color-accent)]');

    // Arrow down selects second
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const second = container.querySelector('[data-testid="universal-result-1"]') as HTMLElement;
    expect(second.className).toContain('bg-[var(--color-accent)]');

    // Arrow up goes back to first
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(first.className).toContain('bg-[var(--color-accent)]');
  });

  it('calls onSelect with correct result on Enter', async () => {
    const results = [mockResult({ id: 'r1', title: 'Selected Item' })];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse(results));

    const onSelect = vi.fn();
    const { default: UniversalSearch } = await import('../UniversalSearch');
    const { container } = render(() => (
      <UniversalSearch onSelect={onSelect} onClose={() => {}} />
    ));
    const input = container.querySelector('[data-testid="universal-search-input"]') as HTMLInputElement;

    fireEvent.input(input, { target: { value: 'test' } });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="universal-result-0"]')).toBeTruthy();
    });

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', title: 'Selected Item' }));
  });

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn();
    const { default: UniversalSearch } = await import('../UniversalSearch');
    const { container } = render(() => (
      <UniversalSearch onSelect={() => {}} onClose={onClose} />
    ));
    const input = container.querySelector('[data-testid="universal-search-input"]') as HTMLInputElement;

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state initially', async () => {
    const { default: UniversalSearch } = await import('../UniversalSearch');
    const { container } = render(() => (
      <UniversalSearch onSelect={() => {}} onClose={() => {}} />
    ));
    expect(container.textContent).toContain('Type to search');
  });

  it('shows no results for empty response', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse([]));

    const { default: UniversalSearch } = await import('../UniversalSearch');
    const { container } = render(() => (
      <UniversalSearch onSelect={() => {}} onClose={() => {}} />
    ));
    const input = container.querySelector('[data-testid="universal-search-input"]') as HTMLInputElement;

    fireEvent.input(input, { target: { value: 'nonexistent' } });

    await waitFor(() => {
      expect(container.textContent).toContain('No results found');
    });
  });

  it('backdrop click closes overlay', async () => {
    const onClose = vi.fn();
    const { default: UniversalSearch } = await import('../UniversalSearch');
    const { container } = render(() => (
      <UniversalSearch onSelect={() => {}} onClose={onClose} />
    ));
    const overlay = container.querySelector('[data-testid="universal-search-overlay"]') as HTMLElement;

    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });
});
