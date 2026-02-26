function EditorPanel() {
  return (
    <div class="h-full p-4 bg-[var(--color-bg-panel)]">
      <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
        Editor
      </div>
      <div class="text-sm text-[var(--color-text-secondary)]">
        CodeMirror 6 editor will be mounted here.
      </div>
      <div class="mt-4 p-3 rounded bg-[var(--color-bg-primary)] font-mono text-xs text-[var(--color-text-secondary)]">
        <div class="text-[var(--color-accent)]">{"// cortex — Phase 0 skeleton"}</div>
        <div class="mt-1">{"fn main() {"}</div>
        <div class="ml-4">{"println!(\"Hello from Cortex!\");"}</div>
        <div>{"}"}</div>
      </div>
    </div>
  );
}

export default EditorPanel;
