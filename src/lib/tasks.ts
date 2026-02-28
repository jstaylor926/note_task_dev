import { invoke } from '@tauri-apps/api/core';

export interface TaskRow {
  id: string;
  title: string;
  content: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  source_type: string | null;
  created_at: string;
  updated_at: string;
}

export async function taskCreate(title: string, content: string | null, priority: string, sourceType?: string): Promise<TaskRow> {
  return invoke<TaskRow>('task_create', { title, content, priority, sourceType: sourceType ?? null });
}

export async function taskGet(id: string): Promise<TaskRow | null> {
  return invoke<TaskRow | null>('task_get', { id });
}

export async function taskList(statusFilter?: string): Promise<TaskRow[]> {
  return invoke<TaskRow[]>('task_list', { statusFilter: statusFilter ?? null });
}

export async function taskUpdate(
  id: string,
  title: string,
  content: string | null,
  status: string,
  priority: string,
  dueDate?: string,
  assignedTo?: string,
): Promise<boolean> {
  return invoke<boolean>('task_update', {
    id,
    title,
    content,
    status,
    priority,
    dueDate: dueDate ?? null,
    assignedTo: assignedTo ?? null,
  });
}

export async function taskDelete(id: string): Promise<boolean> {
  return invoke<boolean>('task_delete', { id });
}

export async function extractTasksFromTerminal(output: string): Promise<TaskRow[]> {
  return invoke<TaskRow[]>('extract_tasks_from_terminal', { output });
}
