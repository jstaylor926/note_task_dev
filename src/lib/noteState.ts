import { createStore, produce } from 'solid-js/store';
import type { NoteRow } from './notes';
import type { LinkWithEntity } from './entityLinks';
import { noteCreate, noteDelete, noteList, noteUpdate } from './notes';
import { noteAutoLink, entityLinksWithDetails } from './entityLinks';

interface NoteState {
  notes: NoteRow[];
  activeNoteId: string | null;
  activeNoteLinks: LinkWithEntity[];
  isLoading: boolean;
  isLinking: boolean;
  error: string | null;
}

export function createNoteStore() {
  const [state, setState] = createStore<NoteState>({
    notes: [],
    activeNoteId: null,
    activeNoteLinks: [],
    isLoading: false,
    isLinking: false,
    error: null,
  });

  let autoLinkTimer: ReturnType<typeof setTimeout> | undefined;

  async function loadNotes() {
    setState('isLoading', true);
    setState('error', null);
    try {
      const notes = await noteList();
      setState(
        produce((s) => {
          s.notes = notes;
          s.isLoading = false;
          // If active note was deleted, clear selection
          if (s.activeNoteId && !notes.find((n) => n.id === s.activeNoteId)) {
            s.activeNoteId = null;
          }
        }),
      );
    } catch (err) {
      setState(
        produce((s) => {
          s.error = String(err);
          s.isLoading = false;
        }),
      );
    }
  }

  async function createNote(title: string) {
    try {
      const note = await noteCreate(title, '');
      setState(
        produce((s) => {
          s.notes.unshift(note);
          s.activeNoteId = note.id;
          s.activeNoteLinks = [];
          s.error = null;
        }),
      );
      return note;
    } catch (err) {
      setState('error', String(err));
      return null;
    }
  }

  function selectNote(id: string | null) {
    setState('activeNoteId', id);
    setState('activeNoteLinks', []);
    if (id) {
      loadLinks(id);
    }
  }

  async function loadLinks(noteId: string) {
    try {
      const links = await entityLinksWithDetails(noteId);
      // Only update if still on the same note
      if (state.activeNoteId === noteId) {
        setState('activeNoteLinks', links);
      }
    } catch {
      // Silently ignore link loading errors
    }
  }

  async function autoLink(noteId: string) {
    setState('isLinking', true);
    try {
      await noteAutoLink(noteId);
      // Refresh links after auto-linking
      await loadLinks(noteId);
    } catch {
      // Silently ignore auto-link errors
    } finally {
      setState('isLinking', false);
    }
  }

  function scheduleAutoLink(noteId: string) {
    if (autoLinkTimer) clearTimeout(autoLinkTimer);
    autoLinkTimer = setTimeout(() => {
      autoLink(noteId);
    }, 3000);
  }

  async function updateNote(id: string, title: string, content: string) {
    try {
      await noteUpdate(id, title, content);
      setState(
        produce((s) => {
          const idx = s.notes.findIndex((n) => n.id === id);
          if (idx !== -1) {
            s.notes[idx].title = title;
            s.notes[idx].content = content;
            s.notes[idx].updated_at = new Date().toISOString();
          }
          s.error = null;
        }),
      );
      // Schedule auto-linking after save
      scheduleAutoLink(id);
      return true;
    } catch (err) {
      setState('error', String(err));
      return false;
    }
  }

  async function deleteNote(id: string) {
    if (autoLinkTimer) clearTimeout(autoLinkTimer);
    try {
      await noteDelete(id);
      setState(
        produce((s) => {
          const idx = s.notes.findIndex((n) => n.id === id);
          if (idx !== -1) {
            s.notes.splice(idx, 1);
          }
          if (s.activeNoteId === id) {
            s.activeNoteId = s.notes.length > 0 ? s.notes[0].id : null;
            s.activeNoteLinks = [];
          }
          s.error = null;
        }),
      );
      return true;
    } catch (err) {
      setState('error', String(err));
      return false;
    }
  }

  function getActiveNote(): NoteRow | null {
    if (!state.activeNoteId) return null;
    return state.notes.find((n) => n.id === state.activeNoteId) ?? null;
  }

  return {
    state,
    loadNotes,
    createNote,
    selectNote,
    updateNote,
    deleteNote,
    getActiveNote,
    loadLinks,
    autoLink,
  };
}
