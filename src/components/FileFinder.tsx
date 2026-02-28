import { createSignal, createMemo, onMount, onCleanup, For, Show } from 'solid-js';
import { getWorkspaceRoot, fileListAll, type FileEntry } from '../lib/files';
import { fuzzyFilter, type FuzzyResult } from '../lib/fuzzyMatch';

interface FileFinderProps {
  onSelect: (path: string) => void;
  onClose: () => void;
}

function FileFinder(props: FileFinderProps) {
  const [query, setQuery] = createSignal('');
  const [files, setFiles] = createSignal<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  onMount(async () => {
    inputRef?.focus();
    try {
      const root = await getWorkspaceRoot();
      const allFiles = await fileListAll(root);
      setFiles(allFiles);
    } catch {
      // Could not load file list
    }
  });

  const candidates = createMemo(() => files().map((f) => f.relative_path));

  const results = createMemo((): FuzzyResult[] => {
    const q = query().trim();
    if (!q) {
      return candidates()
        .slice(0, 50)
        .map((c) => ({ text: c, score: 0, matches: [] }));
    }
    return fuzzyFilter(q, candidates());
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results().length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = results()[selectedIndex()];
      if (result) {
        const file = files().find((f) => f.relative_path === result.text);
        if (file) {
          props.onSelect(file.path);
        }
      }
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  }

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-50"
      onClick={handleBackdropClick}
      data-testid="file-finder-overlay"
    >
      <div class="w-[500px] max-h-[400px] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <input
          ref={inputRef}
          type="text"
          class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border-b border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none font-mono"
          placeholder="Search files..."
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          data-testid="file-finder-input"
        />
        <div class="flex-1 overflow-auto">
          <For each={results()}>
            {(result, index) => (
              <button
                class={`w-full text-left px-3 py-1.5 text-xs font-mono ${
                  index() === selectedIndex()
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-panel)]'
                }`}
                onClick={() => {
                  const file = files().find(
                    (f) => f.relative_path === result.text,
                  );
                  if (file) {
                    props.onSelect(file.path);
                  }
                }}
                onMouseEnter={() => setSelectedIndex(index())}
                data-testid={`file-finder-result-${index()}`}
              >
                <HighlightedText
                  text={result.text}
                  matches={result.matches}
                  isSelected={index() === selectedIndex()}
                />
              </button>
            )}
          </For>
          <Show when={results().length === 0 && query().trim()}>
            <div class="px-3 py-4 text-xs text-[var(--color-text-secondary)] text-center">
              No files found
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

function HighlightedText(props: {
  text: string;
  matches: number[];
  isSelected: boolean;
}) {
  const segments = createMemo(() => {
    const result: { char: string; highlight: boolean }[] = [];
    const matchSet = new Set(props.matches);
    for (let i = 0; i < props.text.length; i++) {
      result.push({ char: props.text[i], highlight: matchSet.has(i) });
    }
    return result;
  });

  return (
    <span>
      <For each={segments()}>
        {(seg) => (
          <span
            class={
              seg.highlight
                ? props.isSelected
                  ? 'font-bold text-white'
                  : 'font-bold text-[var(--color-accent)]'
                : ''
            }
          >
            {seg.char}
          </span>
        )}
      </For>
    </span>
  );
}

export default FileFinder;
