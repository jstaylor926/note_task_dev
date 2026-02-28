import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';
import { taskStore } from '../../lib/taskStoreInstance';

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    title: 'Test Task',
    content: null,
    status: 'todo',
    priority: 'medium',
    due_date: null,
    assigned_to: null,
    completed_at: null,
    source_type: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset singleton store state between tests
  taskStore.setViewMode('list');
  taskStore.setFilter('all');
  taskStore.setSortBy('created');
  taskStore.setGroupBy('none');
  taskStore.setEditingTask(null);
});

describe('TaskPanel', () => {
  it('renders empty state when no tasks', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('No tasks yet');
    });
  });

  it('renders tasks after loading', async () => {
    const tasks = [makeTask({ id: 't1', title: 'First' }), makeTask({ id: 't2', title: 'Second' })];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);
    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('First');
      expect(container.textContent).toContain('Second');
    });
  });

  it('has filter pills', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);
    const pills = container.querySelectorAll('[data-filter]');
    expect(pills.length).toBe(4);
  });

  it('clicking New shows inline creation input', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('No tasks yet');
    });
    const newBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('New'));
    if (newBtn) fireEvent.click(newBtn);
    await vi.waitFor(() => {
      const input = container.querySelector('input[placeholder="Task title..."]');
      expect(input).not.toBeNull();
    });
  });

  it('clicking status dot calls task_update', async () => {
    const task = makeTask({ id: 't1', status: 'todo' });
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([task])  // task_list
      .mockResolvedValue(true); // task_update

    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Test Task');
    });

    const statusBtn = container.querySelector('[data-testid="status-t1"]');
    if (statusBtn) fireEvent.click(statusBtn);

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('task_update', expect.objectContaining({
        id: 't1',
        status: 'in_progress',
      }));
    });
  });

  // ─── New Phase 5c tests ──────────────────────────────────────────

  it('kanban view renders three columns', async () => {
    const tasks = [
      makeTask({ id: 't1', status: 'todo' }),
      makeTask({ id: 't2', status: 'in_progress', title: 'WIP' }),
      makeTask({ id: 't3', status: 'done', title: 'Finished' }),
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);
    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Test Task');
    });

    // Switch to kanban view
    const boardBtn = container.querySelector('[data-testid="view-mode-kanban"]');
    expect(boardBtn).not.toBeNull();
    if (boardBtn) fireEvent.click(boardBtn);

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="kanban-column-todo"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="kanban-column-in_progress"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="kanban-column-done"]')).not.toBeNull();
    });
  });

  it('tasks appear in correct kanban columns', async () => {
    const tasks = [
      makeTask({ id: 't1', title: 'Todo Task', status: 'todo' }),
      makeTask({ id: 't2', title: 'WIP Task', status: 'in_progress' }),
      makeTask({ id: 't3', title: 'Done Task', status: 'done' }),
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);
    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Todo Task');
    });

    const boardBtn = container.querySelector('[data-testid="view-mode-kanban"]');
    if (boardBtn) fireEvent.click(boardBtn);

    await vi.waitFor(() => {
      const todoCol = container.querySelector('[data-testid="kanban-column-todo"]');
      const wipCol = container.querySelector('[data-testid="kanban-column-in_progress"]');
      const doneCol = container.querySelector('[data-testid="kanban-column-done"]');

      expect(todoCol?.textContent).toContain('Todo Task');
      expect(wipCol?.textContent).toContain('WIP Task');
      expect(doneCol?.textContent).toContain('Done Task');
    });
  });

  it('view mode toggle switches between list and kanban', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([makeTask()]);
    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Test Task');
    });

    // Initially in list mode — no kanban columns
    expect(container.querySelector('[data-testid="kanban-column-todo"]')).toBeNull();

    // Switch to kanban
    const boardBtn = container.querySelector('[data-testid="view-mode-kanban"]');
    if (boardBtn) fireEvent.click(boardBtn);

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="kanban-column-todo"]')).not.toBeNull();
    });

    // Switch back to list
    const listBtn = container.querySelector('[data-testid="view-mode-list"]');
    if (listBtn) fireEvent.click(listBtn);

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="kanban-column-todo"]')).toBeNull();
    });
  });

  it('source type badge renders for auto-extracted tasks', async () => {
    const tasks = [
      makeTask({ id: 't1', title: 'Note Task', source_type: 'note' }),
      makeTask({ id: 't2', title: 'Code Task', source_type: 'code_comment' }),
      makeTask({ id: 't3', title: 'Term Task', source_type: 'terminal' }),
      makeTask({ id: 't4', title: 'Manual Task', source_type: null }),
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);
    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Note Task');
    });

    expect(container.querySelector('[data-testid="source-badge-note"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="source-badge-code_comment"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="source-badge-terminal"]')).not.toBeNull();
    // Manual tasks should NOT have a badge
    expect(container.querySelector('[data-testid="source-badge-manual"]')).toBeNull();
  });

  it('inline edit form opens on task click', async () => {
    const task = makeTask({ id: 't1', title: 'Editable' });
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([task]);
    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Editable');
    });

    const card = container.querySelector('[data-testid="task-card-t1"]');
    expect(card).not.toBeNull();
    if (card) fireEvent.click(card);

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="task-edit-t1"]')).not.toBeNull();
    });
  });

  it('sort select is visible in list view', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([makeTask()]);
    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Test Task');
    });

    const sortSelect = container.querySelector('[data-testid="sort-select"]');
    expect(sortSelect).not.toBeNull();
  });

  it('group by status shows section headers', async () => {
    const tasks = [
      makeTask({ id: 't1', status: 'todo', title: 'A' }),
      makeTask({ id: 't2', status: 'done', title: 'B' }),
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(tasks);
    const { default: TaskPanel } = await import('../TaskPanel');
    const { container } = render(() => <TaskPanel />);

    await vi.waitFor(() => {
      expect(container.textContent).toContain('A');
    });

    const groupSelect = container.querySelector('[data-testid="group-select"]') as HTMLSelectElement;
    expect(groupSelect).not.toBeNull();
    if (groupSelect) {
      fireEvent.change(groupSelect, { target: { value: 'status' } });
    }

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="group-header-todo"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="group-header-done"]')).not.toBeNull();
    });
  });
});
