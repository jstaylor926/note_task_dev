import { onMount, onCleanup, createEffect, on } from 'solid-js';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { cortexThemeExtension } from '../lib/codemirrorTheme';
import { getLanguageExtension } from '../lib/codemirrorLanguages';
import { LanguageServerClient, languageServerWithTransport } from 'codemirror-languageserver';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface CodeMirrorEditorProps {
  content: string;
  path?: string;
  language?: string;
  readonly?: boolean;
  onContentChange?: (content: string) => void;
}

class TauriLspTransport {
  private sessionId: string | null = null;
  private unlisten: UnlistenFn | null = null;
  public onData: ((data: any) => void) | null = null;

  constructor(private language: string, private serverUri: string) {}

  async connect() {
    this.sessionId = await invoke<string>('lsp_spawn', { language: this.language });
    this.unlisten = await listen<{ session_id: string, message: string }>('lsp:message', (event) => {
      if (event.payload.session_id === this.sessionId && this.onData) {
        this.onData(JSON.parse(event.payload.message));
      }
    });
  }

  sendData(data: any) {
    if (this.sessionId) {
      invoke('lsp_send', { sessionId: this.sessionId, message: JSON.stringify(data) });
    }
  }

  close() {
    this.unlisten?.();
  }

  subscribe(name: string, callback: any) {
    if (name === 'data') this.onData = callback;
  }
  unsubscribe() {
    this.onData = null;
  }
}

function CodeMirrorEditor(props: CodeMirrorEditorProps) {
  let containerRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let transport: TauriLspTransport | undefined;

  onMount(async () => {
    console.log("CodeMirrorEditor mounting for path:", props.path);
    if (!containerRef) {
      console.error("CodeMirrorEditor: containerRef is undefined");
      return;
    }

    const languageExt = getLanguageExtension(props.language);

    const extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      ...cortexThemeExtension,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    ];

    if (languageExt) {
      extensions.push(languageExt);
    }

    if (props.readonly) {
      extensions.push(EditorState.readOnly.of(true));
    }

    // Add LSP if language is supported and path exists
    if (props.path && (props.language === 'python' || props.language === 'rust')) {
      const serverUri = `file://${props.path}`;
      const lspTransport = new TauriLspTransport(props.language, serverUri);
      transport = lspTransport;
      
      try {
        // Use a timeout for connection to avoid blocking UI forever
        await Promise.race([
          lspTransport.connect(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('LSP timeout')), 3000))
        ]);
        
        extensions.push(languageServerWithTransport({
          transport: lspTransport as any,
          rootUri: `file://${props.path.substring(0, props.path.lastIndexOf('/'))}`,
          documentUri: serverUri,
          languageId: props.language,
          workspaceFolders: null
        }));
      } catch (e) {
        console.error("Failed to connect to LSP:", e);
        // Continue without LSP
      }
    }

    if (props.onContentChange) {
      const callback = props.onContentChange;
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            callback(update.state.doc.toString());
          }
        }),
      );
    }

    const state = EditorState.create({
      doc: props.content,
      extensions,
    });
    console.log("EditorState created");

    view = new EditorView({
      state,
      parent: containerRef,
    });
    console.log("EditorView initialized");
  });

  // ... rest of implementation
  onCleanup(() => {
    view?.destroy();
    transport?.close();
  });

  return (
    <div
      ref={containerRef}
      class="h-full w-full overflow-hidden"
      data-testid="codemirror-editor"
    />
  );
}

export default CodeMirrorEditor;
