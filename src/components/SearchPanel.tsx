import { createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { semanticSearch, type SearchResult, type SearchFilters } from '../lib/tauri';

const LANGUAGE_OPTIONS = [
  { value: '', label: 'All Languages' },
  { value: 'rust', label: 'Rust' },
  { value: 'python', label: 'Python' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'toml', label: 'TOML' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
];

const SOURCE_TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'code', label: 'Code' },
  { value: 'docs', label: 'Docs' },
  { value: 'config', label: 'Config' },
  { value: 'test', label: 'Test' },
];

function SearchPanel() {
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [hasSearched, setHasSearched] = createSignal(false);
  const [languageFilter, setLanguageFilter] = createSignal('');
  const [sourceTypeFilter, setSourceTypeFilter] = createSignal('');

  let inputRef: HTMLInputElement | undefined;

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      inputRef?.focus();
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  const handleSearch = async (e: Event) => {
    e.preventDefault();
    const q = query().trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const filters: SearchFilters = {};
      if (languageFilter()) filters.language = languageFilter();
      if (sourceTypeFilter()) filters.source_type = sourceTypeFilter();

      const response = await semanticSearch(q, 10, filters);
      setResults(response.results);
    } catch (err) {
      setError(String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const formatScore = (score: number) => {
    return `${Math.round(score * 100)}%`;
  };

  const getLanguageBadgeColor = (lang: string) => {
    const colors: Record<string, string> = {
      rust: '#dea584',
      python: '#3572A5',
      typescript: '#3178c6',
      javascript: '#f1e05a',
      markdown: '#083fa1',
    };
    return colors[lang] || 'var(--color-text-secondary)';
  };

  return (
    <div class="flex flex-col h-full">
      <form onSubmit={handleSearch} class="p-3 border-b border-[var(--color-border)]">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Semantic Search
          </div>
          <kbd class="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] bg-[var(--color-bg-primary)]">
            {navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'}+K
          </kbd>
        </div>
        <div class="flex gap-2 mb-2">
          <input
            ref={inputRef}
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
        <div class="flex gap-2">
          <select
            value={languageFilter()}
            onChange={(e) => setLanguageFilter(e.currentTarget.value)}
            class="text-xs px-1.5 py-1 rounded bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
          >
            <For each={LANGUAGE_OPTIONS}>
              {(opt) => <option value={opt.value}>{opt.label}</option>}
            </For>
          </select>
          <div class="flex gap-1">
            <For each={SOURCE_TYPE_OPTIONS}>
              {(opt) => (
                <button
                  type="button"
                  onClick={() => setSourceTypeFilter(sourceTypeFilter() === opt.value ? '' : opt.value)}
                  class={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                    sourceTypeFilter() === opt.value
                      ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]'
                  }`}
                >
                  {opt.label}
                </button>
              )}
            </For>
          </div>
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
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <span class="text-xs font-medium text-[var(--color-accent)]">
                  {result.source_file}
                </span>
                <Show when={result.entity_name}>
                  <span class="text-xs font-mono text-[var(--color-text-primary)]">
                    {result.entity_name}
                  </span>
                </Show>
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{
                    color: getLanguageBadgeColor(result.language),
                    border: `1px solid ${getLanguageBadgeColor(result.language)}`,
                  }}
                >
                  {result.language}
                </span>
                <Show when={result.chunk_type !== 'text'}>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)]">
                    {result.chunk_type}
                  </span>
                </Show>
                <span class="text-[10px] text-[var(--color-text-secondary)] ml-auto">
                  {formatScore(result.relevance_score)}
                </span>
              </div>
              <div class="text-xs text-[var(--color-text-primary)] line-clamp-3 font-mono">
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
