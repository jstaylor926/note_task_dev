import { invoke } from '@tauri-apps/api/core';

export interface NoteRow {
  id: string;
  title: string;
  content: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export async function noteCreate(title: string, content: string): Promise<NoteRow> {
  return invoke<NoteRow>('note_create', { title, content });
}

export async function noteGet(id: string): Promise<NoteRow | null> {
  return invoke<NoteRow | null>('note_get', { id });
}

export async function noteList(): Promise<NoteRow[]> {
  return invoke<NoteRow[]>('note_list');
}

export async function noteUpdate(id: string, title: string, content: string): Promise<boolean> {
  return invoke<boolean>('note_update', { id, title, content });
}

export async function noteDelete(id: string): Promise<boolean> {
  return invoke<boolean>('note_delete', { id });
}
