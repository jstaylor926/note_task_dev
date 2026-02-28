import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockResult = (overrides = {}) => ({
  text: 'fn main() { println!("Hello"); }',
  source_file: 'src/main.rs',
  chunk_index: 0,
  chunk_type: 'function',
  entity_name: 'main',
  language: 'rust',
  source_type: 'code',
  relevance_score: 0.85,
  created_at: '2026-02-27T00:00:00',
  ...overrides,
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

  it('renders Cmd+K shortcut hint', async () => {
    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const kbd = container.querySelector('kbd');
    expect(kbd).toBeTruthy();
    expect(kbd!.textContent).toContain('K');
  });

  it('focuses input on Cmd+K', async () => {
    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const input = container.querySelector('input') as HTMLInputElement;

    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    expect(document.activeElement).toBe(input);
  });

  it('renders language filter dropdown', async () => {
    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const select = container.querySelector('select');
    expect(select).toBeTruthy();
    expect(select!.textContent).toContain('All Languages');
    expect(select!.textContent).toContain('Rust');
    expect(select!.textContent).toContain('Python');
  });

  it('renders source type filter pills', async () => {
    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const buttons = container.querySelectorAll('button[type="button"]');
    const labels = Array.from(buttons).map(b => b.textContent);
    expect(labels).toContain('Code');
    expect(labels).toContain('Docs');
    expect(labels).toContain('Test');
  });

  it('calls semantic_search command on form submit', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [mockResult()],
      query: 'main function',
    });

    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.input(input, { target: { value: 'main function' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('semantic_search', {
        query: 'main function',
        limit: 10,
      });
    });
  });

  it('passes language filter to semantic_search', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [mockResult()],
      query: 'main function',
    });

    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;
    const select = container.querySelector('select') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'rust' } });
    fireEvent.input(input, { target: { value: 'main function' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('semantic_search', {
        query: 'main function',
        limit: 10,
        language: 'rust',
      });
    });
  });

  it('displays search results with rich metadata', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [
        mockResult(),
        mockResult({
          text: 'def helper(): return 42',
          source_file: 'lib/utils.py',
          entity_name: 'helper',
          language: 'python',
          chunk_type: 'function',
          relevance_score: 0.72,
        }),
      ],
      query: 'function',
    });

    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    fireEvent.input(input, { target: { value: 'function' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(container.textContent).toContain('src/main.rs');
      expect(container.textContent).toContain('main');
      expect(container.textContent).toContain('rust');
      expect(container.textContent).toContain('85%');
      expect(container.textContent).toContain('lib/utils.py');
      expect(container.textContent).toContain('helper');
      expect(container.textContent).toContain('python');
      expect(container.textContent).toContain('72%');
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

  it('renders scope toggle buttons', async () => {
    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);
    const codeBtn = container.querySelector('[data-scope="code"]');
    const entitiesBtn = container.querySelector('[data-scope="entities"]');
    expect(codeBtn).toBeTruthy();
    expect(codeBtn!.textContent).toBe('Code');
    expect(entitiesBtn).toBeTruthy();
    expect(entitiesBtn!.textContent).toBe('Notes & Tasks');
  });

  it('switches to entity search when Notes & Tasks scope is selected', async () => {
    const entityResults = [
      { id: 'n1', entity_type: 'note', title: 'My Note', content: 'note body', source_file: null, updated_at: '' },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(entityResults);

    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);

    // Switch to entities scope
    const entitiesBtn = container.querySelector('[data-scope="entities"]') as HTMLButtonElement;
    fireEvent.click(entitiesBtn);

    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.input(input, { target: { value: 'My Note' } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('entity_search', {
        query: 'My Note',
        entityType: null,
        limit: 20,
      });
      expect(container.textContent).toContain('My Note');
      expect(container.textContent).toContain('note');
    });
  });

  it('hides language filter when in entities scope', async () => {
    const { default: SearchPanel } = await import('../SearchPanel');
    const { container } = render(() => <SearchPanel />);

    // Initially in code scope, select should be visible
    expect(container.querySelector('select')).toBeTruthy();

    // Switch to entities scope
    const entitiesBtn = container.querySelector('[data-scope="entities"]') as HTMLButtonElement;
    fireEvent.click(entitiesBtn);

    // Select should be hidden
    expect(container.querySelector('select')).toBeFalsy();
  });
});
