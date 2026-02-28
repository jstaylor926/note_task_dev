import { invoke } from '@tauri-apps/api/core';

export interface UniversalSearchResult {
  id: string;
  result_type: string;
  title: string;
  snippet: string | null;
  source_file: string | null;
  relevance_score: number;
  metadata: Record<string, unknown> | null;
}

export interface UniversalSearchResponse {
  results: UniversalSearchResult[];
  query: string;
  code_count: number;
  entity_count: number;
}

export async function universalSearch(query: string, limit?: number): Promise<UniversalSearchResponse> {
  return invoke<UniversalSearchResponse>('universal_search', {
    query,
    limit: limit ?? null,
  });
}
