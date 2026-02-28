import { createSignal, For, Show, onMount } from 'solid-js';
import { taskStore, type TaskFilter, type TaskSortBy, type TaskGroupBy } from '../lib/taskStoreInstance';
import type { TaskRow } from '../lib/tasks';

const FILTER_OPTIONS: { value: TaskFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
];

const SORT_OPTIONS: { value: TaskSortBy; label: string }[] = [
  { value: 'created', label: 'Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'due_date', label: 'Due Date' },
  { value: 'status', label: 'Status' },
];

const GROUP_OPTIONS: { value: TaskGroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'source_type', label: 'Source' },
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

const SOURCE_BADGE_CONFIG: Record<string, { label: string; color: string }> = {
  note: { label: 'N', color: 'var(--color-accent)' },
  code_comment: { label: 'C', color: '#22c55e' },
  terminal: { label: 'T', color: '#f97316' },
};

function SourceBadge(props: { sourceType: string | null }) {
  const config = () => SOURCE_BADGE_CONFIG[props.sourceType || ''];
  return (
    <Show when={config()}>
      <span
        class="text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          color: config()!.color,
          border: `1px solid ${config()!.color}`,
        }}
        data-testid={`source-badge-${props.sourceType}`}
        title={`Source: ${props.sourceType}`}
      >
        {config()!.label}
      </span>
    </Show>
  );
}

function InlineEditForm(props: { task: TaskRow; onClose: () => void }) {
  const [title, setTitle] = createSignal(props.task.title);
  const [priority, setPriority] = createSignal(props.task.priority);
  const [status, setStatus] = createSignal(props.task.status);

  function handleSave() {
    taskStore.updateTaskInline(props.task.id, {
      title: title(),
      priority: priority(),
      status: status(),
    });
    props.onClose();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      props.onClose();
    } else if (e.key === 'Enter') {
      handleSave();
    }
  }

  return (
    <div
      class="p-2 rounded bg-[var(--color-bg-panel)] border border-[var(--color-accent)] space-y-2"
      data-testid={`task-edit-${props.task.id}`}
      onKeyDown={handleKeyDown}
    >
      <input
        type="text"
        value={title()}
        onInput={(e) => setTitle(e.currentTarget.value)}
        class="w-full text-xs bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] rounded px-2 py-1 border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-accent)]"
      />
      <div class="flex gap-2">
        <select
          value={status()}
          onChange={(e) => setStatus(e.currentTarget.value)}
          class="text-[10px] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] rounded px-1 py-0.5 border border-[var(--color-border)]"
        >
          <option value="todo">Todo</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
        </select>
        <select
          value={priority()}
          onChange={(e) => setPriority(e.currentTarget.value)}
          class="text-[10px] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] rounded px-1 py-0.5 border border-[var(--color-border)]"
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button
          onClick={handleSave}
          class="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
        >
          Save
        </button>
        <button
          onClick={props.onClose}
          class="text-[10px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function TaskCard(props: { task: TaskRow }) {
  function handleStatusClick(e: MouseEvent) {
    e.stopPropagation();
    taskStore.cycleStatus(props.task.id);
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    taskStore.deleteTask(props.task.id);
  }

  function handleClick() {
    taskStore.setEditingTask(
      taskStore.state.editingTaskId === props.task.id ? null : props.task.id,
    );
  }

  return (
    <Show
      when={taskStore.state.editingTaskId !== props.task.id}
      fallback={
        <InlineEditForm
          task={props.task}
          onClose={() => taskStore.setEditingTask(null)}
        />
      }
    >
      <div
        class="group flex items-center gap-2 p-2 rounded bg-[var(--color-bg-panel)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors cursor-pointer"
        onClick={handleClick}
        data-testid={`task-card-${props.task.id}`}
      >
        {/* Status dot */}
        <button
          onClick={handleStatusClick}
          class="w-3 h-3 rounded-full flex-shrink-0 border-2 transition-colors hover:opacity-80"
          style={{
            'background-color': props.task.status === 'done' ? STATUS_COLORS[props.task.status] : 'transparent',
            'border-color': STATUS_COLORS[props.task.status] || STATUS_COLORS.todo,
          }}
          title={`Status: ${props.task.status} (click to cycle)`}
          data-testid={`status-${props.task.id}`}
        />

        {/* Title */}
        <span
          class={`flex-1 text-xs truncate ${
            props.task.status === 'done'
              ? 'line-through text-[var(--color-text-secondary)]'
              : 'text-[var(--color-text-primary)]'
          }`}
        >
          {props.task.title}
        </span>

        {/* Source badge */}
        <SourceBadge sourceType={props.task.source_type} />

        {/* Priority badge */}
        <span
          class="text-[9px] px-1.5 py-0.5 rounded-full border flex-shrink-0"
          style={{
            color: PRIORITY_COLORS[props.task.priority] || PRIORITY_COLORS.medium,
            'border-color': PRIORITY_COLORS[props.task.priority] || PRIORITY_COLORS.medium,
          }}
        >
          {props.task.priority}
        </span>

        {/* Delete button */}
        <button
          onClick={handleDelete}
          class="text-[var(--color-text-secondary)] hover:text-[var(--color-error)] opacity-0 group-hover:opacity-100 transition-opacity text-xs flex-shrink-0"
          title="Delete task"
          data-testid={`delete-${props.task.id}`}
        >
          x
        </button>
      </div>
    </Show>
  );
}

