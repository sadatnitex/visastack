import { createHash } from 'node:crypto';

/**
 * Tamper-evident audit hashing (Build Spec §14).
 *
 * Each audit event stores `hash = sha256(prevHash + canonical(fields))`,
 * forming a chain: altering any historical event breaks every subsequent
 * hash. Combined with the database-level append-only rules, this makes the
 * audit trail both immutable and verifiable.
 *
 * In production the read-latest-then-append must run inside a serialized
 * transaction so the chain has no gaps under concurrency; this module
 * provides the pure hashing primitives that layer sits on.
 */

export type AuditFieldValue = string | number | boolean | null;

/** Deterministic, key-sorted serialization of the hashed fields. */
export function canonicalizeAuditFields(fields: Readonly<Record<string, AuditFieldValue>>): string {
  const keys = Object.keys(fields).sort();
  return JSON.stringify(fields, keys);
}

/** Compute the chained hash for an event given the previous event's hash. */
export function computeAuditHash(
  fields: Readonly<Record<string, AuditFieldValue>>,
  prevHash: string | null,
): string {
  const canonical = canonicalizeAuditFields(fields);
  return createHash('sha256')
    .update(`${prevHash ?? ''}\n${canonical}`)
    .digest('hex');
}

/** Verify a chain of {prevHash, hash, fields} entries links correctly. */
export function verifyAuditChain(
  entries: ReadonlyArray<{
    readonly fields: Readonly<Record<string, AuditFieldValue>>;
    readonly prevHash: string | null;
    readonly hash: string;
  }>,
): boolean {
  let expectedPrev: string | null = null;
  for (const entry of entries) {
    if (entry.prevHash !== expectedPrev) return false;
    if (computeAuditHash(entry.fields, entry.prevHash) !== entry.hash) return false;
    expectedPrev = entry.hash;
  }
  return true;
}
