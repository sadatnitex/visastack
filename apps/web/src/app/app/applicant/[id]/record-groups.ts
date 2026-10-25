import {
  CATALOGUE_DOCUMENT_GROUPS,
  CATALOGUE_LAYERS,
  type DocumentGroupKey,
  resolveDocumentType,
} from '@visastack/core/catalogue';

/**
 * Where a document sits on the Record, and whether it carries an expiry (WP-V3 part 2). Server
 * only: it reads the catalogue, which stays out of the browser. Every name shown comes from the
 * catalogue's own plain labels; no key or sharing pack name is ever shown.
 */

/** The group for a document with no kind, or a kind the catalogue does not know. */
export const OTHER_DOCUMENTS = 'Other Documents';

/**
 * A document group that holds the same things as a profile area uses that area's name, so a
 * passport sits beside the identity details and a bank statement beside the money details.
 * Every other group keeps the catalogue's own document group name.
 */
const SAME_AS_PROFILE_AREA: Partial<
  Record<DocumentGroupKey, (typeof CATALOGUE_LAYERS)[number]['key']>
> = {
  identity_civil: 'identity',
  travel_immigration: 'travel_documents',
  financial: 'money',
  education_qualifications: 'qualifications',
  medical: 'health',
  family_relationship: 'people',
};

const LAYER_LABELS = new Map(CATALOGUE_LAYERS.map((layer) => [layer.key, layer.label] as const));
const GROUP_LABELS = new Map(
  CATALOGUE_DOCUMENT_GROUPS.map((group) => [group.key, group.label] as const),
);

/** The plain name of a catalogue document group, as the Record shows it. */
export function documentGroupLabel(group: DocumentGroupKey): string {
  const area = SAME_AS_PROFILE_AREA[group];
  const areaLabel = area ? LAYER_LABELS.get(area) : undefined;
  return areaLabel ?? GROUP_LABELS.get(group) ?? OTHER_DOCUMENTS;
}

/** The Record group for a document of this kind. */
export function recordGroupOfDocType(docType: string | null): string {
  const type = docType ? resolveDocumentType(docType) : undefined;
  return type ? documentGroupLabel(type.group) : OTHER_DOCUMENTS;
}

/** A detail that holds the end of a document's validity (passport expiry, visa validity and the like). */
const EXPIRY_FIELD = /_(?:expiry|expiry_date|valid_until|validity)$/;

/**
 * True when a document of this kind has an end date of its own: its catalogue entry reads an
 * expiry or validity detail (passport, residence or work permit, visa, insurance, clearances and
 * the like). A bank statement only needs to be recent, so it has no expiry to confirm.
 */
export function docTypeCarriesExpiry(docType: string | null): boolean {
  const type = docType ? resolveDocumentType(docType) : undefined;
  return type?.supports.some((field) => EXPIRY_FIELD.test(field)) ?? false;
}
