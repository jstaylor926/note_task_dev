import { describe, it, expect, vi, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

afterEach(() => {
  vi.clearAllMocks();
});

describe('tasks lib', () => {
  it('taskCreate calls invoke with title, content, priority', async () => {
    const mockTask = {
      id: 't1',
      title: 'Task',
      content: null,
      status: 'todo',
      priority: 'medium',
      due_date: null,
      assigned_to: null,
      completed_at: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockTask);
    const { taskCreate } = await import('../tasks');
    const result = await taskCreate('Task', null, 'medium');
    expect(invoke).toHaveBeenCalledWith('task_create', { title: 'Task', content: null, priority: 'medium' });
    expect(result).toEqual(mockTask);
  });

  it('taskGet calls invoke with id', async () => {
    const mockTask = { id: 't1', title: 'T', content: null, status: 'todo', priority: 'low', due_date: null, assigned_to: null, completed_at: null, created_at: '', updated_at: '' };
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockTask);
    const { taskGet } = await import('../tasks');
    const result = await taskGet('t1');
    expect(invoke).toHaveBeenCalledWith('task_get', { id: 't1' });
    expect(result).toEqual(mockTask);
  });

  it('taskList calls invoke with null statusFilter by default', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { taskList } = await import('../tasks');
    const result = await taskList();
    expect(invoke).toHaveBeenCalledWith('task_list', { statusFilter: null });
    expect(result).toEqual([]);
  });

  it('taskList calls invoke with statusFilter when provided', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { taskList } = await import('../tasks');
    await taskList('done');
    expect(invoke).toHaveBeenCalledWith('task_list', { statusFilter: 'done' });
  });

  it('taskUpdate calls invoke with all fields', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { taskUpdate } = await import('../tasks');
    const result = await taskUpdate('t1', 'Updated', 'desc', 'in_progress', 'high', '2026-03-01');
    expect(invoke).toHaveBeenCalledWith('task_update', {
      id: 't1',
      title: 'Updated',
      content: 'desc',
      status: 'in_progress',
      priority: 'high',
      dueDate: '2026-03-01',
      assignedTo: null,
    });
    expect(result).toBe(true);
  });

  it('taskDelete calls invoke with id', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { taskDelete } = await import('../tasks');
    const result = await taskDelete('t1');
    expect(invoke).toHaveBeenCalledWith('task_delete', { id: 't1' });
    expect(result).toBe(true);
  });

  it('taskCreate propagates errors', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));
    const { taskCreate } = await import('../tasks');
    await expect(taskCreate('T', null, 'low')).rejects.toThrow('DB error');
  });
});
