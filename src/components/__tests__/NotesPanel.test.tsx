import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';

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
});
