import EditorPanel from '../components/EditorPanel';
import TerminalPanel from '../components/TerminalPanel';
import NotesPanel from '../components/NotesPanel';
import ChatPanel from '../components/ChatPanel';
import TaskPanel from '../components/TaskPanel';
import IndexingStatus from '../components/IndexingStatus';
import SearchPanel from '../components/SearchPanel';

function WorkspaceLayout() {
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
        {/* Left sidebar: Notes + Tasks stacked */}
        <div class="row-span-2 border-r border-[var(--color-border)] flex flex-col min-h-0">
          <div class="flex-1 border-b border-[var(--color-border)] overflow-auto">
            <NotesPanel />
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
    </div>
  );
}

export default WorkspaceLayout;
