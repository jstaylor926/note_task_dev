import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { ptyCreate, ptyWrite, ptyResize, ptyKill, onPtyOutput, onPtyExit } from '../lib/pty';
import { persistTerminalCommand, resolveTerminalError, type TerminalResolveResponse } from '../lib/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

interface XtermInstanceProps {
  sessionId: string;
  cwd?: string;
  onExit?: (exitCode: number | null) => void;
  onFocus?: () => void;
}

function XtermInstance(props: XtermInstanceProps) {
  let containerRef: HTMLDivElement | undefined;
  let terminal: Terminal | undefined;
  let fitAddon: FitAddon | undefined;
  let unlistenOutput: UnlistenFn | undefined;
  let unlistenExit: UnlistenFn | undefined;
  let unlistenCommandEnd: UnlistenFn | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const [lastCommand, setLastCommand] = createSignal("");
  const [lastOutput, setLastOutput] = createSignal("");
  const [lastExitCode, setLastExitCode] = createSignal<number | null>(null);
  const [showFix, setShowFix] = createSignal(false);
  const [isResolving, setIsResolving] = createSignal(false);
  const [resolution, setResolution] = createSignal<TerminalResolveResponse | null>(null);

  // Capture recent output for context
  let outputBuffer = "";
  const MAX_OUTPUT_CONTEXT = 5000;

  onMount(async () => {
    if (!containerRef) return;

    // Create terminal with theme matching app CSS vars
    terminal = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        selectionBackground: '#364a82',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
    });

    // Load addons
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new SearchAddon());

    // Open terminal in container
    terminal.open(containerRef);
    fitAddon.fit();

    // Create PTY session
    try {
      await ptyCreate(props.sessionId, props.cwd, terminal.cols, terminal.rows);
      // Send initial resize just in case
      await ptyResize(props.sessionId, terminal.cols, terminal.rows);
    } catch (e) {
      terminal.writeln(`\r\n[Failed to create terminal session: ${e}]`);
      return;
    }

    // Forward user input to PTY (base64-encoded)
    terminal.onData((data) => {
      const encoded = btoa(data);
      ptyWrite(props.sessionId, encoded).catch((err) => {
        console.error('Failed to write to PTY:', err);
        terminal?.write(`\r\n[Write error: ${err}]`);
      });
    });

    // Listen for PTY output
    unlistenOutput = await onPtyOutput((event) => {
      if (event.session_id !== props.sessionId) return;
      // Decode base64 to bytes and write to terminal
      const decoded = atob(event.data);
      const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
      terminal?.write(bytes);

      // Add to buffer for AI context
      outputBuffer += decoded;
      if (outputBuffer.length > MAX_OUTPUT_CONTEXT) {
        outputBuffer = outputBuffer.slice(-MAX_OUTPUT_CONTEXT);
      }
    });

    // Listen for shell-hook command end events
    unlistenCommandEnd = await listen('terminal:command-end', (event: any) => {
      const { session_id, command, exit_code, duration_ms, cwd } = event.payload;
      if (session_id !== props.sessionId) return;

      setLastCommand(command);
      setLastExitCode(exit_code);
      setLastOutput(outputBuffer);
      
      // Persist to DB
      persistTerminalCommand(command, cwd, exit_code, duration_ms, outputBuffer).catch(console.error);

      // Clear buffer for next command
      outputBuffer = "";

      // Show AI fix if it failed
      if (exit_code && exit_code !== 0) {
        setShowFix(true);
      } else {
        setShowFix(false);
        setResolution(null);
      }
    });

    // Listen for NL translation execution requests
    const handleRunCommand = (e: any) => {
      if (e.detail.sessionId === props.sessionId) {
        const encoded = btoa(e.detail.command + "\n");
        ptyWrite(props.sessionId, encoded).catch(console.error);
      }
    };
    window.addEventListener('terminal:run-command', handleRunCommand as any);

    onCleanup(() => {
      window.removeEventListener('terminal:run-command', handleRunCommand as any);
    });

    // Listen for PTY exit
    unlistenExit = await onPtyExit((event) => {
      if (event.session_id !== props.sessionId) return;
      const code = event.exit_code;
      terminal?.writeln(
        `\r\n[Process exited${code !== null ? ` with code ${code}` : ''}]`,
      );
      props.onExit?.(code);
    });

    // Resize observer for fit
    let resizeTimeout: number | undefined;
    resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        if (!fitAddon || !terminal) return;
        fitAddon.fit();
        ptyResize(props.sessionId, terminal.cols, terminal.rows).catch((e) => {
          console.error('Failed to resize PTY:', e);
        });
      }, 100);
    });
    resizeObserver.observe(containerRef);
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    unlistenOutput?.();
    unlistenExit?.();
    unlistenCommandEnd?.();
    terminal?.dispose();
    ptyKill(props.sessionId).catch(() => {});
  });

  const handleResolve = async () => {
    setIsResolving(true);
    try {
      const res = await resolveTerminalError(lastCommand(), lastExitCode() || 1, lastOutput());
      setResolution(res);
    } catch (e) {
      console.error("Resolution failed:", e);
    } finally {
      setIsResolving(false);
    }
  };

  const runFixedCommand = () => {
    const res = resolution();
    if (res) {
      const encoded = btoa(res.suggestion + "\n");
      ptyWrite(props.sessionId, encoded).catch(console.error);
      setShowFix(false);
      setResolution(null);
    }
  };

  return (
    <div class="relative h-full w-full group">
      <div
        ref={containerRef}
        class="h-full w-full"
        onFocusIn={() => props.onFocus?.()}
        onClick={() => props.onFocus?.()}
      />

      {/* AI Fix Overlay */}
      <Show when={showFix()}>
        <div class="absolute bottom-4 right-4 max-w-[300px] bg-[var(--color-bg-secondary)] border border-[var(--color-error)]/50 rounded shadow-2xl p-3 z-10 transition-all">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-1.5 text-[var(--color-error)]">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span class="text-[10px] font-bold uppercase tracking-tight">Command Failed ({lastExitCode()})</span>
            </div>
            <button onClick={() => setShowFix(false)} class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs">×</button>
          </div>

          <Show when={!resolution()} fallback={
            <div class="space-y-2">
              <p class="text-[11px] text-[var(--color-text-primary)] font-medium leading-tight">{resolution()?.analysis}</p>
              <div class="bg-black/30 p-1.5 rounded border border-[var(--color-border)]">
                <code class="block text-[10px] font-mono text-[var(--color-text-secondary)] mb-1">Suggestion:</code>
                <code class="block text-xs font-mono text-[var(--color-success)]">{resolution()?.suggestion}</code>
              </div>
              <p class="text-[10px] text-[var(--color-text-secondary)] italic leading-tight">{resolution()?.explanation}</p>
              <div class="flex gap-2 pt-1">
                <button
                  onClick={runFixedCommand}
                  class="flex-1 px-2 py-1 bg-[var(--color-success)] text-white text-[10px] font-bold rounded hover:opacity-90"
                >
                  Apply Fix
                </button>
                <button
                  onClick={() => setResolution(null)}
                  class="px-2 py-1 bg-[var(--color-bg-panel)] text-[var(--color-text-primary)] text-[10px] font-bold rounded border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]"
                >
                  Back
                </button>
              </div>
            </div>
          }>
            <p class="text-[11px] text-[var(--color-text-secondary)] mb-3 leading-snug">
              Command <code>{lastCommand().split(' ')[0]}</code> failed. Would you like Cortex to analyze the error?
            </p>
            <button
              onClick={handleResolve}
              disabled={isResolving()}
              class="w-full px-3 py-1.5 bg-[var(--color-accent)] text-white text-[10px] font-bold rounded hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
            >
              {isResolving() ? "Analyzing..." : "Ask Cortex to Fix"}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default XtermInstance;
