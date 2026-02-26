function TaskPanel() {
  return (
    <div class="h-full p-3 bg-[var(--color-bg-secondary)]">
      <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
        Tasks
      </div>
      <div class="text-sm text-[var(--color-text-secondary)]">
        Task board will appear here.
      </div>
      <div class="mt-3 space-y-2">
        <div class="p-2 rounded bg-[var(--color-bg-panel)] text-xs flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
          <span class="text-[var(--color-text-secondary)]">Phase 0: Skeleton</span>
        </div>
        <div class="p-2 rounded bg-[var(--color-bg-panel)] text-xs flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-[var(--color-border)]" />
          <span class="text-[var(--color-text-secondary)]">Phase 1: Context Engine</span>
        </div>
      </div>
    </div>
  );
}

export default TaskPanel;
