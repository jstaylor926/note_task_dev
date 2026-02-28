import { createStore, produce } from 'solid-js/store';
import { createMemo } from 'solid-js';
import type { TaskRow } from './tasks';
import { taskCreate, taskDelete, taskList, taskUpdate } from './tasks';

export type TaskFilter = 'all' | 'todo' | 'in_progress' | 'done';
export type TaskViewMode = 'list' | 'kanban';
export type TaskSortBy = 'created' | 'priority' | 'due_date' | 'status';
export type TaskGroupBy = 'none' | 'status' | 'priority' | 'source_type';

const STATUS_CYCLE: Record<string, string> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
};

const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const STATUS_ORDER: Record<string, number> = {
  todo: 0,
  in_progress: 1,
  done: 2,
};

interface TaskState {
  tasks: TaskRow[];
  filter: TaskFilter;
  isLoading: boolean;
  error: string | null;
  viewMode: TaskViewMode;
  sortBy: TaskSortBy;
  groupBy: TaskGroupBy;
  editingTaskId: string | null;
}

export function createTaskStore() {
  const [state, setState] = createStore<TaskState>({
    tasks: [],
    filter: 'all',
    isLoading: false,
    error: null,
    viewMode: 'list',
    sortBy: 'created',
    groupBy: 'none',
    editingTaskId: null,
  });

  const filteredTasks = createMemo(() => {
    if (state.filter === 'all') return state.tasks;
    return state.tasks.filter((t) => t.status === state.filter);
  });

  const sortedTasks = createMemo(() => {
    const tasks = [...filteredTasks()];
    switch (state.sortBy) {
      case 'priority':
        tasks.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2));
        break;
      case 'due_date':
        tasks.sort((a, b) => {
          if (!a.due_date && !b.due_date) return 0;
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return a.due_date.localeCompare(b.due_date);
        });
        break;
      case 'status':
        tasks.sort((a, b) => (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0));
        break;
      case 'created':
      default:
        // Already sorted by creation from backend (priority then created_at)
        break;
    }
    return tasks;
  });

  const groupedTasks = createMemo(() => {
    const groups = new Map<string, TaskRow[]>();
    if (state.groupBy === 'none') {
      groups.set('all', sortedTasks());
      return groups;
    }
    for (const task of sortedTasks()) {
      let key: string;
      switch (state.groupBy) {
        case 'status':
          key = task.status;
          break;
        case 'priority':
          key = task.priority;
          break;
        case 'source_type':
          key = task.source_type || 'manual';
          break;
        default:
          key = 'all';
      }
      const existing = groups.get(key) || [];
      existing.push(task);
      groups.set(key, existing);
    }
    return groups;
  });

  const kanbanColumns = createMemo(() => {
    const all = state.filter === 'all' ? state.tasks : state.tasks.filter((t) => state.filter === 'all' || t.status === state.filter);
    return {
      todo: all.filter((t) => t.status === 'todo'),
      in_progress: all.filter((t) => t.status === 'in_progress'),
      done: all.filter((t) => t.status === 'done'),
    };
  });

  async function loadTasks() {
    setState('isLoading', true);
    setState('error', null);
    try {
      const tasks = await taskList();
      setState(
        produce((s) => {
          s.tasks = tasks;
          s.isLoading = false;
        }),
      );
    } catch (err) {
      setState(
        produce((s) => {
          s.error = String(err);
          s.isLoading = false;
        }),
      );
    }
  }

  async function createTask(title: string, priority: string = 'medium') {
    try {
      const task = await taskCreate(title, null, priority);
      setState(
        produce((s) => {
          s.tasks.unshift(task);
          s.error = null;
        }),
      );
      return task;
    } catch (err) {
      setState('error', String(err));
      return null;
    }
  }

  async function updateTaskFields(
    id: string,
    title: string,
    content: string | null,
    status: string,
    priority: string,
    dueDate?: string,
    assignedTo?: string,
  ) {
    try {
      await taskUpdate(id, title, content, status, priority, dueDate, assignedTo);
      setState(
        produce((s) => {
          const idx = s.tasks.findIndex((t) => t.id === id);
          if (idx !== -1) {
            s.tasks[idx].title = title;
            s.tasks[idx].content = content;
            s.tasks[idx].status = status;
            s.tasks[idx].priority = priority;
            s.tasks[idx].due_date = dueDate ?? null;
            s.tasks[idx].assigned_to = assignedTo ?? null;
            s.tasks[idx].updated_at = new Date().toISOString();
            if (status === 'done' && !s.tasks[idx].completed_at) {
              s.tasks[idx].completed_at = new Date().toISOString();
            } else if (status !== 'done') {
              s.tasks[idx].completed_at = null;
            }
          }
          s.error = null;
        }),
      );
      return true;
    } catch (err) {
      setState('error', String(err));
      return false;
    }
  }

  async function cycleStatus(id: string) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    const nextStatus = STATUS_CYCLE[task.status] || 'todo';
    await updateTaskFields(id, task.title, task.content, nextStatus, task.priority, task.due_date ?? undefined, task.assigned_to ?? undefined);
  }

  async function deleteTask(id: string) {
    try {
      await taskDelete(id);
      setState(
        produce((s) => {
          const idx = s.tasks.findIndex((t) => t.id === id);
          if (idx !== -1) {
            s.tasks.splice(idx, 1);
          }
          s.error = null;
        }),
      );
      return true;
    } catch (err) {
      setState('error', String(err));
      return false;
    }
  }

  function setFilter(filter: TaskFilter) {
    setState('filter', filter);
  }

  function setViewMode(mode: TaskViewMode) {
    setState('viewMode', mode);
  }

  function setSortBy(field: TaskSortBy) {
    setState('sortBy', field);
  }

  function setGroupBy(field: TaskGroupBy) {
    setState('groupBy', field);
  }

  function setEditingTask(id: string | null) {
    setState('editingTaskId', id);
  }

  async function updateTaskInline(
    id: string,
    fields: { title?: string; content?: string | null; status?: string; priority?: string; due_date?: string },
  ) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return false;
    return updateTaskFields(
      id,
      fields.title ?? task.title,
      fields.content !== undefined ? fields.content : task.content,
      fields.status ?? task.status,
      fields.priority ?? task.priority,
      fields.due_date ?? task.due_date ?? undefined,
      task.assigned_to ?? undefined,
    );
  }

  return {
    state,
    filteredTasks,
    sortedTasks,
    groupedTasks,
    kanbanColumns,
    loadTasks,
    createTask,
    updateTaskFields,
    cycleStatus,
    deleteTask,
    setFilter,
    setViewMode,
    setSortBy,
    setGroupBy,
    setEditingTask,
    updateTaskInline,
  };
}