function KanbanColumn(props: { status: string; label: string; tasks: TaskRow[] }) {
  return (
    <div
      class="flex-1 min-w-0 flex flex-col"
      data-testid={`kanban-column-${props.status}`}
    >
      <div class="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] border-b border-[var(--color-border)] flex justify-between">
        <span>{props.label}</span>
        <span class="text-[9px]">{props.tasks.length}</span>
      </div>
      <div class="flex-1 overflow-y-auto p-1 space-y-1">
        <For each={props.tasks}>
          {(task) => <TaskCard task={task} />}
        </For>
        <Show when={props.tasks.length === 0}>
          <div class="text-center py-2 text-[10px] text-[var(--color-text-secondary)]">
            Empty
          </div>
        </Show>
      </div>
    </div>
  );
}

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

  return (
    <div class="flex flex-col h-full bg-[var(--color-bg-secondary)]">
      {/* Header */}
      <div class="px-3 py-2 border-b border-[var(--color-border)]">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Tasks
          </div>
          <div class="flex items-center gap-1">
            {/* View mode toggle */}
            <button
              onClick={() => taskStore.setViewMode('list')}
              class={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                taskStore.state.viewMode === 'list'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
              data-testid="view-mode-list"
            >
              List
            </button>
            <button
              onClick={() => taskStore.setViewMode('kanban')}
              class={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                taskStore.state.viewMode === 'kanban'
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
              data-testid="view-mode-kanban"
            >
              Board
            </button>
            <button
              onClick={handleCreate}
              class="px-2 py-1 text-[10px] font-medium rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              New
            </button>
          </div>
        </div>

        {/* Filter pills */}
        <div class="flex gap-1 mb-1">
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

        {/* Sort and Group controls — only in list view */}
        <Show when={taskStore.state.viewMode === 'list'}>
          <div class="flex gap-2 items-center">
            <label class="text-[9px] text-[var(--color-text-secondary)]">Sort:</label>
            <select
              value={taskStore.state.sortBy}
              onChange={(e) => taskStore.setSortBy(e.currentTarget.value as TaskSortBy)}
              class="text-[10px] bg-[var(--color-bg-panel)] text-[var(--color-text-primary)] rounded px-1 py-0.5 border border-[var(--color-border)]"
              data-testid="sort-select"
            >
              <For each={SORT_OPTIONS}>
                {(opt) => <option value={opt.value}>{opt.label}</option>}
              </For>
            </select>
            <label class="text-[9px] text-[var(--color-text-secondary)]">Group:</label>
            <select
              value={taskStore.state.groupBy}
              onChange={(e) => taskStore.setGroupBy(e.currentTarget.value as TaskGroupBy)}
              class="text-[10px] bg-[var(--color-bg-panel)] text-[var(--color-text-primary)] rounded px-1 py-0.5 border border-[var(--color-border)]"
              data-testid="group-select"
            >
              <For each={GROUP_OPTIONS}>
                {(opt) => <option value={opt.value}>{opt.label}</option>}
              </For>
            </select>
          </div>
        </Show>
      </div>

      {/* Body */}
      <div class="flex-1 overflow-y-auto">
        {/* Inline creation input */}
        <Show when={isCreating()}>
          <div class="m-2 p-2 rounded bg-[var(--color-bg-panel)] border border-[var(--color-accent)]">
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

        {/* Kanban view */}
        <Show when={taskStore.state.viewMode === 'kanban'}>
          <div class="flex gap-1 h-full p-1">
            <KanbanColumn status="todo" label="Todo" tasks={taskStore.kanbanColumns().todo} />
            <KanbanColumn status="in_progress" label="In Progress" tasks={taskStore.kanbanColumns().in_progress} />
            <KanbanColumn status="done" label="Done" tasks={taskStore.kanbanColumns().done} />
          </div>
        </Show>

        {/* List view */}
        <Show when={taskStore.state.viewMode === 'list'}>
          <div class="p-2">
            <Show
              when={taskStore.sortedTasks().length > 0}
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
              <Show
                when={taskStore.state.groupBy !== 'none'}
                fallback={
                  <div class="space-y-1">
                    <For each={taskStore.sortedTasks()}>
                      {(task) => <TaskCard task={task} />}
                    </For>
                  </div>
                }
              >
                <For each={[...taskStore.groupedTasks().entries()]}>
                  {([groupKey, tasks]) => (
                    <div class="mb-3">
                      <div
                        class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] mb-1 px-1"
                        data-testid={`group-header-${groupKey}`}
                      >
                        {groupKey} ({tasks.length})
                      </div>
                      <div class="space-y-1">
                        <For each={tasks}>
                          {(task) => <TaskCard task={task} />}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

export default TaskPanel;
