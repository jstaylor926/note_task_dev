import { createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { noteStore } from '../lib/noteStoreInstance';
import type { LinkWithEntity } from '../lib/entityLinks';

const TYPE_COLORS: Record<string, string> = {
  note: '#6366f1',
  task: '#f59e0b',
  function: '#10b981',
  class: '#3b82f6',
  struct: '#8b5cf6',
  file: '#64748b',
};

function typeBadgeColor(entityType: string): string {
  return TYPE_COLORS[entityType] ?? '#64748b';
}

function NotesPanel() {
  const [editTitle, setEditTitle] = createSignal('');
  const [editContent, setEditContent] = createSignal('');
  const [linksExpanded, setLinksExpanded] = createSignal(true);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let titleRef: HTMLInputElement | undefined;

  onMount(() => {
    noteStore.loadNotes();
  });

  onCleanup(() => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  function handleSelectNote(id: string) {
    // Save pending changes before switching
    flushSave();
    noteStore.selectNote(id);
    const note = noteStore.getActiveNote();
    if (note) {
      setEditTitle(note.title);
      setEditContent(note.content);
    }
  }

  function handleCreate() {
    flushSave();
    noteStore.createNote('Untitled').then((note) => {
      if (note) {
        setEditTitle(note.title);
        setEditContent(note.content);
        titleRef?.focus();
        titleRef?.select();
      }
    });
  }

  function handleDelete() {
    const active = noteStore.getActiveNote();
    if (!active) return;
    if (saveTimer) clearTimeout(saveTimer);
    noteStore.deleteNote(active.id).then(() => {
      const next = noteStore.getActiveNote();
      if (next) {
        setEditTitle(next.title);
        setEditContent(next.content);
      } else {
        setEditTitle('');
        setEditContent('');
      }
    });
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const active = noteStore.getActiveNote();
      if (active) {
        noteStore.updateNote(active.id, editTitle(), editContent());
      }
    }, 1000);
  }

  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      const active = noteStore.getActiveNote();
      if (active) {
        noteStore.updateNote(active.id, editTitle(), editContent());
      }
    }
  }

  function handleTitleInput(value: string) {
    setEditTitle(value);
    scheduleSave();
  }

  function handleContentInput(value: string) {
    setEditContent(value);
    scheduleSave();
  }

  async function handleLinkClick(link: LinkWithEntity) {
    if (link.linked_entity_type === 'note') {
      handleSelectNote(link.linked_entity_id);
    } else if (link.linked_source_file) {
      // Dynamic import to avoid circular dependency
      const { handleOpenFile } = await import('./EditorPanel');
      handleOpenFile(link.linked_source_file);
    }
  }

  const activeNote = () => noteStore.getActiveNote();

  return (
    <div class="flex flex-col h-full bg-[var(--color-bg-secondary)]">
      {/* Header */}
      <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <div class="flex items-center gap-2">
          <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Notes
          </div>
          <Show when={noteStore.state.isLinking}>
            <span class="text-[10px] text-[var(--color-accent)] animate-pulse" data-testid="linking-indicator">
              Linking...
            </span>
          </Show>
        </div>
        <div class="flex items-center gap-1">
          <Show when={activeNote()}>
            <button
              onClick={handleDelete}
              class="px-2 py-0.5 text-[10px] rounded text-[var(--color-error)] hover:bg-[var(--color-bg-panel)] transition-colors"
              title="Delete note"
            >
              Delete
            </button>
          </Show>
          <button
            onClick={handleCreate}
            class="px-2 py-1 text-[10px] font-medium rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            New
          </button>
        </div>
      </div>

      <Show
        when={noteStore.state.notes.length > 0}
        fallback={
          <div class="flex-1 flex items-center justify-center p-4">
            <div class="text-center">
              <div class="text-sm text-[var(--color-text-secondary)] mb-2">
                No notes yet.
              </div>
              <div class="text-xs text-[var(--color-text-secondary)]">
                Create one to get started.
              </div>
            </div>
          </div>
        }
      >
        <div class="flex flex-1 min-h-0">
          {/* Note list sidebar */}
          <div class="w-36 border-r border-[var(--color-border)] overflow-y-auto flex-shrink-0">
            <For each={noteStore.state.notes}>
              {(note) => (
                <button
                  onClick={() => handleSelectNote(note.id)}
                  class={`w-full text-left px-2 py-1.5 text-xs border-b border-[var(--color-border)] transition-colors truncate ${
                    noteStore.state.activeNoteId === note.id
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-panel)]'
                  }`}
                >
                  {note.title || 'Untitled'}
                </button>
              )}
            </For>
          </div>

          {/* Editor area */}
          <div class="flex-1 flex flex-col min-w-0">
            <Show
              when={activeNote()}
              fallback={
                <div class="flex-1 flex items-center justify-center text-xs text-[var(--color-text-secondary)]">
                  Select a note
                </div>
              }
            >
              <input
                ref={titleRef}
                type="text"
                value={editTitle()}
                onInput={(e) => handleTitleInput(e.currentTarget.value)}
                placeholder="Note title"
                class="px-3 py-2 text-sm font-medium bg-transparent border-b border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent)]"
              />
              <textarea
                value={editContent()}
                onInput={(e) => handleContentInput(e.currentTarget.value)}
                placeholder="Start writing..."
                class="flex-1 px-3 py-2 text-xs bg-transparent text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none resize-none"
              />

              {/* Links section */}
              <Show when={noteStore.state.activeNoteLinks.length > 0}>
                <div class="border-t border-[var(--color-border)]" data-testid="links-section">
                  <button
                    onClick={() => setLinksExpanded(!linksExpanded())}
                    class="w-full flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-panel)] transition-colors"
                  >
                    <span class="text-[8px]">{linksExpanded() ? '\u25BC' : '\u25B6'}</span>
                    Links ({noteStore.state.activeNoteLinks.length})
                  </button>
                  <Show when={linksExpanded()}>
                    <div class="px-2 pb-2 space-y-1 max-h-32 overflow-y-auto">
                      <For each={noteStore.state.activeNoteLinks}>
                        {(link) => (
                          <button
                            onClick={() => handleLinkClick(link)}
                            class="w-full flex items-center gap-1.5 px-2 py-1 rounded text-left hover:bg-[var(--color-bg-panel)] transition-colors group"
                            data-testid="link-item"
                          >
                            <span
                              class="inline-block px-1 py-0.5 rounded text-[8px] font-medium text-white flex-shrink-0"
                              style={{ 'background-color': typeBadgeColor(link.linked_entity_type) }}
                            >
                              {link.linked_entity_type}
                            </span>
                            <span class="text-[11px] text-[var(--color-text-primary)] truncate group-hover:text-[var(--color-accent)]">
                              {link.linked_entity_title}
                            </span>
                            <span class="text-[9px] text-[var(--color-text-secondary)] flex-shrink-0 ml-auto">
                              {Math.round(link.confidence * 100)}%
                            </span>
                            <Show when={link.auto_generated}>
                              <span class="text-[8px] text-[var(--color-text-secondary)] opacity-60 flex-shrink-0" data-testid="auto-badge">
                                auto
                              </span>
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default NotesPanel;
