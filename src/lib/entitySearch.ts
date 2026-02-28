import { invoke } from '@tauri-apps/api/core';

export interface EntitySearchResult {
  id: string;
  entity_type: string;
  title: string;
  content: string | null;
  source_file: string | null;
  updated_at: string;
}

export async function entitySearch(
  query: string,
  entityType?: string,
  limit?: number,
): Promise<EntitySearchResult[]> {
  return invoke<EntitySearchResult[]>('entity_search', {
    query,
    entityType: entityType ?? null,
    limit: limit ?? null,
  });
}
