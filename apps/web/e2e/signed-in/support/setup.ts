/**
 * What the on-demand staging suite needs from its environment, and how it fails when something is
 * missing. A journey that cannot run FAILS with a message that starts with "BLOCKED:" and names
 * the missing setting (the name only, never a value). It never skips and never passes: a skipped
 * journey looks like a passed one in a summary, which is exactly what this suite must not allow.
 *
 * The same names are listed in scripts/check-staging-journey-setup.mjs (which the workflow runs
 * first) and in docs/operations/staging-journeys.md; scripts/staging-journeys.test.mjs keeps the
 * three in step.
 */

/** Variable-keyed env read (avoids the index-signature lint and type rules). */
function read(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** A setting this journey cannot run without. Throws BLOCKED naming it. */
export function configured(name: string): string {
  const value = read(name);
  if (!value) throw new Error(`BLOCKED: missing staging setting ${name}`);
  return value;
}

/** A setting that may be absent (a journey that can do without it asks this, never `configured`). */
export function optional(name: string): string | undefined {
  return read(name);
}

/**
 * A fact the owner confirms by setting a variable to "true" once it is so (for example that the
 * exact-copy service is deployed and migrated on the staging database). Anything else is BLOCKED.
 */
export function confirmed(name: string, because: string): void {
  if (read(name) !== 'true') {
    throw new Error(`BLOCKED: ${name} is not "true". ${because}`);
  }
}

/** Fails closed for a journey whose feature the deployed target has not shown it has. */
export function blocked(reason: string): never {
  throw new Error(`BLOCKED: ${reason}`);
}

/** The synthetic people. Three distinct accounts: a traveller and two unrelated agencies. */
export const ROLES = ['TRAVELLER', 'AGENCY_ADMIN', 'UNRELATED_AGENCY_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export function credentials(role: Role): { email: string; password: string } {
  return {
    email: configured(`NEON_STAGING_${role}_EMAIL`),
    password: configured(`NEON_STAGING_${role}_PASSWORD`),
  };
}

/** The record ids the owner seeded (see docs/operations/staging-journeys.md). */
export const ids = {
  traveller: () => configured('E2E_TRAVELLER_ID'),
  case: () => configured('E2E_CASE_ID'),
  agencyOrg: () => configured('E2E_AGENCY_ORG_ID'),
  unrelatedAgencyOrg: () => configured('E2E_UNRELATED_AGENCY_ORG_ID'),
};

/** A well-formed id that belongs to nobody, for "missing looks the same as denied" checks. */
export const NOBODY = '00000000-0000-4000-8000-000000000000';
