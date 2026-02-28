import { describe, it, expect, vi } from 'vitest';

// Mock all language modules to avoid jsdom issues
vi.mock('@codemirror/lang-python', () => ({
  python: vi.fn(() => 'python-ext'),
}));
vi.mock('@codemirror/lang-javascript', () => ({
  javascript: vi.fn(() => 'javascript-ext'),
}));
vi.mock('@codemirror/lang-rust', () => ({
  rust: vi.fn(() => 'rust-ext'),
}));
vi.mock('@codemirror/lang-json', () => ({
  json: vi.fn(() => 'json-ext'),
}));
vi.mock('@codemirror/lang-markdown', () => ({
  markdown: vi.fn(() => 'markdown-ext'),
}));
vi.mock('@codemirror/lang-html', () => ({
  html: vi.fn(() => 'html-ext'),
}));
vi.mock('@codemirror/lang-css', () => ({
  css: vi.fn(() => 'css-ext'),
}));

describe('codemirrorLanguages', () => {
  describe('getLanguageExtension', () => {
    it('returns python extension for py', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension('py');
      expect(result).toBeTruthy();
    });

    it('returns python extension for python', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension('python');
      expect(result).toBeTruthy();
    });

    it('returns javascript extension for ts', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension('ts');
      expect(result).toBeTruthy();
    });

    it('returns javascript extension for tsx with jsx and typescript', async () => {
      const { javascript } = await import('@codemirror/lang-javascript');
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      getLanguageExtension('tsx');
      expect(javascript).toHaveBeenCalledWith({ jsx: true, typescript: true });
    });

    it('returns rust extension for rs', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension('rs');
      expect(result).toBeTruthy();
    });

    it('returns json extension', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension('json');
      expect(result).toBeTruthy();
    });

    it('returns markdown extension for md', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension('md');
      expect(result).toBeTruthy();
    });

    it('returns html extension', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension('html');
      expect(result).toBeTruthy();
    });

    it('returns css extension', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension('css');
      expect(result).toBeTruthy();
    });

    it('returns null for unknown extension', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension('xyz');
      expect(result).toBeNull();
    });

    it('returns null for undefined', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension(undefined);
      expect(result).toBeNull();
    });

    it('handles leading dot in extension', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension('.py');
      expect(result).toBeTruthy();
    });

    it('is case insensitive', async () => {
      const { getLanguageExtension } = await import('../codemirrorLanguages');
      const result = getLanguageExtension('PY');
      expect(result).toBeTruthy();
    });
  });

  describe('getLanguageFromPath', () => {
    it('extracts extension from file path', async () => {
      const { getLanguageFromPath } = await import('../codemirrorLanguages');
      expect(getLanguageFromPath('/src/main.rs')).toBe('rs');
    });

    it('extracts extension from nested path', async () => {
      const { getLanguageFromPath } = await import('../codemirrorLanguages');
      expect(getLanguageFromPath('/a/b/c/test.py')).toBe('py');
    });

    it('returns undefined for files without extension', async () => {
      const { getLanguageFromPath } = await import('../codemirrorLanguages');
      expect(getLanguageFromPath('/src/Makefile')).toBeUndefined();
    });

    it('handles tsx extension', async () => {
      const { getLanguageFromPath } = await import('../codemirrorLanguages');
      expect(getLanguageFromPath('Component.tsx')).toBe('tsx');
    });
  });
});
