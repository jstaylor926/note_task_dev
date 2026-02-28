import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'solid-js';

const mockNoteList = vi.fn();
const mockNoteCreate = vi.fn();
const mockNoteUpdate = vi.fn();
const mockNoteDelete = vi.fn();

const mockNoteAutoLink = vi.fn();
const mockEntityLinksWithDetails = vi.fn();

vi.mock('../notes', () => ({
  noteList: (...args: unknown[]) => mockNoteList(...args),
  noteCreate: (...args: unknown[]) => mockNoteCreate(...args),
  noteUpdate: (...args: unknown[]) => mockNoteUpdate(...args),
  noteDelete: (...args: unknown[]) => mockNoteDelete(...args),
}));

vi.mock('../entityLinks', () => ({
  noteAutoLink: (...args: unknown[]) => mockNoteAutoLink(...args),
  entityLinksWithDetails: (...args: unknown[]) => mockEntityLinksWithDetails(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('noteState', () => {
  it('starts with empty state', async () => {
    const { createNoteStore } = await import('../noteState');
    createRoot((dispose) => {
      const store = createNoteStore();
      expect(store.state.notes).toEqual([]);
      expect(store.state.activeNoteId).toBeNull();
      expect(store.state.activeNoteLinks).toEqual([]);
      expect(store.state.isLoading).toBe(false);
      expect(store.state.isLinking).toBe(false);
      expect(store.state.error).toBeNull();
      dispose();
    });
  });

  it('loadNotes fetches notes and updates state', async () => {
    const notes = [
      { id: 'n1', title: 'First', content: 'Body', metadata: null, created_at: '', updated_at: '' },
      { id: 'n2', title: 'Second', content: 'Body2', metadata: null, created_at: '', updated_at: '' },
    ];
    mockNoteList.mockResolvedValue(notes);
    const { createNoteStore } = await import('../noteState');

    await createRoot(async (dispose) => {
      const store = createNoteStore();
      await store.loadNotes();
      expect(store.state.notes.length).toBe(2);
      expect(store.state.isLoading).toBe(false);
      dispose();
    });
  });

  it('loadNotes sets error on failure', async () => {
    mockNoteList.mockRejectedValue(new Error('fail'));
    const { createNoteStore } = await import('../noteState');

    await createRoot(async (dispose) => {
      const store = createNoteStore();
      await store.loadNotes();
      expect(store.state.error).toBe('Error: fail');
      expect(store.state.isLoading).toBe(false);
      dispose();
    });
  });

  it('createNote adds note and sets active', async () => {
    const newNote = { id: 'n3', title: 'New', content: '', metadata: null, created_at: '', updated_at: '' };
    mockNoteCreate.mockResolvedValue(newNote);
    const { createNoteStore } = await import('../noteState');

    await createRoot(async (dispose) => {
      const store = createNoteStore();
      const result = await store.createNote('New');
      expect(result).toEqual(newNote);
      expect(store.state.notes.length).toBe(1);
      expect(store.state.activeNoteId).toBe('n3');
      dispose();
    });
  });

  it('selectNote sets activeNoteId and loads links', async () => {
    mockEntityLinksWithDetails.mockResolvedValue([]);
    const { createNoteStore } = await import('../noteState');
    createRoot((dispose) => {
      const store = createNoteStore();
      store.selectNote('n5');
      expect(store.state.activeNoteId).toBe('n5');
      expect(mockEntityLinksWithDetails).toHaveBeenCalledWith('n5');
      store.selectNote(null);
      expect(store.state.activeNoteId).toBeNull();
      dispose();
    });
  });

  it('updateNote updates in store', async () => {
    const note = { id: 'n1', title: 'Old', content: 'old', metadata: null, created_at: '', updated_at: '' };
    mockNoteCreate.mockResolvedValue(note);
    mockNoteUpdate.mockResolvedValue(true);
    const { createNoteStore } = await import('../noteState');

    await createRoot(async (dispose) => {
      const store = createNoteStore();
      await store.createNote('Old');
      await store.updateNote('n1', 'New Title', 'new content');
      expect(store.state.notes[0].title).toBe('New Title');
      expect(store.state.notes[0].content).toBe('new content');
      dispose();
    });
  });

  it('deleteNote removes from store and adjusts active', async () => {
    const n1 = { id: 'n1', title: 'A', content: '', metadata: null, created_at: '', updated_at: '' };
    const n2 = { id: 'n2', title: 'B', content: '', metadata: null, created_at: '', updated_at: '' };
    mockNoteList.mockResolvedValue([n1, n2]);
    mockNoteDelete.mockResolvedValue(true);
    const { createNoteStore } = await import('../noteState');

    await createRoot(async (dispose) => {
      const store = createNoteStore();
      await store.loadNotes();
      store.selectNote('n1');
      await store.deleteNote('n1');
      expect(store.state.notes.length).toBe(1);
      // Should select next available note
      expect(store.state.activeNoteId).toBe('n2');
      dispose();
    });
  });

  it('getActiveNote returns the selected note', async () => {
    const note = { id: 'n1', title: 'T', content: 'C', metadata: null, created_at: '', updated_at: '' };
    mockNoteList.mockResolvedValue([note]);
    mockEntityLinksWithDetails.mockResolvedValue([]);
    const { createNoteStore } = await import('../noteState');

    await createRoot(async (dispose) => {
      const store = createNoteStore();
      await store.loadNotes();
      expect(store.getActiveNote()).toBeNull();
      store.selectNote('n1');
      expect(store.getActiveNote()?.title).toBe('T');
      dispose();
    });
  });

  // ─── Link-related tests ────────────────────────────────────────────

  it('loadLinks fetches and sets activeNoteLinks', async () => {
    const mockLinks = [
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
    mockEntityLinksWithDetails.mockResolvedValue(mockLinks);
    const { createNoteStore } = await import('../noteState');

    await createRoot(async (dispose) => {
      const store = createNoteStore();
      store.selectNote('n1');
      // Wait for async loadLinks to complete
      await vi.waitFor(() => {
        expect(store.state.activeNoteLinks.length).toBe(1);
      });
      expect(store.state.activeNoteLinks[0].linked_entity_title).toBe('SearchPanel');
      dispose();
    });
  });

  it('autoLink calls noteAutoLink then refreshes links', async () => {
    mockNoteAutoLink.mockResolvedValue([]);
    mockEntityLinksWithDetails.mockResolvedValue([]);
    const { createNoteStore } = await import('../noteState');

    await createRoot(async (dispose) => {
      const store = createNoteStore();
      store.selectNote('n1');
      await store.autoLink('n1');
      expect(mockNoteAutoLink).toHaveBeenCalledWith('n1');
      // entityLinksWithDetails called twice: once from selectNote, once from autoLink
      expect(mockEntityLinksWithDetails).toHaveBeenCalledWith('n1');
      expect(store.state.isLinking).toBe(false);
      dispose();
    });
  });
});
