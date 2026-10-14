import type { CataloguePack, FieldKind } from '../types';
import { type FieldBlock, date, text } from './define';

/**
 * "Other" for sections. A section cannot list everything a person might need to record, so every
 * sharing category has one free "Other Item" record: what it is, its value or details, a date and a
 * note. The first field names the section it belongs to, so a screen can show it inside that section.
 *
 * The protection of the free text follows the category, not the section: an Other Item in a health
 * section is as protected as a vaccination, and one in a declarations section as a criminal record.
 * Nothing here counts toward completion, because it is optional by nature.
 */
const OTHER_ITEM_PACKS: readonly {
  readonly pack: CataloguePack;
  readonly label: string;
  readonly kind: FieldKind;
}[] = [
  { pack: 'universal', label: 'Universal', kind: 'general' },
  { pack: 'professional', label: 'Professional', kind: 'general' },
  { pack: 'business', label: 'Business', kind: 'general' },
  { pack: 'medical', label: 'Medical', kind: 'health_detail' },
  { pack: 'medical_attendant', label: 'Medical Attendant', kind: 'general' },
  { pack: 'declarations', label: 'Declarations', kind: 'legal_history' },
  { pack: 'study', label: 'Study', kind: 'general' },
  { pack: 'settle', label: 'Settle', kind: 'general' },
  { pack: 'labour_migration', label: 'Labour Migration', kind: 'identifier' },
  { pack: 'official_travel', label: 'Official Travel', kind: 'general' },
  { pack: 'bangladesh', label: 'Bangladesh', kind: 'national_identifier' },
  { pack: 'country_ids', label: 'Country Identifiers', kind: 'national_identifier' },
];

export const OTHER_ITEM_BLOCKS: readonly FieldBlock[] = OTHER_ITEM_PACKS.map(
  ({ pack, label, kind }): FieldBlock => ({
    layer: 'identity',
    pack,
    origin: 'owner_vision',
    sourceRef: 'owner decision 2026-10-14: every section always keeps an Other option',
    prefix: `other_item_${pack}`,
    group: { key: `other_item_${pack}`, label: `Other Item (${label})` },
    role: 'other_item',
    rows: [
      text('section', 'Section'),
      text('title', 'What It Is'),
      text('details', 'Details or Value', kind),
      date('date', 'Date'),
      text('note', 'Note', kind),
    ],
  }),
);
