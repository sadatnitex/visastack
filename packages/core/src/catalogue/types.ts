import type { ProfilePack } from '../domain';

/**
 * Master Profile catalogue: shared types and policy tables.
 *
 * The catalogue is DATA, not behaviour. Nothing here is read by a screen, a
 * rule, a sharing grant or the AI extraction prompt yet (Phase 1 of the Master
 * Profile enrichment, docs/product/master-profile-enrichment/IMPLEMENTATION-PLAN.md).
 * Phase 2 wires consumers to it. Until then the only live registry is
 * apps/web/src/lib/profile-fields.ts, frozen by LEGACY_FIELD_SNAPSHOT.
 */

/** Where an entry came from, so every line can be traced and reviewed. */
export const PROVENANCES = ['visastack', 'bidesh365', 'owner_vision', 'proposed'] as const;
/**
 * visastack: already live in VisaStack.
 * bidesh365: taken from the other product's registry or document lists (read-only reference).
 * owner_vision: from the owner-approved enrichment vision (areas and layers).
 * proposed: added by this work from general knowledge; needs adviser or owner sign-off and is
 *   never presented as verified.
 */
export type Provenance = (typeof PROVENANCES)[number];

export const FIELD_SENSITIVITIES = ['STANDARD', 'SENSITIVE', 'RESTRICTED'] as const;
export type FieldSensitivity = (typeof FIELD_SENSITIVITIES)[number];

/**
 * What a field holds. The kind decides the lowest protection a field may have, so protection
 * is policy that a guard enforces, not a per-field opinion that can drift.
 */
export const FIELD_KINDS = [
  'general',
  'third_party',
  'personal_date',
  'identifier',
  'national_identifier',
  'amount',
  'health_admin',
  'health_detail',
  'legal_history',
  'special_category',
  'biometric',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** The lowest protection each kind may carry. A field may be raised above it, never lowered. */
export const PROTECTION_FLOOR: Readonly<Record<FieldKind, FieldSensitivity>> = {
  general: 'STANDARD',
  third_party: 'STANDARD',
  personal_date: 'SENSITIVE',
  identifier: 'SENSITIVE',
  national_identifier: 'RESTRICTED',
  amount: 'SENSITIVE',
  health_admin: 'SENSITIVE',
  health_detail: 'RESTRICTED',
  legal_history: 'RESTRICTED',
  special_category: 'RESTRICTED',
  biometric: 'RESTRICTED',
};

const SENSITIVITY_RANK: Readonly<Record<FieldSensitivity, number>> = {
  STANDARD: 0,
  SENSITIVE: 1,
  RESTRICTED: 2,
};

export function sensitivityAtLeast(actual: FieldSensitivity, floor: FieldSensitivity): boolean {
  return SENSITIVITY_RANK[actual] >= SENSITIVITY_RANK[floor];
}

/** The ten layers of the enriched profile. Layers are presentation only; packs decide sharing. */
export const LAYER_KEYS = [
  'identity',
  'travel_documents',
  'timelines',
  'money',
  'people',
  'declarations',
  'health',
  'qualifications',
  'purpose_packs',
  'country_packs',
] as const;
export type LayerKey = (typeof LAYER_KEYS)[number];

export interface LayerDef {
  readonly key: LayerKey;
  readonly label: string;
  readonly description: string;
}

/** Families of purposes (see purposes.ts). A field applies to all purposes or to some families. */
export const PURPOSE_FAMILY_KEYS = [
  'visit',
  'study',
  'work',
  'settle',
  'protection',
  'after_decision',
  'supporting',
  'beyond',
] as const;
export type PurposeFamilyKey = (typeof PURPOSE_FAMILY_KEYS)[number];

/**
 * Sharing categories that do NOT exist yet in PROFILE_PACKS. A grant validates its categories
 * against PROFILE_PACKS, so a field or document assigned to one of these can never be reached
 * through a grant until Phase 2 adds the pack deliberately. That is the safe default: new
 * sensitive data fails closed instead of riding on an existing broad grant.
 */
export const PROPOSED_PACK_KEYS = [
  'declarations',
  'study',
  'settle',
  'labour_migration',
  'official_travel',
  'bangladesh',
  'country_ids',
] as const;
export type ProposedPack = (typeof PROPOSED_PACK_KEYS)[number];

export type CataloguePack = ProfilePack | ProposedPack;

export interface ProposedPackDef {
  readonly key: ProposedPack;
  readonly label: string;
  readonly description: string;
  /** Why this is its own sharing category rather than part of an existing pack. */
  readonly rationale: string;
}

/**
 * Country and region scopes. A country-scoped group is only offered when the person's plan
 * involves that country; it is never a filter that hides data the person entered.
 */
export const COUNTRY_SCOPES = [
  'BD',
  'US',
  'GB',
  'CA',
  'AU',
  'NZ',
  'IE',
  'CH',
  'EU',
  'GCC',
  'JP',
  'KR',
  'CN',
  'SG',
  'MY',
  'TH',
  'BR',
  'MX',
  'IL',
  'AE',
  'ZA',
  'EG',
  'KE',
  'NG',
] as const;
export type CountryScope = (typeof COUNTRY_SCOPES)[number];

export type FieldDataType = 'text' | 'date';

/** One field in its final, resolved form. Keys are lower snake case and never reused. */
export interface CatalogueField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldDataType;
  readonly kind: FieldKind;
  readonly sensitivity: FieldSensitivity;
  readonly pack: CataloguePack;
  readonly layer: LayerKey;
  /** Repeating record name. Set only when the field belongs to a record that can repeat. */
  readonly group?: string;
  readonly groupLabel?: string;
  /** A named block of single (non-repeating) fields, for layout only. */
  readonly section?: string;
  readonly sectionLabel?: string;
  readonly options?: readonly string[];
  readonly appliesTo: 'all' | readonly PurposeFamilyKey[];
  readonly countries?: readonly CountryScope[];
  readonly origin: Provenance;
  /** Where to look to re-check it, for example "bidesh365:previous_names". */
  readonly sourceRef: string;
}

