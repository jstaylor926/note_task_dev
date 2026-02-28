import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';

// Mock CodeMirror — jsdom lacks DOM measurement APIs
vi.mock('@codemirror/state', () => {
  return {
    EditorState: {
      create: vi.fn(() => ({
        doc: { toString: () => '' },
      })),
      readOnly: { of: vi.fn(() => ({})) },
    },
  };
});

vi.mock('@codemirror/view', () => {
  class MockEditorView {
    state = { doc: { toString: () => '', length: 0 } };
    dispatch = vi.fn();
    destroy = vi.fn();

    constructor(config: { parent?: HTMLElement }) {
      if (config.parent) {
        const el = document.createElement('div');
        el.classList.add('cm-editor');
        config.parent.appendChild(el);
      }
    }

    static updateListener = {
      of: vi.fn(() => ({})),
    };
  }

  return {
    EditorView: MockEditorView,
    keymap: { of: vi.fn(() => ({})) },
    lineNumbers: vi.fn(() => ({})),
    highlightActiveLine: vi.fn(() => ({})),
    highlightActiveLineGutter: vi.fn(() => ({})),
    drawSelection: vi.fn(() => ({})),
    dropCursor: vi.fn(() => ({})),
  };
});

vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  history: vi.fn(() => ({})),
  historyKeymap: [],
  indentWithTab: {},
}));

vi.mock('@codemirror/language', () => ({
  syntaxHighlighting: vi.fn(() => ({})),
  defaultHighlightStyle: {},
  indentOnInput: vi.fn(() => ({})),
  bracketMatching: vi.fn(() => ({})),
  foldGutter: vi.fn(() => ({})),
  foldKeymap: [],
}));

vi.mock('@codemirror/autocomplete', () => ({
  closeBrackets: vi.fn(() => ({})),
  closeBracketsKeymap: [],
}));

vi.mock('@codemirror/search', () => ({
  highlightSelectionMatches: vi.fn(() => ({})),
  searchKeymap: [],
}));

vi.mock('@codemirror/lint', () => ({
  lintKeymap: [],
}));

vi.mock('../../lib/codemirrorTheme', () => ({
  cortexThemeExtension: [],
}));

vi.mock('../../lib/codemirrorLanguages', () => ({
  getLanguageExtension: vi.fn(() => null),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('CodeMirrorEditor', () => {
  it('renders a container with data-testid', async () => {
    const { default: CodeMirrorEditor } = await import('../CodeMirrorEditor');
    const { container } = render(() => (
      <CodeMirrorEditor content="hello" />
    ));
    const editorEl = container.querySelector('[data-testid="codemirror-editor"]');
    expect(editorEl).toBeTruthy();
  });

  it('renders with full height and width classes', async () => {
    const { default: CodeMirrorEditor } = await import('../CodeMirrorEditor');
    const { container } = render(() => (
      <CodeMirrorEditor content="hello" />
    ));
    const editorEl = container.querySelector('[data-testid="codemirror-editor"]');
    expect(editorEl?.className).toContain('h-full');
    expect(editorEl?.className).toContain('w-full');
  });

  it('creates a CodeMirror editor on mount', async () => {
    const { EditorState } = await import('@codemirror/state');
    const { default: CodeMirrorEditor } = await import('../CodeMirrorEditor');
    render(() => <CodeMirrorEditor content="test content" />);
    expect(EditorState.create).toHaveBeenCalled();
  });

  it('passes language extension when language prop provided', async () => {
    const { getLanguageExtension } = await import('../../lib/codemirrorLanguages');
    const mockExt = {};
    (getLanguageExtension as ReturnType<typeof vi.fn>).mockReturnValue(mockExt);

    const { default: CodeMirrorEditor } = await import('../CodeMirrorEditor');
    render(() => <CodeMirrorEditor content="x = 1" language="py" />);
    expect(getLanguageExtension).toHaveBeenCalledWith('py');
  });

  it('mounts cm-editor element in container', async () => {
    const { default: CodeMirrorEditor } = await import('../CodeMirrorEditor');
    const { container } = render(() => (
      <CodeMirrorEditor content="hello" />
    ));
    const cmEditor = container.querySelector('.cm-editor');
    expect(cmEditor).toBeTruthy();
  });
});
