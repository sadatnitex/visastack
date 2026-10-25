import { CATALOGUE_MODULES } from '../modules';
import type { CatalogueField } from '../types';
import { AMOUNT_BASIS_BLOCKS } from './amount-basis';
import { COUNTRY_PACK_BLOCKS } from './country-packs';
import { DECLARATION_BLOCKS } from './declarations';
import { buildFields } from './define';
import { HEALTH_BLOCKS } from './health';
import { IDENTITY_BLOCKS } from './identity';
import { LEGACY_OTHER_BLOCKS } from './legacy-other';
import { MONEY_BLOCKS } from './money';
import { OTHER_ITEM_BLOCKS } from './other-items';
import { PEOPLE_BLOCKS } from './people';
import { PURPOSE_PACK_BLOCKS } from './purpose-packs';
import { QUALIFICATION_BLOCKS } from './qualifications';
import { TIMELINE_BLOCKS } from './timelines';
import { TRAVEL_DOCUMENT_BLOCKS } from './travel-documents';

const MODULE_OF_BLOCK: ReadonlyMap<string, string> = new Map(
  CATALOGUE_MODULES.flatMap((module) => module.blocks.map((block) => [block, module.key] as const)),
);

/** The key a module uses to claim a block: a repeating record or a section of single fields. */
export function blockKeyOf(field: { readonly group?: string; readonly section?: string }): string {
  return field.group ? `G:${field.group}` : `S:${field.section ?? ''}`;
}

/**
 * Every field added by the enrichment, in layer order, each placed in its opt-in section. The 81
 * live fields are not repeated here. A field no module claims gets an empty module key and is
 * caught by the catalogue tests, rather than breaking anything that imports this file.
 */
export const CATALOGUE_FIELDS: readonly CatalogueField[] = buildFields([
  ...IDENTITY_BLOCKS,
  ...TRAVEL_DOCUMENT_BLOCKS,
  ...TIMELINE_BLOCKS,
  ...MONEY_BLOCKS,
  ...PEOPLE_BLOCKS,
  ...DECLARATION_BLOCKS,
  ...HEALTH_BLOCKS,
  ...QUALIFICATION_BLOCKS,
  ...PURPOSE_PACK_BLOCKS,
  ...COUNTRY_PACK_BLOCKS,
  ...LEGACY_OTHER_BLOCKS,
  ...AMOUNT_BASIS_BLOCKS,
  ...OTHER_ITEM_BLOCKS,
]).map((field) => ({ ...field, module: MODULE_OF_BLOCK.get(blockKeyOf(field)) ?? '' }));
