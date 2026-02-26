import { createSignal } from "solid-js";
import { checkHealth, type HealthStatus } from "../lib/tauri";

function ChatPanel() {
  const [health, setHealth] = createSignal<HealthStatus | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  const runHealthCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await checkHealth();
      setHealth(result);
    } catch (e) {
      setError(String(e));
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  const allOk = () => {
    const h = health();
    return h && h.tauri === "ok" && h.sidecar === "ok" && h.sqlite === "ok" && h.lancedb === "ok";
  };

  return (
    <div class="h-full p-3 bg-[var(--color-bg-secondary)] flex flex-col">
      <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
        Chat
      </div>
      <div class="flex-1 text-sm text-[var(--color-text-secondary)]">
        AI chat interface will appear here.
      </div>

      {/* Phase 0: Health check validation */}
      <div class="border-t border-[var(--color-border)] pt-3 mt-3">
        <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-2">
          System Health
        </div>
        <button
          onClick={runHealthCheck}
          disabled={loading()}
          class="w-full px-3 py-1.5 text-xs font-medium rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
        >
          {loading() ? "Checking..." : "Run Health Check"}
        </button>

        {health() && (
          <div class="mt-2 space-y-1">
            {(["tauri", "sidecar", "sqlite", "lancedb"] as const).map((key) => (
              <div class="flex items-center justify-between text-xs">
                <span class="text-[var(--color-text-secondary)]">{key}</span>
                <span
                  class={
                    health()![key] === "ok"
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-error)]"
                  }
                >
                  {health()![key]}
                </span>
              </div>
            ))}
            {allOk() && (
              <div class="mt-2 text-xs text-[var(--color-success)] font-medium text-center">
                All systems operational
              </div>
            )}
          </div>
        )}

        {error() && (
          <div class="mt-2 text-xs text-[var(--color-error)]">{error()}</div>
        )}
      </div>
    </div>
  );
}

export default ChatPanel;
