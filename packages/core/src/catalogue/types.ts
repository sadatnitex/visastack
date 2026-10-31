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
  /** The opt-in section this field belongs to. Set for every field once the catalogue is built. */
  readonly module: string;
  /**
   * What the field is for beyond holding a value. Fields with a role never count toward completion:
   * other_detail: the text box that opens when a choice is "Other".
   * other_item: a free entry for something the section has no field for.
   * amount_detail: an optional fact about a live amount, shown beside it (whether it is before or
   * after tax). Left blank, it reads as not recorded, never as a guess.
   */
  readonly role?: FieldRole;
  /** A choice field that accepts "Other" and then needs its companion `<key>_other` filled. */
  readonly allowOther?: boolean;
}

export const FIELD_ROLES = ['other_detail', 'other_item', 'amount_detail'] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

/** The value a person picks when none of the listed choices fits. */
export const OTHER_OPTION = 'Other' as const;

/**
 * An opt-in section of the profile. Every field belongs to exactly one module. Modules marked
 * defaultOpen hold only fields that are live today and common to nearly everyone; every other
 * module is visible but locked until the person ticks it, and opening one adds its fields to the
 * completion calculation straight away. A module that already holds saved values is always open,
 * so nothing a person entered is ever hidden.
 */
export interface CatalogueModule {
  readonly key: string;
  readonly label: string;
  /** One plain sentence: what it holds and who needs it. */
  readonly description: string;
  readonly layer: LayerKey;
  readonly pack: CataloguePack;
  readonly defaultOpen: boolean;
  /** Extra detail for a section that is open by default. Opens separately, never changes the base. */
  readonly extends?: string;
  /** Block keys from the field catalogue: "S:<section>" for single fields, "G:<record>" for a record. */
  readonly blocks: readonly string[];
  /** Internal sections hold shared plumbing (the Other Item records). They are never listed or counted. */
  readonly internal?: boolean;
  /** Live fields that belong here (these are not in the catalogue field list). */
  readonly legacyFields?: readonly string[];
  /** Live repeating records that belong here. */
  readonly legacyGroups?: readonly string[];
  /** Purpose families this section is suggested for. A suggestion only, never a requirement. */
  readonly suggestedFor?: readonly PurposeFamilyKey[];
  /**
   * Two-letter codes of the countries this section is about. When the person has a case for a
   * purpose family this section is suggested for, and every such case names a country, the
   * section is suggested only if one of those countries is listed here. With no such case, it is
   * suggested as usual. A suggestion only, never a requirement.
   */
  readonly suggestedForCountries?: readonly string[];
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
