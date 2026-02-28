import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';

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
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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
});
