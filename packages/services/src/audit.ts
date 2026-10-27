import type { PermissionAction } from '@visastack/core';
import { type AuditFieldValue, computeAuditHash } from '@visastack/db';
import { desc, eq, sql } from 'drizzle-orm';
import { type Db, first, required, schema } from './db';

/**
 * The append-only, tamper-evident audit sink (Build Spec §14).
 *
 * `appendAuditEvent` runs INSIDE the caller's transaction so a mutation and
 * its audit record commit or roll back together — fail-closed. Within that
 * transaction it takes a session advisory lock, reads the current chain head,
 * and appends `hash = sha256(prevHash + canonical(fields))`. The lock
 * serializes concurrent appends so the chain has no gaps or forks; the
 * database-level append-only rules make historical rows immutable.
 */

/** Namespaced lock key for the audit chain (arbitrary, stable constant). */
const AUDIT_CHAIN_LOCK_KEY = 4_242_042;

/**
 * Hold the audit chain's lock for the rest of this transaction, so no event can be appended until
 * it ends. For a decision that must not miss an event committed while it is being made.
 */
export async function lockAuditChain(tx: Db): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);
}

/** Fields that are semantically meaningful and therefore covered by the hash. */
export interface AuditEventInput {
  readonly eventType: string;
  readonly actorAccountId?: string | null;
  readonly actorRole?: string | null;
  readonly action?: PermissionAction | null;
  readonly result?: 'ALLOWED' | 'DENIED' | null;
  readonly method?: 'MANUAL' | 'DOCUMENT' | 'API' | 'SYSTEM' | null;
  readonly applicantId?: string | null;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  readonly missionId?: string | null;
  readonly grantId?: string | null;
  readonly reason?: string | null;
  readonly ip?: string | null;
  readonly device?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

/** Deterministic, key-sorted serialization of an arbitrary JSON value. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

/** Build the flat, canonical field map that the chain hash is computed over. */
function hashedFields(input: AuditEventInput): Record<string, AuditFieldValue> {
  return {
    eventType: input.eventType,
    actorAccountId: input.actorAccountId ?? null,
    actorRole: input.actorRole ?? null,
    action: input.action ?? null,
    result: input.result ?? null,
    method: input.method ?? null,
    applicantId: input.applicantId ?? null,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    missionId: input.missionId ?? null,
    grantId: input.grantId ?? null,
    reason: input.reason ?? null,
    metadata: input.metadata ? stableStringify(input.metadata) : null,
  };
}

export type AuditEventRow = typeof schema.auditEvents.$inferSelect;

/**
 * Append one event to the chain. Call ONLY from within a transaction (`tx`);
 * the surrounding mutation and this append must be atomic.
 */
export async function appendAuditEvent(tx: Db, input: AuditEventInput): Promise<AuditEventRow> {
  // Serialize appends so the read-head-then-insert is race-free.
  await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);

  const head = first(
    await tx
      .select({ hash: schema.auditEvents.hash })
      .from(schema.auditEvents)
      .orderBy(desc(schema.auditEvents.seq))
      .limit(1),
  );
  const prevHash = head?.hash ?? null;
  const hash = computeAuditHash(hashedFields(input), prevHash);

  const row = required(
    first(
      await tx
        .insert(schema.auditEvents)
        .values({
          eventType: input.eventType,
          actorAccountId: input.actorAccountId ?? null,
          actorRole: input.actorRole ?? null,
          action: input.action ?? null,
          result: input.result ?? null,
          method: input.method ?? null,
          applicantId: input.applicantId ?? null,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          missionId: input.missionId ?? null,
          grantId: input.grantId ?? null,
          reason: input.reason ?? null,
          ip: input.ip ?? null,
          device: input.device ?? null,
          metadata: input.metadata ?? null,
          prevHash,
          hash,
        })
        .returning(),
    ),
    'audit event',
  );
  return row;
}

