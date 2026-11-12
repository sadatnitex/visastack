import { and, eq, inArray } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';

/**
 * The one way a parked deletion job goes back to the queue (a leaf module, so both the admin retry
 * in `erasure.ts` and the legal hold release in `legal-hold.ts` can use it without an import cycle).
 *
 * Resets the job to PENDING with a fresh attempt budget and records an `ERASURE_JOB_RETRIED` audit
 * event, in the caller's transaction. The update only matches a job still sitting in one of
 * `fromStatuses`, so it is a compare-and-set: repeating it, or racing an admin retry, queues the
 * job once and the loser gets `false` and writes nothing.
 */
export async function requeueParkedErasureJob(
  tx: Db,
  jobId: string,
  options: {
    readonly fromStatuses: readonly ('FAILED' | 'BLOCKED_BY_HOLD')[];
    readonly audit: {
      readonly actorAccountId: string;
      readonly method: 'MANUAL' | 'SYSTEM';
      readonly extraMetadata?: Readonly<Record<string, unknown>>;
    };
  },
): Promise<boolean> {
  const before = first(
    await tx
      .select({ status: schema.erasureJobs.status })
      .from(schema.erasureJobs)
      .where(eq(schema.erasureJobs.id, jobId))
      .limit(1),
  );
  const updated = await tx
    .update(schema.erasureJobs)
    .set({
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      availableAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.erasureJobs.id, jobId),
        inArray(schema.erasureJobs.status, [...options.fromStatuses]),
      ),
    )
    .returning({ id: schema.erasureJobs.id });
  if (updated.length === 0) return false;
  await appendAuditEvent(tx, {
    eventType: 'ERASURE_JOB_RETRIED',
    actorAccountId: options.audit.actorAccountId,
    resourceType: 'erasure_job',
    resourceId: jobId,
    method: options.audit.method,
    result: 'ALLOWED',
    metadata: {
      outcome: 'REQUEUED',
      was: before?.status ?? 'UNKNOWN',
      ...(options.audit.extraMetadata ?? {}),
    },
  });
  return true;
}
