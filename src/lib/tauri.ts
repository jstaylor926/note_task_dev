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
