import { entitySearch } from './entitySearch';
import { entityLinksWithDetails } from './entityLinks';
import type { LinkWithEntity } from './entityLinks';

/**
 * Get all entity links related to a file path.
 * Finds entities with matching source_file, then gets their links.
 */
export async function getLinksForFile(filePath: string): Promise<LinkWithEntity[]> {
  // Search for entities matching the source file
  const entities = await entitySearch(filePath, undefined, 50);
  const fileEntities = entities.filter((e) => e.source_file === filePath);

  if (fileEntities.length === 0) return [];

  // Aggregate links from all entities in this file
  const allLinks: LinkWithEntity[] = [];
  const seenLinkIds = new Set<string>();

  for (const entity of fileEntities) {
    const links = await entityLinksWithDetails(entity.id);
    for (const link of links) {
      if (!seenLinkIds.has(link.link_id)) {
        seenLinkIds.add(link.link_id);
        allLinks.push(link);
      }
    }
  }

  return allLinks;
}
