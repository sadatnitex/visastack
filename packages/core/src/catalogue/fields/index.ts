import type { CatalogueField } from '../types';
import { COUNTRY_PACK_BLOCKS } from './country-packs';
import { DECLARATION_BLOCKS } from './declarations';
import { buildFields } from './define';
import { HEALTH_BLOCKS } from './health';
import { IDENTITY_BLOCKS } from './identity';
import { MONEY_BLOCKS } from './money';
import { PEOPLE_BLOCKS } from './people';
import { PURPOSE_PACK_BLOCKS } from './purpose-packs';
import { QUALIFICATION_BLOCKS } from './qualifications';
import { TIMELINE_BLOCKS } from './timelines';
import { TRAVEL_DOCUMENT_BLOCKS } from './travel-documents';

/** Every field added by the enrichment, in layer order. The 81 live fields are not repeated here. */
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
]);
