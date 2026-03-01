import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import EditorPanel, { editorStore, handleOpenFile } from '../components/EditorPanel';
import TerminalPanel from '../components/TerminalPanel';
import FileTree from '../components/FileTree';
import ChatPanel from '../components/ChatPanel';
import TaskPanel from '../components/TaskPanel';
import IndexingStatus from '../components/IndexingStatus';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import SearchPanel from '../components/SearchPanel';
import FileFinder from '../components/FileFinder';
import UniversalSearch from '../components/UniversalSearch';
import KnowledgeGraph from '../components/KnowledgeGraph';
import { noteStore } from '../lib/noteStoreInstance';
import { taskStore } from '../lib/taskStoreInstance';
import type { UniversalSearchResult } from '../lib/universalSearch';

function WorkspaceLayout() {
  const [showFileFinder, setShowFileFinder] = createSignal(false);
  const [showUniversalSearch, setShowUniversalSearch] = createSignal(false);
  const [showKnowledgeGraph, setShowKnowledgeGraph] = createSignal(false);

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
    if (meta && e.key === 'g') {
      e.preventDefault();
      setShowKnowledgeGraph((prev) => !prev);
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
    } else if (result.result_type === 'action') {
      const metadata = result.metadata as any;
      if (metadata?.type === 'create-task') {
        taskStore.createTask(metadata.query, '', 'medium');
      }
    } else if (result.source_file) {
      handleOpenFile(result.source_file);
    }
  }

  function handleUniversalSearchSecondarySelect(result: UniversalSearchResult) {
    if (result.source_file) {
      handleOpenFile(result.source_file);
    }
  }

  return (
    <div class="h-full w-full flex flex-col">
      {/* Top bar */}
      <header class="h-10 flex items-center px-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0 gap-4">
        <span class="font-semibold text-sm mr-2">Cortex</span>
        <WorkspaceSwitcher />
        <button
          onClick={() => setShowKnowledgeGraph(true)}
          class="flex items-center space-x-1.5 px-2 py-1 rounded hover:bg-[var(--color-bg-panel)] border border-[var(--color-border)] transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          title="Open Knowledge Graph (Cmd+G)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          <span class="text-[10px] font-bold uppercase tracking-tight">Graph</span>
        </button>
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
          onSecondarySelect={handleUniversalSearchSecondarySelect}
          onClose={() => setShowUniversalSearch(false)}
        />
      </Show>

      {/* Knowledge Graph overlay */}
      <Show when={showKnowledgeGraph()}>
        <KnowledgeGraph
          onClose={() => setShowKnowledgeGraph(false)}
        />
      </Show>
    </div>
  );
}

export default WorkspaceLayout;
