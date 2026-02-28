import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('entityLinks', () => {
  it('entityLinkCreate calls invoke with correct args', async () => {
    const mockLink = {
      id: 'link1',
      source_entity_id: 's1',
      target_entity_id: 't1',
      relationship_type: 'references',
      confidence: 1.0,
      auto_generated: false,
      context: null,
      created_at: '',
    };
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockLink);

    const { entityLinkCreate } = await import('../entityLinks');
    const result = await entityLinkCreate('s1', 't1', 'references');
    expect(invoke).toHaveBeenCalledWith('entity_link_create', {
      sourceId: 's1',
      targetId: 't1',
      relationshipType: 'references',
    });
    expect(result).toEqual(mockLink);
  });

  it('entityLinkList calls invoke with correct args', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { entityLinkList } = await import('../entityLinks');
    await entityLinkList('e1');
    expect(invoke).toHaveBeenCalledWith('entity_link_list', { entityId: 'e1' });
  });

  it('entityLinkDelete calls invoke with correct args', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const { entityLinkDelete } = await import('../entityLinks');
    const result = await entityLinkDelete('link1');
    expect(invoke).toHaveBeenCalledWith('entity_link_delete', { linkId: 'link1' });
    expect(result).toBe(true);
  });

  it('noteAutoLink calls invoke with correct args', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { noteAutoLink } = await import('../entityLinks');
    await noteAutoLink('note1');
    expect(invoke).toHaveBeenCalledWith('note_auto_link', { id: 'note1' });
  });

  it('entityLinkConfirm calls invoke with correct args', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const { entityLinkConfirm } = await import('../entityLinks');
    const result = await entityLinkConfirm('link1');
    expect(invoke).toHaveBeenCalledWith('entity_link_confirm', { linkId: 'link1' });
    expect(result).toBe(true);
  });

  it('entityLinksWithDetails calls invoke with correct args', async () => {
    const mockLinks = [
      {
        link_id: 'l1',
        linked_entity_id: 'e2',
        linked_entity_title: 'SearchPanel',
        linked_entity_type: 'function',
        linked_source_file: 'src/SearchPanel.tsx',
        relationship_type: 'references',
        confidence: 0.95,
        auto_generated: true,
        direction: 'outgoing',
      },
    ];
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockLinks);

    const { entityLinksWithDetails } = await import('../entityLinks');
    const result = await entityLinksWithDetails('e1');
    expect(invoke).toHaveBeenCalledWith('entity_links_with_details', { entityId: 'e1' });
    expect(result).toEqual(mockLinks);
  });
});
