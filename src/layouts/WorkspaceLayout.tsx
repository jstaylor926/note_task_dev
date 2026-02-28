import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import EditorPanel, { editorStore, handleOpenFile } from '../components/EditorPanel';
import TerminalPanel from '../components/TerminalPanel';
import FileTree from '../components/FileTree';
import ChatPanel from '../components/ChatPanel';
import TaskPanel from '../components/TaskPanel';
import IndexingStatus from '../components/IndexingStatus';
import SearchPanel from '../components/SearchPanel';
import FileFinder from '../components/FileFinder';
import UniversalSearch from '../components/UniversalSearch';
import { noteStore } from '../lib/noteStoreInstance';
import { taskStore } from '../lib/taskStoreInstance';
import type { UniversalSearchResult } from '../lib/universalSearch';

function WorkspaceLayout() {
  const [showFileFinder, setShowFileFinder] = createSignal(false);
  const [showUniversalSearch, setShowUniversalSearch] = createSignal(false);

  function handleGlobalKeyDown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === 'p') {
      e.preventDefault();
      setShowFileFinder((prev) => !prev);
    }
    if (meta && e.key === 'k') {
      e.preventDefault();
      setShowUniversalSearch((prev) => !prev);
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleGlobalKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', handleGlobalKeyDown);
  });

  function handleFileFinderSelect(path: string) {
    setShowFileFinder(false);
    handleOpenFile(path);
  }

  function handleUniversalSearchSelect(result: UniversalSearchResult) {
    setShowUniversalSearch(false);
    if (result.result_type === 'note') {
      noteStore.selectNote(result.id);
    } else if (result.result_type === 'task') {
      taskStore.setEditingTask(result.id);
    } else if (result.source_file) {
      handleOpenFile(result.source_file);
    }
  }

  return (
    <div class="h-full w-full flex flex-col">
      {/* Top bar */}
      <header class="h-10 flex items-center px-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        <span class="font-semibold text-sm">Cortex</span>
        <div class="ml-auto">
          <IndexingStatus />
        </div>
      </header>

      {/* Main content area */}
      <div class="flex-1 grid grid-cols-[260px_1fr_300px] grid-rows-[1fr_200px] min-h-0">
        {/* Left sidebar: FileTree + Tasks stacked */}
        <div class="row-span-2 border-r border-[var(--color-border)] flex flex-col min-h-0">
          <div class="flex-1 border-b border-[var(--color-border)] overflow-auto">
            <FileTree onFileSelect={handleOpenFile} />
          </div>
          <div class="h-[200px] shrink-0 overflow-auto">
            <TaskPanel />
          </div>
        </div>

        {/* Center top: Editor */}
        <div class="overflow-auto min-h-0">
          <EditorPanel />
        </div>

        {/* Right sidebar: Search + Chat */}
        <div class="row-span-2 border-l border-[var(--color-border)] flex flex-col min-h-0">
          <div class="flex-1 overflow-auto border-b border-[var(--color-border)]">
            <SearchPanel />
          </div>
          <div class="h-[200px] shrink-0 overflow-auto">
            <ChatPanel />
          </div>
        </div>

        {/* Center bottom: Terminal */}
        <div class="border-t border-[var(--color-border)] overflow-auto min-h-0">
          <TerminalPanel />
        </div>
      </div>

      {/* Fuzzy file finder overlay */}
      <Show when={showFileFinder()}>
        <FileFinder
          onSelect={handleFileFinderSelect}
          onClose={() => setShowFileFinder(false)}
        />
      </Show>

      {/* Universal search overlay */}
      <Show when={showUniversalSearch()}>
        <UniversalSearch
          onSelect={handleUniversalSearchSelect}
          onClose={() => setShowUniversalSearch(false)}
        />
      </Show>
    </div>
  );
}

export default WorkspaceLayout;
