import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface PtyOutputEvent {
  session_id: string;
  data: string; // base64-encoded
}

export interface PtyExitEvent {
  session_id: string;
  exit_code: number | null;
}

export interface TerminalCommandEndEvent {
  session_id: string;
  command: string;
  exit_code: number | null;
  cwd: string | null;
  duration_ms: number | null;
}

export async function ptyCreate(
  sessionId: string,
  cwd?: string,
): Promise<void> {
  return invoke<void>('pty_create', { sessionId, cwd });
}

export async function ptyWrite(
  sessionId: string,
  data: string,
): Promise<void> {
  return invoke<void>('pty_write', { sessionId, data });
}

export async function ptyResize(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke<void>('pty_resize', { sessionId, cols, rows });
}

export async function ptyKill(sessionId: string): Promise<void> {
  return invoke<void>('pty_kill', { sessionId });
}

export function onPtyOutput(
  callback: (payload: PtyOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<PtyOutputEvent>('pty:output', (event) => {
    callback(event.payload);
  });
}

export function onPtyExit(
  callback: (payload: PtyExitEvent) => void,
): Promise<UnlistenFn> {
  return listen<PtyExitEvent>('pty:exit', (event) => {
    callback(event.payload);
  });
}
