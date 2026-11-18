import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import peopleJson from './people.json';

/**
 * The two made-up people of the signed-in guard (docs/operations/ci-signed-in-guard.md). Their
 * fixed identity lives in people.json, shared with the stand-in sign-in service; their session
 * tokens are random for every run (written by the stand-in) and their record ids come from the
 * seed of that run. Both are read from the run folder named by CI_SIGNED_IN_RUN_DIR.
 */
export type Role = keyof typeof peopleJson;

export interface PersonIdentity {
  readonly role: Role;
  readonly providerId: string;
  readonly email: string;
  readonly name: string;
}

/** Ids the seed made for this run (seed.ts writes them to seeded.json). */
export interface SeededIds {
  readonly travellerAccountId: string;
  readonly applicantId: string;
  readonly caseId: string;
  readonly caseTitle: string;
  readonly documentIds: readonly string[];
  readonly agencyAdminAccountId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly grantId: string;
}

export interface Person extends PersonIdentity {
  /** The session token the browser carries (random per run). */
  readonly token: string;
}

export const ROLES: readonly Role[] = Object.keys(peopleJson) as Role[];

export function identity(role: Role): PersonIdentity {
  return peopleJson[role] as PersonIdentity;
}

/** Variable-keyed read (satisfies both the index-signature type rule and the literal-key lint rule). */
export function envValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return env[name];
}

/** The run folder shared by the stand-in, the seed and the browser tests. */
export function runDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const dir = envValue(env, 'CI_SIGNED_IN_RUN_DIR');
  if (!dir)
    throw new Error('CI_SIGNED_IN_RUN_DIR is not set (see docs/operations/ci-signed-in-guard.md).');
  return dir;
}

function readRunFile<T>(name: string): T {
  return JSON.parse(readFileSync(join(runDir(), name), 'utf8')) as T;
}

/** A made-up person with this run's session token. */
export function person(role: Role): Person {
  const tokens = readRunFile<Record<string, string>>('tokens.json');
  const token = tokens[role];
  if (!token) throw new Error(`No stand-in session token for ${role}.`);
  return { ...identity(role), token };
}

/** The records the seed made for this run. */
export function seeded(): SeededIds {
  return readRunFile<SeededIds>('seeded.json');
}
