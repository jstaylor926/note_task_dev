import { createSignal, For, Show, onMount } from 'solid-js';
import { taskStore, type TaskFilter } from '../lib/taskStoreInstance';

const FILTER_OPTIONS: { value: TaskFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
];

const STATUS_COLORS: Record<string, string> = {
  todo: 'var(--color-text-secondary)',
  in_progress: 'var(--color-accent)',
  done: 'var(--color-success)',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'var(--color-error)',
  medium: 'var(--color-accent)',
  low: 'var(--color-text-secondary)',
};

function TaskPanel() {
  const [isCreating, setIsCreating] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal('');
  let createInputRef: HTMLInputElement | undefined;

  onMount(() => {
    taskStore.loadTasks();
  });

  function handleCreate() {
    setIsCreating(true);
    setNewTitle('');
    setTimeout(() => createInputRef?.focus(), 0);
  }

  function submitCreate() {
    const title = newTitle().trim();
    if (title) {
      taskStore.createTask(title);
    }
    setIsCreating(false);
    setNewTitle('');
  }

  function handleCreateKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      submitCreate();
    } else if (e.key === 'Escape') {
      setIsCreating(false);
      setNewTitle('');
    }
  }

  function handleStatusClick(id: string, e: MouseEvent) {
    e.stopPropagation();
    taskStore.cycleStatus(id);
  }

  function handleDelete(id: string, e: MouseEvent) {
    e.stopPropagation();
    taskStore.deleteTask(id);
  }

  return (
    <div class="flex flex-col h-full bg-[var(--color-bg-secondary)]">
      {/* Header */}
      <div class="px-3 py-2 border-b border-[var(--color-border)]">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Tasks
          </div>
          <button
            onClick={handleCreate}
            class="px-2 py-1 text-[10px] font-medium rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            New
          </button>
        </div>
        {/* Filter pills */}
        <div class="flex gap-1">
          <For each={FILTER_OPTIONS}>
            {(opt) => (
              <button
                onClick={() => taskStore.setFilter(opt.value)}
                class={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                  taskStore.state.filter === opt.value
                    ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]'
                }`}
                data-filter={opt.value}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Task list */}
      <div class="flex-1 overflow-y-auto p-2">
        {/* Inline creation input */}
        <Show when={isCreating()}>
          <div class="mb-2 p-2 rounded bg-[var(--color-bg-panel)] border border-[var(--color-accent)]">
            <input
              ref={createInputRef}
              type="text"
              value={newTitle()}
              onInput={(e) => setNewTitle(e.currentTarget.value)}
              onKeyDown={handleCreateKeyDown}
              onBlur={submitCreate}
              placeholder="Task title..."
              class="w-full text-xs bg-transparent text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none"
            />
          </div>
        </Show>

        <Show
          when={taskStore.filteredTasks().length > 0}
          fallback={
            <Show when={!isCreating()}>
              <div class="text-center py-4">
                <div class="text-sm text-[var(--color-text-secondary)]">
                  {taskStore.state.tasks.length === 0
                    ? 'No tasks yet. Create one to get started.'
                    : 'No tasks match this filter.'}
                </div>
              </div>
            </Show>
          }
        >
          <div class="space-y-1">
            <For each={taskStore.filteredTasks()}>
              {(task) => (
                <div class="group flex items-center gap-2 p-2 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors">
                  {/* Status dot - clickable to cycle */}
                  <button
                    onClick={(e) => handleStatusClick(task.id, e)}
                    class="w-3 h-3 rounded-full flex-shrink-0 border-2 transition-colors hover:opacity-80"
                    style={{
                      'background-color': task.status === 'done' ? STATUS_COLORS[task.status] : 'transparent',
                      'border-color': STATUS_COLORS[task.status] || STATUS_COLORS.todo,
                    }}
                    title={`Status: ${task.status} (click to cycle)`}
                    data-testid={`status-${task.id}`}
                  />

                  {/* Title */}
                  <span
                    class={`flex-1 text-xs truncate ${
                      task.status === 'done'
                        ? 'line-through text-[var(--color-text-secondary)]'
                        : 'text-[var(--color-text-primary)]'
                    }`}
                  >
                    {task.title}
                  </span>

                  {/* Priority badge */}
                  <span
                    class="text-[9px] px-1.5 py-0.5 rounded-full border flex-shrink-0"
                    style={{
                      color: PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium,
                      'border-color': PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium,
                    }}
                  >
                    {task.priority}
                  </span>

                  {/* Delete button - visible on hover */}
                  <button
                    onClick={(e) => handleDelete(task.id, e)}
                    class="text-[var(--color-text-secondary)] hover:text-[var(--color-error)] opacity-0 group-hover:opacity-100 transition-opacity text-xs flex-shrink-0"
                    title="Delete task"
                    data-testid={`delete-${task.id}`}
                  >
                    x
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

export default TaskPanel;
