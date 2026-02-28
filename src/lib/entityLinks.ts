import { invoke } from '@tauri-apps/api/core';

export interface EntityLinkRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  confidence: number;
  auto_generated: boolean;
  context: string | null;
  created_at: string;
}

export async function entityLinkCreate(
  sourceId: string,
  targetId: string,
  relationshipType: string,
): Promise<EntityLinkRow> {
  return invoke<EntityLinkRow>('entity_link_create', {
    sourceId,
    targetId,
    relationshipType,
  });
}

export async function entityLinkList(entityId: string): Promise<EntityLinkRow[]> {
  return invoke<EntityLinkRow[]>('entity_link_list', { entityId });
}

export async function entityLinkDelete(linkId: string): Promise<boolean> {
  return invoke<boolean>('entity_link_delete', { linkId });
}

export interface LinkWithEntity {
  link_id: string;
  linked_entity_id: string;
  linked_entity_title: string;
  linked_entity_type: string;
  linked_source_file: string | null;
  relationship_type: string;
  confidence: number;
  auto_generated: boolean;
  direction: 'outgoing' | 'incoming';
}

export async function noteAutoLink(id: string): Promise<EntityLinkRow[]> {
  return invoke<EntityLinkRow[]>('note_auto_link', { id });
}

export async function entityLinkConfirm(linkId: string): Promise<boolean> {
  return invoke<boolean>('entity_link_confirm', { linkId });
}

export async function entityLinksWithDetails(entityId: string): Promise<LinkWithEntity[]> {
  return invoke<LinkWithEntity[]>('entity_links_with_details', { entityId });
}

export async function listSuggestedLinks(entityId: string, minConfidence?: number): Promise<EntityLinkRow[]> {
  return invoke<EntityLinkRow[]>('list_suggested_links', {
    entityId,
    minConfidence: minConfidence ?? null,
  });
}

export async function countSuggestedLinks(): Promise<number> {
  return invoke<number>('count_suggested_links');
}
