import { For, Show, createSignal, onMount } from 'solid-js';
import {
  exportDiagnosticsLog,
  getStartupDiagnostics,
  type StartupDiagnostics,
} from '../lib/tauri';

function DiagnosticsPanel() {
  const [diagnostics, setDiagnostics] = createSignal<StartupDiagnostics | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [exportPath, setExportPath] = createSignal<string | null>(null);
  const [exporting, setExporting] = createSignal(false);

  const loadDiagnostics = async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await getStartupDiagnostics();
      setDiagnostics(snapshot);
    } catch (e) {
      setError(String(e));
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const path = await exportDiagnosticsLog();
      setExportPath(path);
      await loadDiagnostics();
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  };

  onMount(() => {
    loadDiagnostics();
  });

  return (
    <div class="h-full flex flex-col border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <div class="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
        <div class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
          Startup Diagnostics
        </div>
        <div class="flex gap-1.5">
          <button
            onClick={loadDiagnostics}
            disabled={loading()}
            class="px-2 py-0.5 rounded text-[10px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)] disabled:opacity-50"
          >
            {loading() ? '...' : 'Refresh'}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting()}
            class="px-2 py-0.5 rounded text-[10px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)] disabled:opacity-50"
          >
            {exporting() ? '...' : 'Export'}
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-auto px-3 py-2 space-y-2 text-[11px]">
        <Show when={error()}>
          <div class="text-[var(--color-error)]">Diagnostics error: {error()}</div>
        </Show>

        <Show when={exportPath()}>
          <div class="text-[10px] text-[var(--color-text-secondary)] break-all">
            Exported: {exportPath()}
          </div>
        </Show>

        <Show when={diagnostics()}>
          {(d) => (
            <>
              <div class="flex items-center justify-between">
                <span class="text-[var(--color-text-secondary)]">Sidecar process</span>
                <span class="font-mono text-[var(--color-text-primary)]">
                  {d().sidecar_process_status}
                </span>
              </div>

              <div class="flex items-center justify-between">
                <span class="text-[var(--color-text-secondary)]">Profile</span>
                <span class="font-mono text-[var(--color-text-primary)] truncate max-w-[160px]">
                  {d().active_profile_id}
                </span>
              </div>

              <div class="flex items-center justify-between">
                <span class="text-[var(--color-text-secondary)]">Branch</span>
                <span class="font-mono text-[var(--color-text-primary)]">{d().git_branch}</span>
              </div>

              <div class="text-[var(--color-text-secondary)] text-[10px] pt-1">
                Health
              </div>
              <div class="space-y-1">
                <For each={(['tauri', 'sidecar', 'sqlite', 'lancedb'] as const)}>
                  {(key) => (
                    <div class="flex items-center justify-between">
                      <span class="text-[var(--color-text-secondary)]">{key}</span>
                      <span
                        class={
                          d().health[key] === 'ok'
                            ? 'text-[var(--color-success)]'
                            : 'text-[var(--color-error)]'
                        }
                      >
                        {d().health[key]}
                      </span>
                    </div>
                  )}
                </For>
              </div>

              <div class="flex items-center justify-between pt-1">
                <span class="text-[var(--color-text-secondary)]">Indexing</span>
                <span class="font-mono text-[var(--color-text-primary)]">
                  {d().indexing.completed}/{d().indexing.total}
                </span>
              </div>

              <div class="flex items-center justify-between">
                <span class="text-[var(--color-text-secondary)]">Remote API</span>
                <span class="font-mono text-[var(--color-text-primary)]">
                  {d().remote_access.enabled ? `ON:${d().remote_access.port}` : 'OFF'}
                </span>
              </div>

              <div class="text-[var(--color-text-secondary)] text-[10px] pt-1">
                Recent Audit Events
              </div>
              <Show when={d().recent_audit_events.length > 0} fallback={
                <div class="text-[10px] text-[var(--color-text-secondary)]">No audit events yet</div>
              }>
                <div class="space-y-1">
                  <For each={d().recent_audit_events.slice(0, 3)}>
                    {(event) => (
                      <div class="rounded border border-[var(--color-border)] px-2 py-1 bg-[var(--color-bg-panel)]">
                        <div class="text-[10px] font-mono text-[var(--color-text-primary)] truncate">
                          {event.event_type}
                        </div>
                        <Show when={event.actor}>
                          <div class="text-[10px] text-[var(--color-text-secondary)]">
                            actor: {event.actor}
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}

export default DiagnosticsPanel;
