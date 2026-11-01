import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import {
  type Db,
  accountPrincipal,
  createApplicant,
  deleteEmptyTraveller,
  listApplicants,
  provisionAccount,
  purgeDueTravellers,
  requireAccess,
  setConsent,
  systemPrincipal,
} from '@visastack/services';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it, vi } from 'vitest';
import { runTravellerPurge } from '../../../../lib/lifecycle-jobs/traveller-purge';

/*
 * The traveller purge (LC-E) against a real database. It lives beside the job route because only
 * the job routes may make a job's scope (access/enforcement.test.ts).
 */

const HEAVY = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const scope = () => systemPrincipal('process-deletions');

async function freshDb(options: { readonly withoutLifecycle?: boolean } = {}): Promise<Db> {
  const client = await createMigratedPglite();
  if (options.withoutLifecycle) {
    await client.exec(
      'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade',
    );
  }
  return drizzle(client, { schema }) as unknown as Db;
}

async function seed(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const make = async (relationship: 'SELF' | 'FAMILY_MEMBER') => {
    const created = await createApplicant(db, {
      actorAccountId: accountId,
      ownerAccountId: accountId,
      displayName: 'Synthetic Person',
      relationship,
      authorityConfirmed: true,
    });
    if (!isOk(created)) throw new Error('applicant');
    return created.value.id;
  };
  return { accountId, self: await make('SELF'), family: await make('FAMILY_MEMBER') };
}

async function removeEmpty(db: Db, accountId: string, applicantId: string, now: Date) {
  const proof = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { applicantId },
    { purpose: 'self' },
  );
  if (!proof.ok) throw new Error('proof');
  const removed = await deleteEmptyTraveller(proof.value, { now });
  if (!removed.ok) throw new Error(removed.error.message);
  return removed.value;
}

async function receipt(db: Db, id: string) {
  const receipts = schema.deletionReceipts;
  const [row] = await db
    .select({ status: receipts.status, verifiedGoneAt: receipts.verifiedGoneAt })
    .from(receipts)
    .where(eq(receipts.id, id));
  return row;
}

async function applicantExists(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.applicants.id })
    .from(schema.applicants)
    .where(eq(schema.applicants.id, id));
  return rows.length === 1;
}

describe('traveller purge', () => {
  it(
    'deletes an empty record only after its 30 days, and its Removal Record reads Removed',
    async () => {
      const db = await freshDb();
      const owner = await seed(db, 'lc-e-purge@example.com');
      const removedAt = new Date('2026-11-01T10:00:00Z');
      const { receiptId } = await removeEmpty(db, owner.accountId, owner.family, removedAt);

      const early = await purgeDueTravellers(db, scope(), {
        now: new Date(removedAt.getTime() + 29 * DAY_MS),
      });
      expect(early.ok && early.value).toEqual({ removed: 0, restored: 0, failed: 0 });
      expect(await applicantExists(db, owner.family)).toBe(true);

      const due = new Date(removedAt.getTime() + 30 * DAY_MS + 1000);
      const purged = await purgeDueTravellers(db, scope(), { now: due });
      expect(purged.ok && purged.value).toEqual({ removed: 1, restored: 0, failed: 0 });
      expect(await applicantExists(db, owner.family)).toBe(false);
      expect(await receipt(db, receiptId)).toEqual({ status: 'REMOVED', verifiedGoneAt: due });
      // Myself and its records stay.
      expect((await listApplicants(db, owner.accountId)).map((a) => a.id)).toEqual([owner.self]);
      const audit = await db
        .select({ eventType: schema.auditEvents.eventType })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.applicantId, owner.family));
      expect(audit.map((row) => row.eventType)).toContain('APPLICANT_REMOVED');
    },
    HEAVY,
  );

  it(
    'restores, never deletes, a record that gained something while in Recently Deleted',
    async () => {
      const db = await freshDb();
      const owner = await seed(db, 'lc-e-recheck@example.com');
      const removedAt = new Date('2026-11-01T10:00:00Z');
      const { receiptId } = await removeEmpty(db, owner.accountId, owner.family, removedAt);
      // Something arrives for the record by another path (a profile section choice here).
      await db.execute(
        sql`insert into profile_section_states (applicant_id, section_key, is_open)
            values (${owner.family}::uuid, 'travel_history', false)`,
      );
      const purged = await purgeDueTravellers(db, scope(), {
        now: new Date(removedAt.getTime() + 31 * DAY_MS),
      });
      expect(purged.ok && purged.value).toEqual({ removed: 0, restored: 1, failed: 0 });
      expect(await applicantExists(db, owner.family)).toBe(true);
      expect((await receipt(db, receiptId))?.status).toBe('RESTORED');
      expect((await listApplicants(db, owner.accountId)).map((a) => a.id).sort()).toEqual(
        [owner.self, owner.family].sort(),
      );
    },
    HEAVY,
  );

  it(
    'refuses any other job scope, and does nothing with the lifecycle tables missing',
    async () => {
      const db = await freshDb();
      const other = systemPrincipal('process-erasure') as unknown as Parameters<
        typeof purgeDueTravellers
      >[1];
      expect((await purgeDueTravellers(db, other)).ok).toBe(false);
      const missing = await freshDb({ withoutLifecycle: true });
      await seed(missing, 'lc-e-purge-missing@example.com');
      const result = await purgeDueTravellers(missing, scope());
      expect(result.ok && result.value).toEqual({ removed: 0, restored: 0, failed: 0 });
    },
    HEAVY,
  );

  it(
    'runs through the job function, which never throws and reports a failure',
    async () => {
      const db = await freshDb();
      const owner = await seed(db, 'lc-e-job@example.com');
      const removedAt = new Date(Date.now() - 31 * DAY_MS);
      await removeEmpty(db, owner.accountId, owner.family, removedAt);
      const close = vi.fn(async () => undefined);
      const report = vi.fn();
      const outcome = await runTravellerPurge(scope(), { openDb: () => ({ db, close }), report });
      expect(outcome).toEqual({ removed: 1, restored: 0, failed: 0 });
      expect(close).toHaveBeenCalledTimes(1);
      expect(report).not.toHaveBeenCalled();

      const failing = await runTravellerPurge(scope(), {
        openDb: () => ({ db, close }),
        report,
        purge: async () => {
          throw new Error('synthetic failure');
        },
      });
      expect(failing).toEqual({ removed: 0, restored: 0, failed: 0 });
      expect(report).toHaveBeenCalledWith('runTravellerPurge', expect.any(Error), {
        step: 'sweep failed',
      });
      expect(await runTravellerPurge(scope(), { openDb: () => null, report })).toEqual({
        removed: 0,
        restored: 0,
        failed: 0,
      });
    },
    HEAVY,
  );
});
