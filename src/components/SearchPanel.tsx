import { createSignal, For, Show } from 'solid-js';
import {
  semanticSearch,
  submitRetrievalFeedback,
  type SearchResult,
  type SearchFilters,
} from '../lib/tauri';
import { entitySearch, type EntitySearchResult } from '../lib/entitySearch';
import { noteStore } from '../lib/noteStoreInstance';

type SearchScope = 'code' | 'entities';
type FeedbackState = 'idle' | 'submitting' | 'positive' | 'negative' | 'error';
type RelevanceLabel = 'relevant' | 'not_relevant';

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

const ENTITY_TYPE_COLORS: Record<string, string> = {
  note: '#6366f1',
  task: '#22c55e',
  function: '#dea584',
  class: '#3572A5',
};

function SearchPanel() {
  const [query, setQuery] = createSignal('');
  const [lastSearchedQuery, setLastSearchedQuery] = createSignal('');
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [entityResults, setEntityResults] = createSignal<EntitySearchResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [hasSearched, setHasSearched] = createSignal(false);
  const [languageFilter, setLanguageFilter] = createSignal('');
  const [sourceTypeFilter, setSourceTypeFilter] = createSignal('');
  const [scope, setScope] = createSignal<SearchScope>('code');
  const [searchTraceId, setSearchTraceId] = createSignal<string | null>(null);
  const [feedbackStateByResult, setFeedbackStateByResult] = createSignal<Record<string, FeedbackState>>({});

  const generateTraceId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `search-${crypto.randomUUID()}`;
    }
    return `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const resultId = (result: SearchResult) => {
    const entity = result.entity_name ?? 'chunk';
    return `${result.source_file}:${result.chunk_index}:${entity}`;
  };

  const handleSearch = async (e: Event) => {
    e.preventDefault();
    const q = query().trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      if (scope() === 'code') {
        const traceId = generateTraceId();
        const filters: SearchFilters = {};
        if (languageFilter()) filters.language = languageFilter();
        if (sourceTypeFilter()) filters.source_type = sourceTypeFilter();
        const response = await semanticSearch(q, 10, filters);
        setSearchTraceId(traceId);
        setLastSearchedQuery(q);
        setFeedbackStateByResult({});
        setResults(response.results);
        setEntityResults([]);
      } else {
        const results = await entitySearch(q, undefined, 20);
        setSearchTraceId(null);
        setEntityResults(results);
        setResults([]);
      }
    } catch (err) {
      setError(String(err));
      setResults([]);
      setEntityResults([]);
    } finally {
      setLoading(false);
    }
  };

  const submitFeedback = async (result: SearchResult, relevanceLabel: RelevanceLabel) => {
    const id = resultId(result);
    setFeedbackStateByResult((prev) => ({ ...prev, [id]: 'submitting' }));
    try {
      await submitRetrievalFeedback({
        query: lastSearchedQuery() || query().trim(),
        selectedResultId: id,
        selectedResultType: result.source_type,
        relevanceLabel,
        traceId: searchTraceId() ?? undefined,
        metadataJson: JSON.stringify({
          language_filter: languageFilter() || null,
          source_type_filter: sourceTypeFilter() || null,
          source_file: result.source_file,
          chunk_index: result.chunk_index,
          chunk_type: result.chunk_type,
          relevance_score: result.relevance_score,
        }),
      });
      setFeedbackStateByResult((prev) => ({
        ...prev,
        [id]: relevanceLabel === 'relevant' ? 'positive' : 'negative',
      }));
    } catch (_err) {
      setFeedbackStateByResult((prev) => ({ ...prev, [id]: 'error' }));
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

  function handleEntityClick(result: EntitySearchResult) {
    if (result.entity_type === 'note') {
      noteStore.selectNote(result.id);
    }
  }

  function truncateContent(content: string | null, maxLen: number = 120): string {
    if (!content) return '';
    return content.length > maxLen ? content.slice(0, maxLen) + '...' : content;
  }

  const totalResults = () => results().length + entityResults().length;

  return (
    <div class="flex flex-col h-full">
      <form onSubmit={handleSearch} class="p-3 border-b border-[var(--color-border)]">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Search
          </div>
        </div>

        {/* Scope toggle */}
        <div class="flex gap-1 mb-2">
          <button
            type="button"
            onClick={() => setScope('code')}
            class={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${
              scope() === 'code'
                ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]'
            }`}
            data-scope="code"
          >
            Code
          </button>
          <button
            type="button"
            onClick={() => setScope('entities')}
            class={`px-2.5 py-1 text-[10px] rounded-full border transition-colors ${
              scope() === 'entities'
                ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]'
            }`}
            data-scope="entities"
          >
            Notes & Tasks
          </button>
        </div>

        <div class="flex gap-2 mb-2">
          <input
            type="text"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder={scope() === 'code' ? 'Search your codebase...' : 'Search notes & tasks...'}
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

        {/* Code-scope filters */}
        <Show when={scope() === 'code'}>
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
        </Show>
      </form>

      <div class="flex-1 overflow-auto p-3">
        <Show when={error()}>
          <div class="text-xs text-[var(--color-error)] mb-2">
            Search error: {error()}
          </div>
        </Show>

        <Show when={hasSearched() && !loading() && totalResults() === 0 && !error()}>
          <div class="text-xs text-[var(--color-text-secondary)] text-center py-4">
            No results found
          </div>
        </Show>

        <Show when={!hasSearched()}>
          <div class="text-xs text-[var(--color-text-secondary)] text-center py-4">
            {scope() === 'code'
              ? 'Search your indexed files using natural language'
              : 'Search your notes and tasks by keyword'}
          </div>
        </Show>

        {/* Code search results */}
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
              <div class="mt-2 flex items-center justify-between">
                <span class="text-[10px] text-[var(--color-text-secondary)]">Was this result useful?</span>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="px-2 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-success)] hover:text-[var(--color-success)] disabled:opacity-50"
                    onClick={() => submitFeedback(result, 'relevant')}
                    disabled={feedbackStateByResult()[resultId(result)] === 'submitting'}
                  >
                    Helpful
                  </button>
                  <button
                    type="button"
                    class="px-2 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-error)] hover:text-[var(--color-error)] disabled:opacity-50"
                    onClick={() => submitFeedback(result, 'not_relevant')}
                    disabled={feedbackStateByResult()[resultId(result)] === 'submitting'}
                  >
                    Not Helpful
                  </button>
                </div>
              </div>
              <Show when={feedbackStateByResult()[resultId(result)] === 'positive'}>
                <div class="mt-1 text-[10px] text-[var(--color-success)]">Feedback saved.</div>
              </Show>
              <Show when={feedbackStateByResult()[resultId(result)] === 'negative'}>
                <div class="mt-1 text-[10px] text-[var(--color-text-secondary)]">Feedback saved.</div>
              </Show>
              <Show when={feedbackStateByResult()[resultId(result)] === 'error'}>
                <div class="mt-1 text-[10px] text-[var(--color-error)]">Feedback failed. Try again.</div>
              </Show>
            </div>
          )}
        </For>

        {/* Entity search results */}
        <For each={entityResults()}>
          {(result) => (
            <div
              class="mb-3 p-2 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border)] cursor-pointer hover:border-[var(--color-accent)] transition-colors"
              onClick={() => handleEntityClick(result)}
            >
              <div class="flex items-center gap-2 mb-1">
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{
                    color: ENTITY_TYPE_COLORS[result.entity_type] || 'var(--color-text-secondary)',
                    border: `1px solid ${ENTITY_TYPE_COLORS[result.entity_type] || 'var(--color-text-secondary)'}`,
                  }}
                >
                  {result.entity_type}
                </span>
                <span class="text-xs font-medium text-[var(--color-text-primary)]">
                  {result.title}
                </span>
                <Show when={result.source_file}>
                  <span class="text-[10px] text-[var(--color-text-secondary)] ml-auto truncate max-w-[120px]">
                    {result.source_file}
                  </span>
                </Show>
              </div>
              <Show when={result.content}>
                <div class="text-xs text-[var(--color-text-secondary)] line-clamp-2">
                  {truncateContent(result.content)}
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export default SearchPanel;
