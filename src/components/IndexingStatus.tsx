import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { onIndexingProgress, type IndexingProgress } from '../lib/tauri';

function IndexingStatus() {
  const [progress, setProgress] = createSignal<IndexingProgress>({
    completed: 0,
    total: 0,
    current_file: null,
    is_idle: true,
  });

  onMount(async () => {
    const unlisten = await onIndexingProgress((payload) => {
      setProgress(payload);
    });

    onCleanup(() => {
      unlisten();
    });
  });

  const isActive = () => !progress().is_idle && progress().total > 0;

  const shortFileName = () => {
    const file = progress().current_file;
    if (!file) return '';
    const parts = file.split('/');
    return parts[parts.length - 1] || file;
  };

  return (
    <div class="flex items-center gap-2 text-xs">
      <Show
        when={isActive()}
        fallback={
          <div class="flex items-center gap-1.5 text-[var(--color-success)]">
            <div class="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
            <span>Indexed</span>
          </div>
        }
      >
        <div class="flex items-center gap-1.5 text-[var(--color-accent)]">
          <div class="w-3 h-3 border border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
          <span>
            Indexing {progress().completed}/{progress().total}
          </span>
          <Show when={shortFileName()}>
            <span class="text-[var(--color-text-secondary)] truncate max-w-[120px]">
              {shortFileName()}
            </span>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default IndexingStatus;
