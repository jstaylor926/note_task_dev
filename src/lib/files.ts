import { invoke } from '@tauri-apps/api/core';

export interface FileReadResponse {
  content: string;
  size: number;
  extension: string | null;
  path: string;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  extension: string | null;
  size: number;
}

export interface FileStat {
  path: string;
  size: number;
  is_dir: boolean;
  is_file: boolean;
  extension: string | null;
  readonly: boolean;
}

export async function fileRead(path: string): Promise<FileReadResponse> {
  return invoke<FileReadResponse>('file_read', { path });
}

export async function fileWrite(
  path: string,
  content: string,
): Promise<void> {
  return invoke<void>('file_write', { path, content });
}

export async function fileListDirectory(
  path: string,
): Promise<DirEntry[]> {
  return invoke<DirEntry[]>('file_list_directory', { path });
}

export async function fileStat(path: string): Promise<FileStat> {
  return invoke<FileStat>('file_stat', { path });
}
