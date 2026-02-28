import { describe, it, expect, vi, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

afterEach(() => {
  vi.clearAllMocks();
});

describe('notes lib', () => {
  it('noteCreate calls invoke with title and content', async () => {
    const mockNote = {
      id: 'n1',
      title: 'Test',
      content: 'Body',
      metadata: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockNote);
    const { noteCreate } = await import('../notes');
    const result = await noteCreate('Test', 'Body');
    expect(invoke).toHaveBeenCalledWith('note_create', { title: 'Test', content: 'Body' });
    expect(result).toEqual(mockNote);
  });

  it('noteGet calls invoke with id', async () => {
    const mockNote = { id: 'n1', title: 'T', content: '', metadata: null, created_at: '', updated_at: '' };
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockNote);
    const { noteGet } = await import('../notes');
    const result = await noteGet('n1');
    expect(invoke).toHaveBeenCalledWith('note_get', { id: 'n1' });
    expect(result).toEqual(mockNote);
  });

  it('noteList calls invoke with no args', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { noteList } = await import('../notes');
    const result = await noteList();
    expect(invoke).toHaveBeenCalledWith('note_list');
    expect(result).toEqual([]);
  });

  it('noteUpdate calls invoke with id, title, content', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { noteUpdate } = await import('../notes');
    const result = await noteUpdate('n1', 'New Title', 'New Content');
    expect(invoke).toHaveBeenCalledWith('note_update', { id: 'n1', title: 'New Title', content: 'New Content' });
    expect(result).toBe(true);
  });

  it('noteDelete calls invoke with id', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { noteDelete } = await import('../notes');
    const result = await noteDelete('n1');
    expect(invoke).toHaveBeenCalledWith('note_delete', { id: 'n1' });
    expect(result).toBe(true);
  });

  it('noteCreate propagates errors', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));
    const { noteCreate } = await import('../notes');
    await expect(noteCreate('T', 'C')).rejects.toThrow('DB error');
  });
});
