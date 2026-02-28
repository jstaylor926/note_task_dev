import { createSignal, onMount, For, Show } from 'solid-js';
import { universalSearch, type UniversalSearchResult, type UniversalSearchResponse } from '../lib/universalSearch';

interface UniversalSearchProps {
  onSelect: (result: UniversalSearchResult) => void;
  onClose: () => void;
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  code: '#64748b',
  note: '#6366f1',
  task: '#22c55e',
  function: '#dea584',
  class: '#3572A5',
  struct: '#8b5cf6',
};

function UniversalSearch(props: UniversalSearchProps) {
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<UniversalSearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [hasSearched, setHasSearched] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    inputRef?.focus();
  });

  function handleInput(value: string) {
    setQuery(value);
    setSelectedIndex(0);

    if (debounceTimer) clearTimeout(debounceTimer);

    const q = value.trim();
    if (!q) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const response: UniversalSearchResponse = await universalSearch(q, 20);
        setResults(response.results);
        setHasSearched(true);
      } catch {
        setResults([]);
        setHasSearched(true);
      }
    }, 250);
  }

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
        props.onSelect(result);
      }
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  }

  function truncateSnippet(snippet: string | null, maxLen: number = 120): string {
    if (!snippet) return '';
    return snippet.length > maxLen ? snippet.slice(0, maxLen) + '...' : snippet;
  }

  function formatScore(score: number): string {
    return `${Math.round(score * 100)}%`;
  }

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-50"
      onClick={handleBackdropClick}
      data-testid="universal-search-overlay"
    >
      <div class="w-[600px] max-h-[500px] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <input
          ref={inputRef}
          type="text"
          class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border-b border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none"
          placeholder="Search everything..."
          value={query()}
          onInput={(e) => handleInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          data-testid="universal-search-input"
        />
        <div class="flex-1 overflow-auto">
          <For each={results()}>
            {(result, index) => (
              <button
                class={`w-full text-left px-3 py-2 flex items-center gap-2 ${
                  index() === selectedIndex()
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-panel)]'
                }`}
                onClick={() => props.onSelect(result)}
                onMouseEnter={() => setSelectedIndex(index())}
                data-testid={`universal-result-${index()}`}
              >
                {/* Type badge */}
                <span
                  class="text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
                  style={{
                    color: index() === selectedIndex() ? 'white' : (TYPE_BADGE_COLORS[result.result_type] || '#64748b'),
                    border: `1px solid ${index() === selectedIndex() ? 'rgba(255,255,255,0.5)' : (TYPE_BADGE_COLORS[result.result_type] || '#64748b')}`,
                  }}
                >
                  {result.result_type}
                </span>

                {/* Title and snippet */}
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-medium truncate">{result.title}</div>
                  <Show when={result.snippet}>
                    <div class={`text-[10px] truncate ${
                      index() === selectedIndex() ? 'text-white/70' : 'text-[var(--color-text-secondary)]'
                    }`}>
                      {truncateSnippet(result.snippet)}
                    </div>
                  </Show>
                </div>

                {/* Source file */}
                <Show when={result.source_file}>
                  <span class={`text-[9px] flex-shrink-0 max-w-[150px] truncate ${
                    index() === selectedIndex() ? 'text-white/60' : 'text-[var(--color-text-secondary)]'
                  }`}>
                    {result.source_file}
                  </span>
                </Show>

                {/* Score */}
                <span class={`text-[9px] flex-shrink-0 ${
                  index() === selectedIndex() ? 'text-white/60' : 'text-[var(--color-text-secondary)]'
                }`}>
                  {formatScore(result.relevance_score)}
                </span>
              </button>
            )}
          </For>

          <Show when={!hasSearched() && results().length === 0}>
            <div class="px-3 py-8 text-xs text-[var(--color-text-secondary)] text-center">
              Type to search code, notes, and tasks
            </div>
          </Show>

          <Show when={hasSearched() && results().length === 0}>
            <div class="px-3 py-8 text-xs text-[var(--color-text-secondary)] text-center">
              No results found
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

export default UniversalSearch;
