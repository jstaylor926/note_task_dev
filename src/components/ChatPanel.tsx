import { createSignal, onMount, For, Show } from "solid-js";
import { 
  checkHealth, 
  type HealthStatus, 
  type ChatMessage, 
  sendChatMessage, 
  getLatestSession, 
  type SessionStatePayload 
} from "../lib/tauri";

function ChatPanel() {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [inputText, setInputText] = createSignal("");
  const [isTyping, setIsTyping] = createSignal(false);
  const [sessionSummary, setSessionSummary] = createSignal<SessionStatePayload | null>(null);
  
  // Health check signals (Phase 0 legacy)
  const [health, setHealth] = createSignal<HealthStatus | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  onMount(async () => {
    await hydrateSession();
  });

  const hydrateSession = async () => {
    try {
      const latest = await getLatestSession();
      if (latest) {
        const payload: SessionStatePayload = JSON.parse(latest.payload);
        setSessionSummary(payload);
        
        // Initial greeting based on summary
        setMessages([
          {
            role: "assistant",
            content: `Welcome back! Here's what I remember: ${payload.summary}`
          }
        ]);
      } else {
        setMessages([
          {
            role: "assistant",
            content: "Hello! I'm Cortex. How can I help you today?"
          }
        ]);
      }
    } catch (e) {
      console.error("Failed to hydrate session:", e);
    }
  };

  const handleSend = async (e?: Event) => {
    if (e) e.preventDefault();
    const text = inputText().trim();
    if (!text || isTyping()) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages([...messages(), userMsg]);
    setInputText("");
    setIsTyping(true);

    try {
      const response = await sendChatMessage(messages());
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: response.choices[0].message.content
      };
      setMessages([...messages(), assistantMsg]);
    } catch (e) {
      setMessages([...messages(), { role: "system", content: `Error: ${String(e)}` }]);
    } finally {
      setIsTyping(false);
    }
  };

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

  return (
    <div class="h-full p-2 bg-[var(--color-bg-secondary)] flex flex-col overflow-hidden">
      <div class="flex items-center justify-between mb-2">
        <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
          Chat
        </div>
        <Show when={sessionSummary()}>
          <div class="px-2 py-0.5 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] text-[10px] font-bold">
            CONTEXT ACTIVE
          </div>
        </Show>
      </div>

      {/* Session Summary Card (collapsible) */}
      <Show when={sessionSummary()}>
        <details class="mb-2">
          <summary class="text-[10px] font-medium text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)] transition-colors">
            Last Session Summary
          </summary>
          <div class="mt-1 p-2 rounded border border-[var(--color-accent)]/30 bg-[var(--color-bg-panel)] text-[11px] space-y-2">
            <div class="text-[var(--color-text-secondary)] italic">"{sessionSummary()?.summary}"</div>

            <Show when={sessionSummary()?.blockers.length}>
              <div class="pt-1">
                <span class="text-[var(--color-error)] font-bold">Blockers:</span>
                <ul class="list-disc pl-4 mt-1">
                  <For each={sessionSummary()?.blockers}>
                    {(b) => <li>{b}</li>}
                  </For>
                </ul>
              </div>
            </Show>

            <Show when={sessionSummary()?.next_steps.length}>
              <div class="pt-1">
                <span class="text-[var(--color-success)] font-bold">Next Steps:</span>
                <ul class="list-disc pl-4 mt-1">
                  <For each={sessionSummary()?.next_steps}>
                    {(s) => <li>{s}</li>}
                  </For>
                </ul>
              </div>
            </Show>
          </div>
        </details>
      </Show>

      {/* Message List */}
      <div class="flex-1 overflow-y-auto mb-2 space-y-2 pr-1 scrollbar-thin">
        <For each={messages()}>
          {(msg) => (
            <div class={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div 
                class={`max-w-[90%] p-2 rounded text-xs ${
                  msg.role === 'user' 
                    ? 'bg-[var(--color-accent)] text-white rounded-tr-none' 
                    : msg.role === 'system'
                      ? 'bg-red-900/20 text-red-400 border border-red-900/50'
                      : 'bg-[var(--color-bg-panel)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-tl-none'
                }`}
              >
                {msg.content}
              </div>
            </div>
          )}
        </For>
        <Show when={isTyping()}>
          <div class="flex items-center space-x-1 text-[var(--color-text-secondary)] text-[10px] animate-pulse">
            <div class="w-1 h-1 bg-current rounded-full"></div>
            <div class="w-1 h-1 bg-current rounded-full"></div>
            <div class="w-1 h-1 bg-current rounded-full"></div>
            <span>Cortex is thinking...</span>
          </div>
        </Show>
      </div>

      {/* Input Area */}
      <form onSubmit={handleSend} class="relative">
        <textarea
          value={inputText()}
          onInput={(e) => setInputText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask Cortex anything..."
          class="w-full p-2 pr-10 bg-[var(--color-bg-panel)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent)] resize-none min-h-[36px]"
        />
        <button
          type="submit"
          disabled={!inputText().trim() || isTyping()}
          class="absolute right-2 bottom-2 p-1.5 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] disabled:opacity-30 disabled:hover:text-[var(--color-text-secondary)]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </form>

      {/* Phase 0: Health check (collapsible) */}
      <details class="mt-3 border-t border-[var(--color-border)] pt-2">
        <summary class="text-[10px] font-medium text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)] transition-colors">
          Debug / System Health
        </summary>
        <div class="pt-2">
          <button
            onClick={runHealthCheck}
            disabled={loading()}
            class="w-full px-3 py-1.5 text-[10px] font-medium rounded bg-[var(--color-bg-panel)] border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors disabled:opacity-50"
          >
            {loading() ? "Checking..." : "Run Health Check"}
          </button>

          {health() && (
            <div class="mt-2 space-y-1">
              {(["tauri", "sidecar", "sqlite", "lancedb"] as const).map((key) => (
                <div class="flex items-center justify-between text-[10px]">
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
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

export default ChatPanel;
