import { createSignal, For, Show } from 'solid-js';
import { semanticSearch, type SearchResult } from '../lib/tauri';

function SearchPanel() {
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [hasSearched, setHasSearched] = createSignal(false);

  const handleSearch = async (e: Event) => {
    e.preventDefault();
    const q = query().trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const response = await semanticSearch(q);
      setResults(response.results);
    } catch (err) {
      setError(String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="flex flex-col h-full">
      <form onSubmit={handleSearch} class="p-3 border-b border-[var(--color-border)]">
        <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-2">
          Semantic Search
        </div>
        <div class="flex gap-2">
          <input
            type="text"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search your codebase..."
            class="flex-1 px-2 py-1.5 text-xs rounded bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={loading() || !query().trim()}
            class="px-3 py-1.5 text-xs font-medium rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
          >
            {loading() ? '...' : 'Search'}
          </button>
        </div>
      </form>

      <div class="flex-1 overflow-auto p-3">
        <Show when={error()}>
          <div class="text-xs text-[var(--color-error)] mb-2">
            Search error: {error()}
          </div>
        </Show>

        <Show when={hasSearched() && !loading() && results().length === 0 && !error()}>
          <div class="text-xs text-[var(--color-text-secondary)] text-center py-4">
            No results found
          </div>
        </Show>

        <Show when={!hasSearched()}>
          <div class="text-xs text-[var(--color-text-secondary)] text-center py-4">
            Search your indexed files using natural language
          </div>
        </Show>

        <For each={results()}>
          {(result) => (
            <div class="mb-3 p-2 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border)]">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs font-medium text-[var(--color-accent)]">
                  {result.source_file}
                </span>
                <span class="text-xs text-[var(--color-text-secondary)]">
                  chunk {result.chunk_index}
                </span>
              </div>
              <div class="text-xs text-[var(--color-text-primary)] line-clamp-3">
                {result.text}
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export default SearchPanel;
