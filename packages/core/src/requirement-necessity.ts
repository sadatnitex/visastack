/**
 * The one definition of how necessary a requirement is (ADR 0026 D3).
 *
 * Necessity is authored on a requirement; provenance says who asked for it; an
 * alternative group says "any one of these satisfies it". These are three
 * separate questions, and none of them is a sharing category (`PROFILE_PACKS` /
 * `SHARING_CATEGORIES` are a different vocabulary and must never be mixed in).
 *
 * Legacy rows carry only the old `optional` boolean. It never distinguished
 * "recommended" from "optional", so a legacy optional row is read as OPTIONAL
 * (non-blocking) and nothing more is invented about it.
 */

export const REQUIREMENT_NECESSITIES = [
  'MANDATORY',
  'CONDITIONAL',
  'RECOMMENDED',
  'OPTIONAL',
] as const;
export type RequirementNecessity = (typeof REQUIREMENT_NECESSITIES)[number];

/**
 * FIELD_OBSERVATION (UMPE G2, S08): something seen across VisaStack cases, never an official
 * requirement. Nothing writes it automatically; an editor chooses it in Pack Studio, and it may
 * only be Recommended or Optional (`provenanceAllowsNecessity`).
 */
export const REQUIREMENT_PROVENANCES = [
  'OFFICIAL',
  'AGENCY_ADDED',
  'AUTHORITY_REQUESTED',
  'FIELD_OBSERVATION',
] as const;
export type RequirementProvenance = (typeof REQUIREMENT_PROVENANCES)[number];

export const REQUIREMENT_GROUP_MODES = ['ANY_OF'] as const;
export type RequirementGroupMode = (typeof REQUIREMENT_GROUP_MODES)[number];

/** The parts of a stored requirement this module reads. Extra fields are ignored. */
export interface NecessitySource {
  readonly optional: boolean;
  readonly necessity?: RequirementNecessity | null;
  readonly provenance?: RequirementProvenance | null;
}

export function isRequirementNecessity(value: unknown): value is RequirementNecessity {
  return (
    typeof value === 'string' && (REQUIREMENT_NECESSITIES as readonly string[]).includes(value)
  );
}

export function isRequirementProvenance(value: unknown): value is RequirementProvenance {
  return (
    typeof value === 'string' && (REQUIREMENT_PROVENANCES as readonly string[]).includes(value)
  );
}

/** The authored necessity, or the honest reading of a legacy row. */
export function requirementNecessity(source: NecessitySource): RequirementNecessity {
  if (source.necessity) return source.necessity;
  return source.optional ? 'OPTIONAL' : 'MANDATORY';
}

/** Who asked for it; a row with no provenance is an official requirement. */
export function requirementProvenance(source: NecessitySource): RequirementProvenance {
  return source.provenance ?? 'OFFICIAL';
}

/** Only an official requirement may be presented as one; every other provenance says whose it is. */
export function isOfficialProvenance(provenance: RequirementProvenance): boolean {
  return provenance === 'OFFICIAL';
}

/**
 * Whether a provenance may carry a necessity. A field observation is never a mandate, so it is only
 * ever Recommended or Optional (annex 1.1: field observations are non-blocking guidance).
 */
export function provenanceAllowsNecessity(
  provenance: RequirementProvenance,
  necessity: RequirementNecessity,
): boolean {
  if (provenance !== 'FIELD_OBSERVATION') return true;
  return necessity === 'RECOMMENDED' || necessity === 'OPTIONAL';
}

/**
 * Whether a missing item of this necessity can block "requirement complete".
 * CONDITIONAL blocks only once its condition is known to be true; the caller
 * evaluates the condition (unknown stays Unverified, never satisfied).
 */
export function necessityCanBlock(necessity: RequirementNecessity): boolean {
  return necessity === 'MANDATORY' || necessity === 'CONDITIONAL';
}

/**
 * The legacy `optional` column value a necessity implies, so that older readers
 * of the same row keep agreeing: only MANDATORY and CONDITIONAL are required.
 */
export function optionalFlagFor(necessity: RequirementNecessity): boolean {
  return !necessityCanBlock(necessity);
}

/** Plain, Title Case labels for people (never the stored enum words). */
export const NECESSITY_LABELS: Readonly<Record<RequirementNecessity, string>> = {
  MANDATORY: 'Mandatory',
  CONDITIONAL: 'Mandatory If It Applies',
  RECOMMENDED: 'Recommended',
  OPTIONAL: 'Optional',
};

export const PROVENANCE_LABELS: Readonly<Record<RequirementProvenance, string>> = {
  OFFICIAL: 'Official Requirement',
  AGENCY_ADDED: 'Requested by Your Agency',
  AUTHORITY_REQUESTED: 'Requested by the Authority',
  FIELD_OBSERVATION: 'Observed in VisaStack Cases',
};

export const ANY_OF_LABEL = 'Any One of These';
