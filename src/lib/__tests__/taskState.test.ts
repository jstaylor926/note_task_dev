import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'solid-js';

const mockTaskList = vi.fn();
const mockTaskCreate = vi.fn();
const mockTaskUpdate = vi.fn();
const mockTaskDelete = vi.fn();

vi.mock('../tasks', () => ({
  taskList: (...args: unknown[]) => mockTaskList(...args),
  taskCreate: (...args: unknown[]) => mockTaskCreate(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
  taskDelete: (...args: unknown[]) => mockTaskDelete(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeTask(overrides: Partial<{
  id: string; title: string; status: string; priority: string; source_type: string | null;
}> = {}) {
  return {
    id: 't1',
    title: 'Task',
    content: null,
    status: 'todo',
    priority: 'medium',
    due_date: null,
    assigned_to: null,
    completed_at: null,
    source_type: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('taskState', () => {
  it('starts with empty state', async () => {
    const { createTaskStore } = await import('../taskState');
    createRoot((dispose) => {
      const store = createTaskStore();
      expect(store.state.tasks).toEqual([]);
      expect(store.state.filter).toBe('all');
      expect(store.state.isLoading).toBe(false);
      expect(store.state.error).toBeNull();
      dispose();
    });
  });

  it('loadTasks fetches tasks and updates state', async () => {
    const tasks = [makeTask({ id: 't1' }), makeTask({ id: 't2', title: 'Two' })];
    mockTaskList.mockResolvedValue(tasks);
    const { createTaskStore } = await import('../taskState');

    await createRoot(async (dispose) => {
      const store = createTaskStore();
      await store.loadTasks();
      expect(store.state.tasks.length).toBe(2);
      expect(store.state.isLoading).toBe(false);
      dispose();
    });
  });

  it('loadTasks sets error on failure', async () => {
    mockTaskList.mockRejectedValue(new Error('fail'));
    const { createTaskStore } = await import('../taskState');

    await createRoot(async (dispose) => {
      const store = createTaskStore();
      await store.loadTasks();
      expect(store.state.error).toBe('Error: fail');
      dispose();
    });
  });

  it('createTask adds task to store', async () => {
    const task = makeTask({ id: 't3', title: 'New Task' });
    mockTaskCreate.mockResolvedValue(task);
    const { createTaskStore } = await import('../taskState');

    await createRoot(async (dispose) => {
      const store = createTaskStore();
      const result = await store.createTask('New Task');
      expect(result).toEqual(task);
      expect(store.state.tasks.length).toBe(1);
      dispose();
    });
  });

  it('cycleStatus cycles todo -> in_progress -> done -> todo', async () => {
    const task = makeTask({ id: 't1', status: 'todo' });
    mockTaskList.mockResolvedValue([task]);
    mockTaskUpdate.mockResolvedValue(true);
    const { createTaskStore } = await import('../taskState');

    await createRoot(async (dispose) => {
      const store = createTaskStore();
      await store.loadTasks();

      await store.cycleStatus('t1');
      expect(store.state.tasks[0].status).toBe('in_progress');

      await store.cycleStatus('t1');
      expect(store.state.tasks[0].status).toBe('done');

      await store.cycleStatus('t1');
      expect(store.state.tasks[0].status).toBe('todo');
      dispose();
    });
  });

  it('deleteTask removes from store', async () => {
    mockTaskList.mockResolvedValue([makeTask({ id: 't1' }), makeTask({ id: 't2' })]);
    mockTaskDelete.mockResolvedValue(true);
    const { createTaskStore } = await import('../taskState');

    await createRoot(async (dispose) => {
      const store = createTaskStore();
      await store.loadTasks();
      await store.deleteTask('t1');
      expect(store.state.tasks.length).toBe(1);
      expect(store.state.tasks[0].id).toBe('t2');
      dispose();
    });
  });

  it('setFilter changes filter', async () => {
    const { createTaskStore } = await import('../taskState');
    createRoot((dispose) => {
      const store = createTaskStore();
      store.setFilter('done');
      expect(store.state.filter).toBe('done');
      dispose();
    });
  });

  it('filteredTasks filters by status', async () => {
    const tasks = [
      makeTask({ id: 't1', status: 'todo' }),
      makeTask({ id: 't2', status: 'done' }),
      makeTask({ id: 't3', status: 'todo' }),
    ];
    mockTaskList.mockResolvedValue(tasks);
    const { createTaskStore } = await import('../taskState');

    await createRoot(async (dispose) => {
      const store = createTaskStore();
      await store.loadTasks();

      expect(store.filteredTasks().length).toBe(3); // all

      store.setFilter('todo');
      expect(store.filteredTasks().length).toBe(2);

      store.setFilter('done');
      expect(store.filteredTasks().length).toBe(1);
      expect(store.filteredTasks()[0].id).toBe('t2');

      store.setFilter('all');
      expect(store.filteredTasks().length).toBe(3);
      dispose();
    });
  });

  // ─── New Phase 5c tests ──────────────────────────────────────────

  it('sortedTasks sorts by priority', async () => {
    const tasks = [
      makeTask({ id: 't1', priority: 'low' }),
      makeTask({ id: 't2', priority: 'high' }),
      makeTask({ id: 't3', priority: 'medium' }),
    ];
    mockTaskList.mockResolvedValue(tasks);
    const { createTaskStore } = await import('../taskState');

    await createRoot(async (dispose) => {
      const store = createTaskStore();
      await store.loadTasks();
      store.setSortBy('priority');
      const sorted = store.sortedTasks();
      expect(sorted[0].priority).toBe('high');
      expect(sorted[1].priority).toBe('medium');
      expect(sorted[2].priority).toBe('low');
      dispose();
    });
  });

  it('groupedTasks groups by status', async () => {
    const tasks = [
      makeTask({ id: 't1', status: 'todo' }),
      makeTask({ id: 't2', status: 'done' }),
      makeTask({ id: 't3', status: 'todo' }),
    ];
    mockTaskList.mockResolvedValue(tasks);
    const { createTaskStore } = await import('../taskState');

    await createRoot(async (dispose) => {
      const store = createTaskStore();
      await store.loadTasks();
      store.setGroupBy('status');
      const groups = store.groupedTasks();
      expect(groups.get('todo')?.length).toBe(2);
      expect(groups.get('done')?.length).toBe(1);
      dispose();
    });
  });

  it('kanbanColumns returns correct structure', async () => {
    const tasks = [
      makeTask({ id: 't1', status: 'todo' }),
      makeTask({ id: 't2', status: 'in_progress' }),
      makeTask({ id: 't3', status: 'done' }),
      makeTask({ id: 't4', status: 'todo' }),
    ];
    mockTaskList.mockResolvedValue(tasks);
    const { createTaskStore } = await import('../taskState');

    await createRoot(async (dispose) => {
      const store = createTaskStore();
      await store.loadTasks();
      const cols = store.kanbanColumns();
      expect(cols.todo.length).toBe(2);
      expect(cols.in_progress.length).toBe(1);
      expect(cols.done.length).toBe(1);
      dispose();
    });
  });

  it('setViewMode, setSortBy, setGroupBy update state', async () => {
    const { createTaskStore } = await import('../taskState');
    createRoot((dispose) => {
      const store = createTaskStore();
      expect(store.state.viewMode).toBe('list');
      store.setViewMode('kanban');
      expect(store.state.viewMode).toBe('kanban');

      expect(store.state.sortBy).toBe('created');
      store.setSortBy('priority');
      expect(store.state.sortBy).toBe('priority');

      expect(store.state.groupBy).toBe('none');
      store.setGroupBy('status');
      expect(store.state.groupBy).toBe('status');
      dispose();
    });
  });

  it('source_type preserved in task operations', async () => {
    const task = makeTask({ id: 't1', source_type: 'note' });
    mockTaskList.mockResolvedValue([task]);
    const { createTaskStore } = await import('../taskState');

    await createRoot(async (dispose) => {
      const store = createTaskStore();
      await store.loadTasks();
      expect(store.state.tasks[0].source_type).toBe('note');
      dispose();
    });
  });

  it('setEditingTask toggles editing mode', async () => {
    const { createTaskStore } = await import('../taskState');
    createRoot((dispose) => {
      const store = createTaskStore();
      expect(store.state.editingTaskId).toBeNull();
      store.setEditingTask('t1');
      expect(store.state.editingTaskId).toBe('t1');
      store.setEditingTask(null);
      expect(store.state.editingTaskId).toBeNull();
      dispose();
    });
  });
});
