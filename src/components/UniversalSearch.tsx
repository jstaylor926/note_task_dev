import { createSignal, onMount, For, Show } from 'solid-js';
import { universalSearch, type UniversalSearchResult, type UniversalSearchResponse } from '../lib/universalSearch';

interface UniversalSearchProps {
  onSelect: (result: UniversalSearchResult) => void;
  onSecondarySelect?: (result: UniversalSearchResult) => void;
  onClose: () => void;
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  code: '#64748b',
  note: '#6366f1',
  task: '#22c55e',
  function: '#dea584',
  class: '#3572A5',
  struct: '#8b5cf6',
  terminal: '#f59e0b',
};

function UniversalSearch(props: UniversalSearchProps) {
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<UniversalSearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [hasSearched, setHasSearched] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const quickActions = () => {
    const q = query().trim();
    if (!q) return [];
    return [
      {
        id: 'action-create-task',
        result_type: 'action',
        title: `Create task: ${q}`,
        snippet: 'Add a new task to your workspace',
        source_file: null,
        relevance_score: 1.0,
        metadata: { type: 'create-task', query: q }
      }
    ] as UniversalSearchResult[];
  };

  const allItems = () => [...results(), ...quickActions()];

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
    const items = allItems();
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = items[selectedIndex()];
      if (result) {
        if (e.metaKey || e.ctrlKey) {
          props.onSecondarySelect?.(result);
        } else {
          props.onSelect(result);
        }
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
          class="w-full px-4 py-3 bg-[var(--color-bg-primary)] border-b border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none"
          placeholder="Search everything or type an action..."
          value={query()}
          onInput={(e) => handleInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          data-testid="universal-search-input"
        />
        <div class="flex-1 overflow-auto py-1">
          <For each={allItems()}>
            {(result, index) => (
              <button
                class={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                  index() === selectedIndex()
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-panel)]'
                }`}
                onClick={() => props.onSelect(result)}
                onMouseEnter={() => setSelectedIndex(index())}
                data-testid={`universal-result-${index()}`}
              >
                {/* Type icon/badge */}
                <div 
                  class="w-8 h-8 rounded flex items-center justify-center shrink-0 text-[10px] font-bold uppercase tracking-tighter"
                  style={{
                    background: index() === selectedIndex() ? 'rgba(255,255,255,0.2)' : `${(TYPE_BADGE_COLORS[result.result_type] || '#64748b')}22`,
                    color: index() === selectedIndex() ? 'white' : (TYPE_BADGE_COLORS[result.result_type] || '#64748b'),
                    border: `1px solid ${index() === selectedIndex() ? 'rgba(255,255,255,0.3)' : `${(TYPE_BADGE_COLORS[result.result_type] || '#64748b')}44`}`
                  }}
                >
                  {result.result_type.slice(0, 3)}
                </div>

                {/* Title and snippet */}
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium truncate leading-tight">{result.title}</div>
                  <Show when={result.snippet}>
                    <div class={`text-[11px] truncate mt-0.5 ${
                      index() === selectedIndex() ? 'text-white/80' : 'text-[var(--color-text-secondary)]'
                    }`}>
                      {truncateSnippet(result.snippet)}
                    </div>
                  </Show>
                </div>

                {/* Metadata */}
                <div class="flex flex-col items-end gap-1 shrink-0">
                  <Show when={result.source_file}>
                    <span class={`text-[10px] max-w-[120px] truncate ${
                      index() === selectedIndex() ? 'text-white/70' : 'text-[var(--color-text-secondary)]'
                    }`}>
                      {result.source_file?.split('/').pop()}
                    </span>
                  </Show>
                  <Show when={result.result_type !== 'action'}>
                    <span class={`text-[9px] font-mono ${
                      index() === selectedIndex() ? 'text-white/60' : 'text-[var(--color-text-secondary)]'
                    }`}>
                      {formatScore(result.relevance_score)}
                    </span>
                  </Show>
                </div>
              </button>
            )}
          </For>

          <Show when={query().length === 0}>
            <div class="px-4 py-12 text-center">
              <div class="text-sm font-medium text-[var(--color-text-primary)] mb-1">Search Everything</div>
              <div class="text-xs text-[var(--color-text-secondary)]">Search through your code, notes, tasks and history.</div>
            </div>
          </Show>

          <Show when={query().length > 0 && results().length === 0 && hasSearched()}>
             <div class="px-4 py-8 text-xs text-[var(--color-text-secondary)] text-center">
              No results found for "{query()}". You can still use quick actions below.
            </div>
          </Show>
        </div>
        
        {/* Footer */}
        <div class="px-4 py-2 bg-[var(--color-bg-primary)] border-t border-[var(--color-border)] flex items-center justify-between text-[10px] text-[var(--color-text-secondary)]">
          <div class="flex gap-3">
            <span><kbd class="bg-[var(--color-bg-panel)] px-1 rounded">↑↓</kbd> Navigate</span>
            <span><kbd class="bg-[var(--color-bg-panel)] px-1 rounded">Enter</kbd> Open</span>
            <span><kbd class="bg-[var(--color-bg-panel)] px-1 rounded">Esc</kbd> Close</span>
          </div>
          <div class="font-medium">Universal Search</div>
        </div>
      </div>
    </div>
  );
}

export default UniversalSearch;
