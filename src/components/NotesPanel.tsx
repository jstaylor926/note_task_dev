function NotesPanel() {
  return (
    <div class="h-full p-3 bg-[var(--color-bg-secondary)]">
      <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
        Notes
      </div>
      <div class="text-sm text-[var(--color-text-secondary)]">
        Markdown notes will appear here.
      </div>
      <div class="mt-3 space-y-2">
        <div class="p-2 rounded bg-[var(--color-bg-panel)] text-xs text-[var(--color-text-secondary)]">
          Session notes
        </div>
        <div class="p-2 rounded bg-[var(--color-bg-panel)] text-xs text-[var(--color-text-secondary)]">
          Research notes
        </div>
      </div>
    </div>
  );
}

export default NotesPanel;