/** The field map the chain hash covers, rebuilt from a stored row. */
function hashedFieldsOfRow(row: AuditEventRow): Record<string, AuditFieldValue> {
  return hashedFields({
    eventType: row.eventType,
    actorAccountId: row.actorAccountId,
    actorRole: row.actorRole,
    action: row.action,
    result: row.result,
    method: row.method,
    applicantId: row.applicantId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    missionId: row.missionId,
    grantId: row.grantId,
    reason: row.reason,
    metadata: row.metadata as Record<string, unknown> | null,
  });
}

export interface AuditChainCheck {
  /** How many of the newest events were examined. */
  readonly checked: number;
  /** The sequence number of the first event whose `prevHash` is not the event before it, or `null`. */
  readonly firstBrokenLinkSeq: number | null;
  /** Events whose stored hash does not match a recomputation from their own fields. */
  readonly hashMismatches: number;
}

/**
 * Checks the newest `limit` audit events (OPS-03 "audit failures"). A broken link
 * means an event was removed, inserted or reordered. A hash mismatch means an
 * event's fields differ from what was hashed, which is tampering or, less
 * seriously, a metadata value that does not survive a JSON round trip the way it
 * was hashed; the two are reported separately so a serialisation quirk cannot be
 * mistaken for a missing event.
 */
export async function checkRecentAuditChain(db: Db, limit = 500): Promise<AuditChainCheck> {
  const newestFirst = await db
    .select()
    .from(schema.auditEvents)
    .orderBy(desc(schema.auditEvents.seq))
    .limit(limit);
  const rows = [...newestFirst].reverse();
  let firstBrokenLinkSeq: number | null = null;
  let hashMismatches = 0;
  rows.forEach((row, index) => {
    const before = rows[index - 1];
    if (before && row.prevHash !== before.hash && firstBrokenLinkSeq === null) {
      firstBrokenLinkSeq = row.seq;
    }
    if (computeAuditHash(hashedFieldsOfRow(row), row.prevHash) !== row.hash) hashMismatches++;
  });
  return { checked: rows.length, firstBrokenLinkSeq, hashMismatches };
}

/** One applicant-scoped audit event, with its actor already resolved to a human-recognizable email (never a raw account id, matching how every other "who did this" surface in this codebase - wallet.ts, the sharing page's own recipient labels - already resolves identity). */
export interface ApplicantAuditEvent {
  readonly seq: number;
  readonly eventType: string;
  readonly actorEmail: string | null;
  readonly action: PermissionAction | null;
  readonly result: 'ALLOWED' | 'DENIED' | null;
  readonly occurredAt: Date;
}

/**
 * SHR-03: "show recipient, reason, scope, expiry, accesses and revocation
 * controls" -- this is the "accesses" part, the applicant's own transparent
 * log of what actually happened to their data (not merely what a grant
 * theoretically permits, which the sharing page already shows separately).
 * Owner-only; every event already carries `applicantId` at write time
 * (`appendAuditEvent`'s own required field for anything applicant-scoped),
 * so this needed no new schema, just a scoped read that didn't exist yet
 * (the platform-admin `listRecentAuditEvents` in platform-reads.ts is deliberately
 * unscoped, spanning every tenant, and must never be reused for this).
 */
export async function listAuditEventsForApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
  limit = 100,
): Promise<ApplicantAuditEvent[]> {
  const applicant = first(
    await db
      .select({ ownerAccountId: schema.applicants.ownerAccountId })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, applicantId))
      .limit(1),
  );
  if (!applicant || applicant.ownerAccountId !== actorAccountId) return [];
  const rows = await db
    .select({
      seq: schema.auditEvents.seq,
      eventType: schema.auditEvents.eventType,
      actorEmail: schema.accounts.email,
      action: schema.auditEvents.action,
      result: schema.auditEvents.result,
      occurredAt: schema.auditEvents.occurredAt,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.auditEvents.actorAccountId))
    .where(eq(schema.auditEvents.applicantId, applicantId))
    .orderBy(desc(schema.auditEvents.seq))
    .limit(limit);
  return rows.map((r) => ({ ...r, actorEmail: r.actorEmail ?? null }));
}
