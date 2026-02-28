import type { Extension } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

const extensionMap: Record<string, () => Extension> = {
  py: python,
  python: python,
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  rs: rust,
  rust: rust,
  json: json,
  md: markdown,
  markdown: markdown,
  html: html,
  htm: html,
  css: css,
};

export function getLanguageExtension(
  langOrExtension?: string,
): Extension | null {
  if (!langOrExtension) return null;
  const key = langOrExtension.toLowerCase().replace(/^\./, '');
  const factory = extensionMap[key];
  return factory ? factory() : null;
}

export function getLanguageFromPath(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return undefined;
  return filePath.slice(dot + 1).toLowerCase();
}
