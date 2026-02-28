import { createStore, produce } from 'solid-js/store';
import { createMemo } from 'solid-js';
import type { TaskRow } from './tasks';
import { taskCreate, taskDelete, taskList, taskUpdate } from './tasks';

export type TaskFilter = 'all' | 'todo' | 'in_progress' | 'done';

const STATUS_CYCLE: Record<string, string> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
};

interface TaskState {
  tasks: TaskRow[];
  filter: TaskFilter;
  isLoading: boolean;
  error: string | null;
}

export function createTaskStore() {
  const [state, setState] = createStore<TaskState>({
    tasks: [],
    filter: 'all',
    isLoading: false,
    error: null,
  });

  const filteredTasks = createMemo(() => {
    if (state.filter === 'all') return state.tasks;
    return state.tasks.filter((t) => t.status === state.filter);
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

  return {
    state,
    filteredTasks,
    loadTasks,
    createTask,
    updateTaskFields,
    cycleStatus,
    deleteTask,
    setFilter,
  };
}
