import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface HealthStatus {
  tauri: string;
  sidecar: string;
  sqlite: string;
  lancedb: string;
}

export interface IndexingProgress {
  completed: number;
  total: number;
  current_file: string | null;
  is_idle: boolean;
}

export interface SearchResult {
  text: string;
  source_file: string;
  chunk_index: number;
  chunk_type: string;
  entity_name: string | null;
  language: string;
  source_type: string;
  relevance_score: number;
  created_at: string;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
}

export interface SearchFilters {
  language?: string;
  source_type?: string;
  chunk_type?: string;
  file_path_prefix?: string;
}

export async function checkHealth(): Promise<HealthStatus> {
  return invoke<HealthStatus>('health_check');
}

export async function getAppStatus(): Promise<string> {
  return invoke<string>('get_app_status');
}

export async function semanticSearch(
  query: string,
  limit = 10,
  filters?: SearchFilters,
): Promise<SearchResponse> {
  return invoke<SearchResponse>('semantic_search', {
    query,
    limit,
    ...filters,
  });
}

export async function getIndexingStatus(): Promise<IndexingProgress> {
  return invoke<IndexingProgress>('get_indexing_status');
}

export function onIndexingProgress(
  callback: (payload: IndexingProgress) => void,
): Promise<UnlistenFn> {
  return listen<IndexingProgress>('indexing:progress', (event) => {
    callback(event.payload);
  });
}

// ─── Chat & Session ──────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface SessionStatePayload {
  summary: string;
  blockers: string[];
  next_steps: string[];
  focus: {
    open_files: string[];
    active_terminal_cwd: string;
  };
}

export interface SessionStateRow {
  id: string;
  workspace_profile_id: string;
  payload: string; // JSON string of SessionStatePayload
  trigger: string;
  duration_minutes: number | null;
  created_at: string;
}

export async function sendChatMessage(
  messages: ChatMessage[],
  model?: string,
): Promise<any> {
  return invoke('chat_send', { messages, model });
}

export async function getLatestSession(): Promise<SessionStateRow | null> {
  return invoke<SessionStateRow | null>('get_latest_session');
}

export async function captureSession(trigger = 'manual'): Promise<string> {
  return invoke<string>('session_capture', { trigger });
}

// ─── Workspace Profiles ──────────────────────────────────────────────

export interface WorkspaceProfile {
  id: string;
  name: string;
  watched_directories: string;
  llm_routing_overrides: string | null;
  system_prompt_additions: string | null;
  default_model: string | null;
  embedding_model: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function listProfiles(): Promise<WorkspaceProfile[]> {
  return invoke<WorkspaceProfile[]>('profile_list');
}

export async function createProfile(
  name: string,
  watchedDirectories: string,
  defaultModel?: string,
): Promise<WorkspaceProfile> {
  return invoke<WorkspaceProfile>('profile_create', {
    name,
    watchedDirectories,
    defaultModel,
  });
}

export async function activateProfile(id: string): Promise<boolean> {
  return invoke<boolean>('profile_activate', { id });
}

// ─── Intelligent Terminal ───────────────────────────────────────────

export interface TerminalTranslateResponse {
  command: string;
  explanation: string;
  confidence: number;
}

export interface TerminalResolveResponse {
  analysis: string;
  suggestion: string;
  explanation: string;
}

export async function translateTerminalCommand(
  query: string,
): Promise<TerminalTranslateResponse> {
  return invoke<TerminalTranslateResponse>('terminal_translate', { query });
}

export async function resolveTerminalError(
  command: string,
  exitCode: number,
  output: string,
): Promise<TerminalResolveResponse> {
  return invoke<TerminalResolveResponse>('terminal_resolve', {
    command,
    exitCode,
    output,
  });
}

export async function persistTerminalCommand(
  command: string,
  cwd?: string,
  exitCode?: number,
  durationMs?: number,
  output?: string,
): Promise<string> {
  return invoke<string>('terminal_command_persist', {
    command,
    cwd,
    exitCode,
    durationMs,
    output,
  });
}