export const DOCUMENT_GROUP_KEYS = [
  'identity_civil',
  'travel_immigration',
  'financial',
  'employment_business',
  'education_qualifications',
  'medical',
  'legal_clearances',
  'family_relationship',
  'accommodation_host',
  'application_receipts',
  'photos_biometrics',
  'letters_statements',
  'translations_legalisations',
  'other_documents',
] as const;
export type DocumentGroupKey = (typeof DOCUMENT_GROUP_KEYS)[number];

export interface DocumentGroupDef {
  readonly key: DocumentGroupKey;
  readonly label: string;
  readonly description: string;
}

export interface DocumentHandling {
  readonly translation?: boolean;
  readonly notarisation?: boolean;
  readonly legalisation?: boolean;
  readonly original?: boolean;
}

/** One document type. Keys are upper snake case, stored as free text in documents.docType. */
export interface CatalogueDocument {
  readonly key: string;
  readonly label: string;
  readonly group: DocumentGroupKey;
  /** Sharing category. null means "no category", exactly how an unmapped type behaves today. */
  readonly pack: CataloguePack | null;
  /** Other names this type is known by, including other products' keys. Never another entry's key. */
  readonly aliases: readonly string[];
  /** How long it counts as current, in months. null means it does not lapse by age. */
  readonly validityMonths: number | null;
  readonly handling: DocumentHandling;
  /** Field keys this document can support. Advisory evidence links, not auto-fill rules. */
  readonly supports: readonly string[];
  /** True only for the types VisaStack's classifier can recognise today. */
  readonly recognisedToday: boolean;
  readonly origin: Provenance;
  readonly sourceRef: string;
}

export const PURPOSE_HANDLINGS = ['standard', 'adviser_review', 'adviser_only'] as const;
/**
 * standard: offered normally.
 * adviser_review: offered, but wording and rules need adviser review before anything is promised.
 * adviser_only: never offered as a self-serve route; a person at the agency handles it.
 */
export type PurposeHandling = (typeof PURPOSE_HANDLINGS)[number];

export interface PurposeFamilyDef {
  readonly key: PurposeFamilyKey;
  readonly label: string;
  readonly description: string;
}

export interface CataloguePurpose {
  readonly key: string;
  readonly label: string;
  readonly family: PurposeFamilyKey;
  /** Plain-language hint of the evidence themes. General knowledge, not verified rules. */
  readonly evidenceThemes: string;
  readonly handling: PurposeHandling;
  /** Any extra caution, for example that rules vary a lot between countries. */
  readonly note?: string;
  readonly origin: Provenance;
}
