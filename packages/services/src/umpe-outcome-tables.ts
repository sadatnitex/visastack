/**
 * UMPE P12: whether the application attempt tables exist yet. The code ships before its migration
 * runs in production, so until then every reader answers "no attempts recorded" and every writer
 * refuses plainly. `to_regclass` never raises, so a surrounding transaction is never aborted. Only
 * "present" is remembered per database handle (a table is never dropped).
 */
import { sql } from 'drizzle-orm';
import type { Db } from './db';

const OUTCOME_TABLES = ['umpe_outcome_attempts', 'umpe_outcome_events'];
const present = new WeakSet<object>();

export async function outcomeTablesPresent(db: Db): Promise<boolean> {
  if (present.has(db)) return true;
  const checks = OUTCOME_TABLES.map((t) => sql`to_regclass(${t}::text) is not null`);
  const rows = await db
    .select({ found: sql<boolean>`(${sql.join(checks, sql` and `)})` })
    .from(sql`(select 1) as probe`);
  const found = rows[0]?.found === true;
  if (found) present.add(db);
  return found;
}

/** How an attempt was sent, the same six channels a submission report already uses. */
export const ATTEMPT_CHANNELS = [
  'EMBASSY_PORTAL',
  'EMAIL',
  'IN_PERSON',
  'COURIER',
  'VISA_APPLICATION_CENTER',
  'OTHER',
] as const;
export type AttemptChannel = (typeof ATTEMPT_CHANNELS)[number];

/**
 * What a record rests on. A person's own word stays SELF_REPORTED whoever they are; DOCUMENT_SUPPLIED
 * means they attached a document. There is no "verified": no channel exists that could check an
 * authority's action, and reading a letter never makes it one.
 */
export const EVIDENCE_BASES = ['SELF_REPORTED', 'DOCUMENT_SUPPLIED'] as const;
export type EvidenceBasis = (typeof EVIDENCE_BASES)[number];

export const ATTEMPT_EVENT_KINDS = ['AUTHORITY_RECEIPT', 'AUTHORITY_REQUEST', 'DECISION'] as const;
export type AttemptEventKind = (typeof ATTEMPT_EVENT_KINDS)[number];

/** The five decisions a case outcome already uses, plus a reported wait. Unknown is no record. */
export const ATTEMPT_DECISIONS = [
  'PENDING',
  'APPROVED',
  'REFUSED',
  'WITHDRAWN',
  'CANCELLED',
  'OTHER',
] as const;
export type AttemptDecision = (typeof ATTEMPT_DECISIONS)[number];

/** Who at the authority side asked for more. An agency is never one of them. */
export const AUTHORITY_REQUEST_SOURCES = [
  'EMBASSY_OR_CONSULATE',
  'VISA_APPLICATION_CENTER',
  'IMMIGRATION_AUTHORITY',
  'OTHER_AUTHORITY',
] as const;
export type AuthorityRequestSource = (typeof AUTHORITY_REQUEST_SOURCES)[number];

export const ATTEMPT_BINDINGS = ['PACKAGE_HANDOFF', 'SNAPSHOT_ONLY', 'NONE'] as const;
export type AttemptBinding = (typeof ATTEMPT_BINDINGS)[number];

/** At most this many document kinds in one authority request. */
export const MAX_REQUESTED_DOC_TYPES = 20;
