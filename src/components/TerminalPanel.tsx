function TerminalPanel() {
  return (
    <div class="h-full p-4 bg-[var(--color-bg-primary)]">
      <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
        Terminal
      </div>
      <div class="font-mono text-xs text-[var(--color-text-secondary)]">
        <div>
          <span class="text-[var(--color-success)]">{"~"}</span>
          {" $ xterm.js terminal will be mounted here"}
        </div>
        <div class="mt-1 animate-pulse">{"_"}</div>
      </div>
    </div>
  );
}

export default TerminalPanel;
