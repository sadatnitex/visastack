import {
  type RandomBytes,
  type ReferenceKind,
  formatReferenceCode,
  generateReferenceCode,
} from '@visastack/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type Db, first, schema } from './db';

/**
 * Visible reference codes (ADR 0018): the registry side. The format itself
 * lives in packages/core/src/reference-code.ts.
 *
 * Between a deploy and migration 0091 the `reference_codes` table does not
 * exist. Creating a record must never fail because of that, so assigning a
 * code is skipped and reading codes returns nothing (no code is shown; never
 * a placeholder). The migration backfills every record made in that window.
 * Presence is checked with `to_regclass`, which never raises, so a
 * surrounding transaction is never aborted; only "present" is remembered per
 * database handle (the table is never dropped), "missing" is asked again.
 */

const REGISTRY_RELATION = 'reference_codes';
const PRESENT = new WeakSet<object>();

/** Collisions in one assignment before new codes get one more random character. */
const LENGTHEN_AFTER_COLLISIONS = 3;

/** Attempts in one assignment before giving up (each a fresh random code). */
const MAX_ATTEMPTS = 8;

/** Whether migration 0091 has created the registry on this database. */
export async function referenceCodesTablePresent(db: Db): Promise<boolean> {
  if (PRESENT.has(db)) return true;
  const rows = await db
    .select({ present: sql<boolean>`to_regclass(${REGISTRY_RELATION}::text) is not null` })
    .from(sql`(select 1) as probe`);
  const present = rows[0]?.present === true;
  if (present) PRESENT.add(db);
  return present;
}

/**
 * Gives one record its visible code, inside the transaction that creates it,
 * and returns the stored code (no prefix). Idempotent: a record that already
 * has a code keeps it. A collision with another record's code is retried with
 * a fresh code; after `LENGTHEN_AFTER_COLLISIONS` collisions in a row the new
 * codes get one more random character (the space for that type is getting
 * full), with no change to codes already given. Returns null while the
 * registry does not exist yet (the migration's backfill covers the record).
 * Never writes personal data: only the type, the code and the record id.
 */
export async function assignReferenceCode(
  tx: Db,
  kind: ReferenceKind,
  entityId: string,
  options: { readonly random?: RandomBytes } = {},
): Promise<string | null> {
  if (!(await referenceCodesTablePresent(tx))) return null;
  const codes = schema.referenceCodes;
  const existing = async () =>
    first(
      await tx
        .select({ code: codes.code })
        .from(codes)
        .where(and(eq(codes.kind, kind), eq(codes.entityId, entityId)))
        .limit(1),
    )?.code ?? null;
  const already = await existing();
  if (already) return already;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const payloadLength = attempt >= LENGTHEN_AFTER_COLLISIONS ? 6 : 5;
    const code = generateReferenceCode(kind, {
      payloadLength,
      ...(options.random ? { random: options.random } : {}),
    });
    // No conflict target: a clash on the code (another record has it) and a
    // clash on the record (assigned at the same moment) both write nothing.
    const inserted = await tx
      .insert(codes)
      .values({ kind, code, entityId })
      .onConflictDoNothing()
      .returning({ code: codes.code });
    if (inserted[0]) return inserted[0].code;
    const raced = await existing();
    if (raced) return raced;
  }
  throw new Error(`could not assign a ${kind} reference code after ${MAX_ATTEMPTS} attempts`);
}

/** `assignReferenceCode` for many records of one type (preview and load data). Returns how many have a code. */
export async function assignReferenceCodes(
  tx: Db,
  kind: ReferenceKind,
  entityIds: readonly string[],
): Promise<number> {
  let assigned = 0;
  for (const id of entityIds) if (await assignReferenceCode(tx, kind, id)) assigned += 1;
  return assigned;
}

/**
 * The visible codes (`C-7K2Q9M`) of records the caller has already been
 * allowed to read, in one query. Records without a code, and every record
 * while the registry does not exist yet, are simply absent from the map.
 * Reads only the registry: a code says nothing about the record.
 */
export async function referenceCodesFor(
  db: Db,
  kind: ReferenceKind,
  entityIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(entityIds)];
  if (ids.length === 0 || !(await referenceCodesTablePresent(db))) return new Map();
  const codes = schema.referenceCodes;
  const rows = await db
    .select({ entityId: codes.entityId, code: codes.code })
    .from(codes)
    .where(and(eq(codes.kind, kind), inArray(codes.entityId, ids)));
  return new Map(rows.map((row) => [row.entityId, formatReferenceCode(kind, row.code)] as const));
}

/** The visible code of one record the caller may already read, or null. */
export async function referenceCodeFor(
  db: Db,
  kind: ReferenceKind,
  entityId: string,
): Promise<string | null> {
  return (await referenceCodesFor(db, kind, [entityId])).get(entityId) ?? null;
}

/**
 * The record id a parsed code names, from the registry alone, or null. Says
 * nothing about whether the caller may see that record: every caller must
 * check access next and answer a refusal exactly like a missing code.
 */
export async function findReferenceEntity(
  db: Db,
  kind: ReferenceKind,
  code: string,
): Promise<string | null> {
  if (!(await referenceCodesTablePresent(db))) return null;
  const codes = schema.referenceCodes;
  return (
    first(
      await db
        .select({ entityId: codes.entityId })
        .from(codes)
        .where(and(eq(codes.kind, kind), eq(codes.code, code)))
        .limit(1),
    )?.entityId ?? null
  );
}
