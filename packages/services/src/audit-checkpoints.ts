import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { desc, eq, gt } from 'drizzle-orm';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Periodic, externally-signed audit-chain checkpoints (Commercial V1 SEC-04).
 *
 * `audit_events`' append-only database RULEs (migration 0000) stop the
 * application's own runtime credential from editing or deleting history.
 * They do not stop a party with full database DDL access, who could drop
 * the rule, edit rows, and recreate it — nothing inside the database alone
 * would show that happened. A checkpoint closes that gap: `signature` is an
 * HMAC-SHA256 over `(fromSeq, toSeq, chainHeadHash)` keyed by a secret this
 * function takes as an explicit parameter and never reads from the
 * environment itself (mirroring `packages/services/src/step-up.ts`'s own
 * split between the pure service function and its env-resolving caller in
 * `apps/web`) — a party who can only read/write/alter the database cannot
 * forge a new valid signature for a tampered range, and cannot make an
 * EXISTING checkpoint's stored signature agree with a hash it no longer
 * matches, because the secret that produced it isn't stored alongside it.
 *
 * What this genuinely proves: a checkpoint verified successfully (both
 * `verifyCheckpointSignature` and `verifyCheckpointAgainstChain` pass) means
 * the audit_events rows from `fromSeq` to `toSeq` are exactly what they were
 * when this checkpoint was created, PROVIDED the verifier trusts the copy of
 * `signingSecret` it is checking against. What this does NOT yet provide:
 * an actual external anchor a compromised database operator cannot also
 * reach (the checkpoint row itself lives in the same database, protected
 * only by its own append-only RULEs, same caveat as audit_events itself).
 * True external anchoring — exporting checkpoints to a separate system, or
 * a real timestamping/transparency-log service — is not built here; this
 * session does not have such a service available to integrate against, and
 * is recorded as open work in docs/commercial-v1/known-issues.md rather
 * than assumed complete. Scheduling this to run periodically (a worker/cron
 * calling `createAuditCheckpoint` on an interval) is operational wiring for
 * a later part; this file delivers the capability, not its schedule.
 */

export type AuditCheckpoint = typeof schema.auditCheckpoints.$inferSelect;

function computeSignature(
  input: { readonly fromSeq: number; readonly toSeq: number; readonly chainHeadHash: string },
  signingSecret: string,
): string {
  return createHmac('sha256', signingSecret)
    .update(`${input.fromSeq}:${input.toSeq}:${input.chainHeadHash}`)
    .digest('hex');
}

/** The most recent checkpoint, if any. */
export async function getLatestAuditCheckpoint(db: Db): Promise<AuditCheckpoint | undefined> {
  return first(
    await db
      .select()
      .from(schema.auditCheckpoints)
      .orderBy(desc(schema.auditCheckpoints.toSeq))
      .limit(1),
  );
}

/** Every checkpoint ever created, newest first — the anchor history itself is never deleted. */
export async function listAuditCheckpoints(db: Db): Promise<AuditCheckpoint[]> {
  const rows = await db.select().from(schema.auditCheckpoints);
  return [...rows].sort((a, b) => b.toSeq - a.toSeq);
}

/**
 * Create a checkpoint covering every audit event since the last one (or
 * from the beginning, if none exists yet). A no-op — returns the existing
 * latest checkpoint rather than an error — when nothing has been appended
 * to the chain since it was created, since a periodic caller (a cron tick
 * with nothing new to cover) hitting that case is routine, not a fault.
 */
export async function createAuditCheckpoint(
  db: Db,
  signingSecret: string,
  signingKeyVersion: string,
): Promise<Result<AuditCheckpoint, ServiceError>> {
  const latest = await getLatestAuditCheckpoint(db);
  const fromSeq = latest ? latest.toSeq + 1 : 1;

  const head = first(
    await db
      .select({ seq: schema.auditEvents.seq, hash: schema.auditEvents.hash })
      .from(schema.auditEvents)
      .orderBy(desc(schema.auditEvents.seq))
      .limit(1),
  );
  if (!head || head.seq < fromSeq) {
    if (latest) return ok(latest);
    return err(serviceError('invalid', 'no audit events exist yet to checkpoint'));
  }

  const signature = computeSignature(
    { fromSeq, toSeq: head.seq, chainHeadHash: head.hash },
    signingSecret,
  );

  const checkpoint = required(
    first(
      await db
        .insert(schema.auditCheckpoints)
        .values({
          fromSeq,
          toSeq: head.seq,
          chainHeadHash: head.hash,
          signature,
          signingKeyVersion,
        })
        .returning(),
    ),
    'audit checkpoint',
  );
  return ok(checkpoint);
}

/**
 * True if `checkpoint.signature` is exactly what `signingSecret` would
 * produce for its own recorded `(fromSeq, toSeq, chainHeadHash)` — proves
 * the checkpoint itself wasn't forged or edited by someone without the
 * secret. Constant-time comparison so this check itself cannot leak the
 * correct signature one byte at a time via timing.
 */
export function verifyCheckpointSignature(
  checkpoint: AuditCheckpoint,
  signingSecret: string,
): boolean {
  const expected = computeSignature(checkpoint, signingSecret);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(checkpoint.signature, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * True if the audit_events row actually at `checkpoint.toSeq`, read fresh
 * from the database right now, still has the hash this checkpoint recorded
 * — proves the chain has not been retroactively altered since this
 * checkpoint was taken. This alone does not prove the SIGNATURE is
 * genuine (pair with `verifyCheckpointSignature`); together, both passing
 * is what "this range of history is provably unaltered" actually means.
 */
export async function verifyCheckpointAgainstChain(
  db: Db,
  checkpoint: AuditCheckpoint,
): Promise<boolean> {
  const row = first(
    await db
      .select({ hash: schema.auditEvents.hash })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.seq, checkpoint.toSeq))
      .limit(1),
  );
  return row?.hash === checkpoint.chainHeadHash;
}

/**
 * Every audit event in a checkpoint's covered range, oldest first — lets a
 * verifier independently re-walk that exact slice of history rather than
 * only trusting a single row's hash matches.
 */
export async function eventsInCheckpointRange(
  db: Db,
  checkpoint: AuditCheckpoint,
): Promise<(typeof schema.auditEvents.$inferSelect)[]> {
  const rows = await db
    .select()
    .from(schema.auditEvents)
    .where(gt(schema.auditEvents.seq, checkpoint.fromSeq - 1));
  return rows.filter((r) => r.seq <= checkpoint.toSeq).sort((a, b) => a.seq - b.seq);
}
