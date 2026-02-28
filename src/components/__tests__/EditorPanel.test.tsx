import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';

vi.mock('../../lib/codemirrorLanguages', () => ({
  getLanguageFromPath: vi.fn((path: string) => {
    const dot = path.lastIndexOf('.');
    if (dot === -1) return undefined;
    return path.slice(dot + 1).toLowerCase();
  }),
  getLanguageExtension: vi.fn(() => null),
}));

vi.mock('../../lib/codemirrorTheme', () => ({
  cortexThemeExtension: [],
}));

vi.mock('../CodeMirrorEditor', () => ({
  default: (props: { content: string }) => (
    <div data-testid="mock-editor">{props.content}</div>
  ),
}));

const mockGetLinksForFile = vi.fn();
vi.mock('../../lib/editorLinks', () => ({
  getLinksForFile: (...args: unknown[]) => mockGetLinksForFile(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetLinksForFile.mockResolvedValue([]);
});

describe('EditorPanel', () => {
  it('shows welcome view when no tabs are open', async () => {
    const { default: EditorPanel } = await import('../EditorPanel');
    render(() => <EditorPanel />);

    expect(screen.getByText('Cortex Editor')).toBeInTheDocument();
    expect(screen.getByText('Open a file to start editing')).toBeInTheDocument();
  });

  it('shows tab bar after opening a file', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'print("hello")',
      size: 14,
      extension: 'py',
      path: '/project/main.py',
    });

    const { default: EditorPanel, handleOpenFile } = await import('../EditorPanel');
    render(() => <EditorPanel />);

    await handleOpenFile('/project/main.py');

    await vi.waitFor(() => {
      expect(screen.getByTestId('editor-tab-0')).toBeInTheDocument();
    });

    expect(screen.getByTestId('editor-tab-0').textContent).toContain('main.py');
  });

  it('shows dirty indicator when content changes', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'original',
      size: 8,
      extension: 'txt',
      path: '/project/test.txt',
    });

    const { default: EditorPanel, handleOpenFile, editorStore } = await import('../EditorPanel');
    render(() => <EditorPanel />);

    await handleOpenFile('/project/test.txt');

    await vi.waitFor(() => {
      expect(screen.getByTestId('editor-tab-0')).toBeInTheDocument();
    });

    editorStore.updateContent('modified');

    await vi.waitFor(() => {
      expect(screen.getByTestId('editor-tab-0').textContent).toContain('*');
    });
  });

  it('switches tabs on click', async () => {
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        content: 'first',
        size: 5,
        extension: 'txt',
        path: '/project/a.txt',
      })
      .mockResolvedValueOnce({
        content: 'second',
        size: 6,
        extension: 'py',
        path: '/project/b.py',
      });

    const { default: EditorPanel, handleOpenFile, editorStore } = await import('../EditorPanel');
    render(() => <EditorPanel />);

    await handleOpenFile('/project/a.txt');
    await handleOpenFile('/project/b.py');

    await vi.waitFor(() => {
      expect(screen.getByTestId('editor-tab-0')).toBeInTheDocument();
      expect(screen.getByTestId('editor-tab-1')).toBeInTheDocument();
    });

    expect(editorStore.state.activeTabIndex).toBe(1);

    fireEvent.click(screen.getByTestId('editor-tab-0'));
    expect(editorStore.state.activeTabIndex).toBe(0);
  });

  it('closes tab via close button', async () => {
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        content: 'first',
        size: 5,
        extension: 'txt',
        path: '/project/a.txt',
      })
      .mockResolvedValueOnce({
        content: 'second',
        size: 6,
        extension: 'py',
        path: '/project/b.py',
      });

    const { default: EditorPanel, handleOpenFile, editorStore } = await import('../EditorPanel');
    render(() => <EditorPanel />);

    await handleOpenFile('/project/a.txt');
    await handleOpenFile('/project/b.py');

    await vi.waitFor(() => {
      expect(screen.getByTestId('editor-tab-close-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('editor-tab-close-1'));

    expect(editorStore.state.tabs.length).toBe(1);
    expect(editorStore.getActiveFile()!.path).toBe('/project/a.txt');
  });

  it('shows related links badge when file has links', async () => {
    const mockLinks = [
      {
        link_id: 'l1',
        linked_entity_id: 'n1',
        linked_entity_title: 'Architecture Notes',
        linked_entity_type: 'note',
        linked_source_file: null,
        relationship_type: 'references',
        confidence: 0.95,
        auto_generated: true,
        direction: 'incoming',
      },
      {
        link_id: 'l2',
        linked_entity_id: 'n2',
        linked_entity_title: 'Design Doc',
        linked_entity_type: 'note',
        linked_source_file: null,
        relationship_type: 'references',
        confidence: 0.88,
        auto_generated: true,
        direction: 'incoming',
      },
    ];
    mockGetLinksForFile.mockResolvedValue(mockLinks);

    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'fn main() {}',
      size: 12,
      extension: 'rs',
      path: '/project/src/main.rs',
    });

    const { default: EditorPanel, handleOpenFile } = await import('../EditorPanel');
    render(() => <EditorPanel />);

    await handleOpenFile('/project/src/main.rs');

    await vi.waitFor(() => {
      expect(screen.getByTestId('related-links-badge')).toBeInTheDocument();
    });

    expect(screen.getByTestId('related-links-badge').textContent).toContain('2 links');
  });
});
