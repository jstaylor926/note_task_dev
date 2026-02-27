import { onMount, onCleanup } from 'solid-js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { ptyCreate, ptyWrite, ptyResize, ptyKill, onPtyOutput, onPtyExit } from '../lib/pty';
import type { UnlistenFn } from '@tauri-apps/api/event';
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
  let resizeObserver: ResizeObserver | undefined;

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
      const bytes = Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0));
      terminal?.write(bytes);
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
    terminal?.dispose();
    ptyKill(props.sessionId).catch(() => {});
  });

  return (
    <div
      ref={containerRef}
      class="h-full w-full"
      onFocusIn={() => props.onFocus?.()}
      onClick={() => props.onFocus?.()}
    />
  );
}

export default XtermInstance;
