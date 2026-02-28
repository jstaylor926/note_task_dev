import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor, cleanup } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('NotesPanel', () => {
  it('renders empty state when no notes', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { default: NotesPanel } = await import('../NotesPanel');
    const { container } = render(() => <NotesPanel />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('No notes yet');
      expect(container.textContent).toContain('Create one to get started');
    });
  });

  it('renders notes list after loading', async () => {
    const notes = [
      { id: 'n1', title: 'First Note', content: 'Body 1', metadata: null, created_at: '', updated_at: '' },
      { id: 'n2', title: 'Second Note', content: 'Body 2', metadata: null, created_at: '', updated_at: '' },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(notes);
    const { default: NotesPanel } = await import('../NotesPanel');
    const { container } = render(() => <NotesPanel />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('First Note');
      expect(container.textContent).toContain('Second Note');
    });
  });

  it('has a New button in the header', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { default: NotesPanel } = await import('../NotesPanel');
    const { container } = render(() => <NotesPanel />);
    const newBtn = container.querySelector('button');
    expect(newBtn?.textContent).toContain('New');
  });

  it('clicking New calls note_create', async () => {
    const createdNote = { id: 'n3', title: 'Untitled', content: '', metadata: null, created_at: '', updated_at: '' };
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])  // note_list
      .mockResolvedValueOnce(createdNote); // note_create

    const { default: NotesPanel } = await import('../NotesPanel');
    const { container } = render(() => <NotesPanel />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('No notes yet');
    });

    const newBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('New'));
    if (newBtn) fireEvent.click(newBtn);

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('note_create', { title: 'Untitled', content: '' });
    });
  });

  it('renders links section when active note has links', async () => {
    const notes = [
      { id: 'n1', title: 'My Note', content: 'content', metadata: null, created_at: '', updated_at: '' },
    ];
    const links = [
      {
        link_id: 'l1',
        linked_entity_id: 'e2',
        linked_entity_title: 'SearchPanel',
        linked_entity_type: 'function',
        linked_source_file: 'src/SearchPanel.tsx',
        relationship_type: 'references',
        confidence: 0.95,
        auto_generated: true,
        direction: 'outgoing',
      },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'note_list') return Promise.resolve(notes);
      if (cmd === 'entity_links_with_details') return Promise.resolve(links);
      return Promise.resolve([]);
    });

    const { default: NotesPanel } = await import('../NotesPanel');
    const { container } = render(() => <NotesPanel />);

    // Wait for notes to load
    await vi.waitFor(() => {
      expect(container.textContent).toContain('My Note');
    });

    // Click the note to select it
    const noteBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('My Note'));
    if (noteBtn) fireEvent.click(noteBtn);

    // Wait for links section to appear
    await vi.waitFor(() => {
      expect(screen.getByTestId('links-section')).toBeInTheDocument();
    });

    expect(container.textContent).toContain('SearchPanel');
    expect(container.textContent).toContain('95%');
    expect(screen.getByTestId('auto-badge')).toBeInTheDocument();
  });

  it('does not show links section when no links', async () => {
    const notes = [
      { id: 'n1', title: 'Plain Note', content: 'content', metadata: null, created_at: '', updated_at: '' },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'note_list') return Promise.resolve(notes);
      if (cmd === 'entity_links_with_details') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const { default: NotesPanel } = await import('../NotesPanel');
    const { container } = render(() => <NotesPanel />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Plain Note');
    });

    const noteBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Plain Note'));
    if (noteBtn) fireEvent.click(noteBtn);

    // Give time for potential links section to render
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByTestId('links-section')).not.toBeInTheDocument();
  });

  // ─── Link Suggestion tests ────────────────────────────────────────

  it('suggested links show confirm/dismiss buttons (confidence 0.75)', async () => {
    const notes = [
      { id: 'n1', title: 'My Note', content: 'content', metadata: null, created_at: '', updated_at: '' },
    ];
    const links = [
      {
        link_id: 'l1',
        linked_entity_id: 'e2',
        linked_entity_title: 'SuggestedLink',
        linked_entity_type: 'function',
        linked_source_file: 'src/lib.rs',
        relationship_type: 'references',
        confidence: 0.75,
        auto_generated: true,
        direction: 'outgoing',
      },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'note_list') return Promise.resolve(notes);
      if (cmd === 'entity_links_with_details') return Promise.resolve(links);
      return Promise.resolve([]);
    });

    const { default: NotesPanel } = await import('../NotesPanel');
    const { container } = render(() => <NotesPanel />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('My Note');
    });

    const noteBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('My Note'));
    if (noteBtn) fireEvent.click(noteBtn);

    await vi.waitFor(() => {
      expect(screen.getByTestId('confirm-link-l1')).toBeInTheDocument();
      expect(screen.getByTestId('dismiss-link-l1')).toBeInTheDocument();
    });
  });

  it('confirm button calls entity_link_confirm', async () => {
    const notes = [
      { id: 'n1', title: 'Confirm Target', content: 'content', metadata: null, created_at: '', updated_at: '' },
    ];
    const links = [
      {
        link_id: 'l1',
        linked_entity_id: 'e2',
        linked_entity_title: 'Suggested',
        linked_entity_type: 'function',
        linked_source_file: null,
        relationship_type: 'references',
        confidence: 0.75,
        auto_generated: true,
        direction: 'outgoing',
      },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'note_list') return Promise.resolve(notes);
      if (cmd === 'entity_links_with_details') return Promise.resolve(links);
      if (cmd === 'entity_link_confirm') return Promise.resolve(true);
      return Promise.resolve([]);
    });

    const { default: NotesPanel } = await import('../NotesPanel');
    const { container } = render(() => <NotesPanel />);

    await vi.waitFor(() => expect(container.textContent).toContain('Confirm Target'));
    const noteBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Confirm Target'));
    if (noteBtn) fireEvent.click(noteBtn);

    await vi.waitFor(() => expect(screen.getByTestId('confirm-link-l1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-link-l1'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('entity_link_confirm', { linkId: 'l1' });
    });
  });

  it('dismiss button calls entity_link_delete', async () => {
    const notes = [
      { id: 'n1', title: 'Dismiss Target', content: 'content', metadata: null, created_at: '', updated_at: '' },
    ];
    const links = [
      {
        link_id: 'l1',
        linked_entity_id: 'e2',
        linked_entity_title: 'Suggested',
        linked_entity_type: 'function',
        linked_source_file: null,
        relationship_type: 'references',
        confidence: 0.75,
        auto_generated: true,
        direction: 'outgoing',
      },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'note_list') return Promise.resolve(notes);
      if (cmd === 'entity_links_with_details') return Promise.resolve(links);
      if (cmd === 'entity_link_delete') return Promise.resolve(true);
      return Promise.resolve([]);
    });

    const { default: NotesPanel } = await import('../NotesPanel');
    const { container } = render(() => <NotesPanel />);

    await vi.waitFor(() => expect(container.textContent).toContain('Dismiss Target'));
    const noteBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Dismiss Target'));
    if (noteBtn) fireEvent.click(noteBtn);

    await vi.waitFor(() => expect(screen.getByTestId('dismiss-link-l1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('dismiss-link-l1'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('entity_link_delete', { linkId: 'l1' });
    });
  });

  it('suggestion count badge shows correct number', async () => {
    const notes = [
      { id: 'n1', title: 'Badge Check', content: 'content', metadata: null, created_at: '', updated_at: '' },
    ];
    const links = [
      {
        link_id: 'l1', linked_entity_id: 'e1', linked_entity_title: 'A',
        linked_entity_type: 'function', linked_source_file: null,
        relationship_type: 'references', confidence: 0.75, auto_generated: true, direction: 'outgoing',
      },
      {
        link_id: 'l2', linked_entity_id: 'e2', linked_entity_title: 'B',
        linked_entity_type: 'class', linked_source_file: null,
        relationship_type: 'references', confidence: 0.80, auto_generated: true, direction: 'outgoing',
      },
      {
        link_id: 'l3', linked_entity_id: 'e3', linked_entity_title: 'C',
        linked_entity_type: 'note', linked_source_file: null,
        relationship_type: 'references', confidence: 0.90, auto_generated: true, direction: 'outgoing',
      },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'note_list') return Promise.resolve(notes);
      if (cmd === 'entity_links_with_details') return Promise.resolve(links);
      return Promise.resolve([]);
    });

    const { default: NotesPanel } = await import('../NotesPanel');
    const { container } = render(() => <NotesPanel />);

    await vi.waitFor(() => expect(container.textContent).toContain('Badge Check'));
    const noteBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Badge Check'));
    if (noteBtn) fireEvent.click(noteBtn);

    await vi.waitFor(() => {
      const badge = screen.getByTestId('suggestion-count');
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toContain('2');
    });
  });

  it('high-confidence auto links show auto badge, not buttons', async () => {
    const notes = [
      { id: 'n1', title: 'HighConf Entry', content: 'content', metadata: null, created_at: '', updated_at: '' },
    ];
    const links = [
      {
        link_id: 'l1', linked_entity_id: 'e2', linked_entity_title: 'HighConf',
        linked_entity_type: 'function', linked_source_file: 'src/lib.rs',
        relationship_type: 'references', confidence: 0.90, auto_generated: true, direction: 'outgoing',
      },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === 'note_list') return Promise.resolve(notes);
      if (cmd === 'entity_links_with_details') return Promise.resolve(links);
      return Promise.resolve([]);
    });

    const { default: NotesPanel } = await import('../NotesPanel');
    const { container } = render(() => <NotesPanel />);

    await vi.waitFor(() => expect(container.textContent).toContain('HighConf Entry'));
    const noteBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('HighConf Entry'));
    if (noteBtn) fireEvent.click(noteBtn);

    await vi.waitFor(() => {
      expect(screen.getByTestId('auto-badge')).toBeInTheDocument();
    });
    // Should NOT have confirm/dismiss buttons
    expect(screen.queryByTestId('confirm-link-l1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dismiss-link-l1')).not.toBeInTheDocument();
  });
});
