import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const bg = '#0f1117';
const bgSecondary = '#1a1d27';
const bgPanel = '#1e2130';
const border = '#2a2d3a';
const textPrimary = '#e1e4ed';
const textSecondary = '#8b8fa3';
const accent = '#6366f1';
const accentHover = '#818cf8';
const success = '#22c55e';
const error = '#ef4444';

// Tokyo Night-inspired syntax colors
const syntax = {
  keyword: '#bb9af7',
  string: '#9ece6a',
  number: '#ff9e64',
  comment: '#565f89',
  function: '#7aa2f7',
  variable: '#c0caf5',
  type: '#2ac3de',
  operator: '#89ddff',
  punctuation: '#9abdf5',
  constant: '#ff9e64',
  property: '#73daca',
  tag: '#f7768e',
  attribute: '#bb9af7',
  regexp: '#b4f9f8',
};

export const cortexTheme = EditorView.theme(
  {
    '&': {
      color: textPrimary,
      backgroundColor: bg,
      fontSize: '13px',
      fontFamily:
        "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
    },
    '.cm-content': {
      caretColor: accent,
      padding: '4px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: accent,
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: '#28294a',
      },
    '.cm-panels': {
      backgroundColor: bgPanel,
      color: textPrimary,
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: `1px solid ${border}`,
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: `1px solid ${border}`,
    },
    '.cm-searchMatch': {
      backgroundColor: '#3d59a133',
      outline: `1px solid ${accent}44`,
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: `${accent}33`,
    },
    '.cm-activeLine': {
      backgroundColor: '#1a1d2766',
    },
    '.cm-selectionMatch': {
      backgroundColor: '#3d59a133',
    },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: '#3d59a144',
      outline: `1px solid ${accent}66`,
    },
    '.cm-gutters': {
      backgroundColor: bg,
      color: textSecondary,
      border: 'none',
      borderRight: `1px solid ${border}`,
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#1a1d2766',
      color: textPrimary,
    },
    '.cm-foldPlaceholder': {
      backgroundColor: bgSecondary,
      border: `1px solid ${border}`,
      color: textSecondary,
    },
    '.cm-tooltip': {
      border: `1px solid ${border}`,
      backgroundColor: bgPanel,
      color: textPrimary,
    },
    '.cm-tooltip .cm-tooltip-arrow:before': {
      borderTopColor: border,
      borderBottomColor: border,
    },
    '.cm-tooltip .cm-tooltip-arrow:after': {
      borderTopColor: bgPanel,
      borderBottomColor: bgPanel,
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': {
        backgroundColor: `${accent}33`,
        color: textPrimary,
      },
    },
    // ─── Autocomplete ─────────────────────────────────────────
    '.cm-completionDetail': {
      fontStyle: 'italic',
      color: textSecondary,
      marginLeft: '0.5em',
    },
    '.cm-completionMatchedText': {
      color: accent,
      textDecoration: 'none',
      fontWeight: 'bold',
    },
    // ─── Lint / Diagnostics ──────────────────────────────────
    '.cm-lintRange-error': {
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='m0 3 l2 -2 l1 0 l2 2 l1 0' stroke='%23ef4444' fill='none' stroke-width='.7'/%3E%3C/svg%3E")`,
    },
    '.cm-lintRange-warning': {
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='m0 3 l2 -2 l1 0 l2 2 l1 0' stroke='%23f59e0b' fill='none' stroke-width='.7'/%3E%3C/svg%3E")`,
    },
    '.cm-lintRange-info': {
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='m0 3 l2 -2 l1 0 l2 2 l1 0' stroke='%236366f1' fill='none' stroke-width='.7'/%3E%3C/svg%3E")`,
    },
    '.cm-lint-marker-error': {
      content: '"●"',
      color: error,
    },
    '.cm-lint-marker-warning': {
      content: '"●"',
      color: '#f59e0b',
    },
    '.cm-tooltip-lint': {
      backgroundColor: bgPanel,
      border: `1px solid ${border}`,
      borderRadius: '4px',
      padding: '4px 8px',
    },
    '.cm-diagnostic': {
      padding: '3px 6px 3px 8px',
      marginLeft: '-1px',
    },
    '.cm-diagnostic-error': {
      borderLeft: `3px solid ${error}`,
    },
    '.cm-diagnostic-warning': {
      borderLeft: '3px solid #f59e0b',
    },
    '.cm-diagnostic-info': {
      borderLeft: `3px solid ${accent}`,
    },
  },
  { dark: true },
);

export const cortexHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: syntax.keyword },
    { tag: tags.controlKeyword, color: syntax.keyword },
    { tag: tags.operatorKeyword, color: syntax.keyword },
    { tag: tags.definitionKeyword, color: syntax.keyword },
    { tag: tags.moduleKeyword, color: syntax.keyword },

    { tag: tags.string, color: syntax.string },
    { tag: tags.special(tags.string), color: syntax.regexp },

    { tag: tags.number, color: syntax.number },
    { tag: tags.integer, color: syntax.number },
    { tag: tags.float, color: syntax.number },
    { tag: tags.bool, color: syntax.constant },

    { tag: tags.comment, color: syntax.comment, fontStyle: 'italic' },
    { tag: tags.lineComment, color: syntax.comment, fontStyle: 'italic' },
    { tag: tags.blockComment, color: syntax.comment, fontStyle: 'italic' },
    { tag: tags.docComment, color: syntax.comment, fontStyle: 'italic' },

    { tag: tags.function(tags.variableName), color: syntax.function },
    { tag: tags.function(tags.definition(tags.variableName)), color: syntax.function },
    { tag: tags.definition(tags.function(tags.variableName)), color: syntax.function },

    { tag: tags.variableName, color: syntax.variable },
    { tag: tags.definition(tags.variableName), color: syntax.variable },
    { tag: tags.local(tags.variableName), color: syntax.variable },

    { tag: tags.typeName, color: syntax.type },
    { tag: tags.className, color: syntax.type },
    { tag: tags.namespace, color: syntax.type },

    { tag: tags.operator, color: syntax.operator },
    { tag: tags.punctuation, color: syntax.punctuation },
    { tag: tags.bracket, color: syntax.punctuation },
    { tag: tags.angleBracket, color: syntax.punctuation },
    { tag: tags.squareBracket, color: syntax.punctuation },
    { tag: tags.paren, color: syntax.punctuation },
    { tag: tags.brace, color: syntax.punctuation },
    { tag: tags.separator, color: syntax.punctuation },
    { tag: tags.derefOperator, color: syntax.operator },

    { tag: tags.propertyName, color: syntax.property },
    { tag: tags.definition(tags.propertyName), color: syntax.property },

    { tag: tags.tagName, color: syntax.tag },
    { tag: tags.attributeName, color: syntax.attribute },
    { tag: tags.attributeValue, color: syntax.string },

    { tag: tags.regexp, color: syntax.regexp },

    { tag: tags.meta, color: syntax.comment },
    { tag: tags.self, color: syntax.keyword },
    { tag: tags.atom, color: syntax.constant },

    { tag: tags.invalid, color: error },
    { tag: tags.heading, color: syntax.function, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.link, color: accent, textDecoration: 'underline' },
    { tag: tags.url, color: accent },
  ]),
);

export const cortexThemeExtension = [cortexTheme, cortexHighlightStyle];
