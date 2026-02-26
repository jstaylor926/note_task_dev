import { createSignal, Show, onCleanup } from "solid-js";
import { checkHealth, type HealthStatus } from "./lib/tauri";
import WorkspaceLayout from "./layouts/WorkspaceLayout";

// Detect if we're running inside Tauri or in a plain browser
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function App() {
  // In browser-only mode (no Tauri), skip health checks and show UI directly
  const [ready, setReady] = createSignal(!isTauri);
  const [statusMessage, setStatusMessage] = createSignal("Starting up...");

  const pollHealth = async () => {
    if (!isTauri) return;
    try {
      const status = await checkHealth();
      if (
        status.tauri === "ok" &&
        status.sidecar === "ok" &&
        status.sqlite === "ok" &&
        status.lancedb === "ok"
      ) {
        setReady(true);
      } else {
        const parts = [];
        if (status.sidecar !== "ok") parts.push(`sidecar: ${status.sidecar}`);
        if (status.sqlite !== "ok") parts.push(`db: ${status.sqlite}`);
        if (status.lancedb !== "ok") parts.push(`vectors: ${status.lancedb}`);
        setStatusMessage(`Waiting... ${parts.join(", ")}`);
      }
    } catch {
      setStatusMessage("Connecting to backend...");
    }
  };

  const interval = setInterval(() => {
    if (!ready()) {
      pollHealth();
    } else {
      clearInterval(interval);
    }
  }, 1000);

  pollHealth();
  onCleanup(() => clearInterval(interval));

  return (
    <div class="h-full w-full flex flex-col">
      <Show
        when={ready()}
        fallback={
          <div class="h-full w-full flex items-center justify-center">
            <div class="text-center">
              <div class="text-2xl font-semibold mb-4">Cortex</div>
              <div class="text-sm text-[var(--color-text-secondary)]">
                {statusMessage()}
              </div>
              <div class="mt-6">
                <div class="w-8 h-8 mx-auto border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          </div>
        }
      >
        <WorkspaceLayout />
      </Show>
    </div>
  );
}

export default App;
