import type { PermissionAction } from '@visastack/core';
import { type AuditFieldValue, computeAuditHash } from '@visastack/db';
import { desc, sql } from 'drizzle-orm';
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

/**
 * Most recent audit events, platform-wide (master directive §7 "PR 7" —
 * platform admin nav's "Audit" destination). Read-only; callers are
 * responsible for checking the caller is a platform admin before exposing
 * this — the chain itself has no per-row access control since it spans every
 * tenant by design.
 */
export async function listRecentAuditEvents(db: Db, limit = 100): Promise<AuditEventRow[]> {
  return db.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.seq)).limit(limit);
}
