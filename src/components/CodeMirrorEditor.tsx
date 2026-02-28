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

export interface CodeMirrorEditorProps {
  content: string;
  language?: string;
  readonly?: boolean;
  onContentChange?: (content: string) => void;
}

function CodeMirrorEditor(props: CodeMirrorEditorProps) {
  let containerRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  onMount(() => {
    if (!containerRef) return;

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

    view = new EditorView({
      state,
      parent: containerRef,
    });
  });

  // Update content when prop changes externally (e.g., file switch)
  createEffect(
    on(
      () => props.content,
      (newContent) => {
        if (!view) return;
        const currentContent = view.state.doc.toString();
        if (newContent !== currentContent) {
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: newContent,
            },
          });
        }
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    view?.destroy();
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
