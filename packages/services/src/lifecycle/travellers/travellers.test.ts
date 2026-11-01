import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { accountPrincipal } from '../../access/principal';
import { type AuthorizedApplicant, requireAccess } from '../../access/require-access';
import { provisionAccount } from '../../accounts';
import { createApplicant, listApplicants } from '../../applicants';
import { setConsent } from '../../consent';
import type { Db } from '../../db';
import { editFact, registerFieldDefinition } from '../../profile';
import {
  TRAVELLER_RECENTLY_DELETED_DAYS,
  TRAVELLER_REFUSALS,
  archiveTraveller,
  availableTravellerActions,
  deleteEmptyTraveller,
  getTravellerManageView,
  restoreDeletedTraveller,
  restoreTraveller,
  travellerIsEmpty,
} from './index';

const HEAVY = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function freshDb(options: { readonly withoutLifecycle?: boolean } = {}): Promise<Db> {
  const client = await createMigratedPglite();
  if (options.withoutLifecycle) {
    // The database as it was before migration 0113.
    await client.exec(
      'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade',
    );
  }
  return drizzle(client, { schema }) as unknown as Db;
}

async function seedAccount(db: Db, email: string): Promise<string> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  return accountId;
}

async function addTraveller(
  db: Db,
  accountId: string,
  relationship: 'SELF' | 'FAMILY_MEMBER' = 'FAMILY_MEMBER',
): Promise<string> {
  const created = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: relationship === 'SELF' ? 'Synthetic Self' : 'Synthetic Family',
    relationship,
    authorityConfirmed: true,
  });
  if (!isOk(created)) throw new Error('applicant');
  return created.value.id;
}

async function manage(
  db: Db,
  accountId: string,
  applicantId: string,
): Promise<AuthorizedApplicant<'MANAGE'>> {
  const result = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { applicantId },
    { purpose: 'self' },
  );
  if (!result.ok) throw new Error(`proof: ${result.error.code}`);
  return result.value;
}

async function addFact(db: Db, accountId: string, applicantId: string): Promise<void> {
  await registerFieldDefinition(db, { key: 'given_name', dataType: 'string' });
  const fact = await editFact(db, {
    actorAccountId: accountId,
    applicantId,
    fieldKey: 'given_name',
    value: 'X0000001',
  });
  if (!isOk(fact)) throw new Error(`fact: ${fact.error.code}`);
}

async function receiptsOf(db: Db, applicantId: string) {
  const receipts = schema.deletionReceipts;
  return db
    .select({
      id: receipts.id,
      subjectKind: receipts.subjectKind,
      subjectCode: receipts.subjectCode,
      path: receipts.path,
      status: receipts.status,
      scheduledFor: receipts.scheduledFor,
    })
    .from(receipts)
    .where(eq(receipts.applicantId, applicantId));
}

async function auditTypes(db: Db, applicantId: string): Promise<string[]> {
  const rows = await db
    .select({ eventType: schema.auditEvents.eventType })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.applicantId, applicantId))
    .orderBy(schema.auditEvents.occurredAt);
  return rows.map((row) => row.eventType);
}

const ids = (rows: readonly { readonly id: string }[]) => rows.map((row) => row.id).sort();

describe('availableTravellerActions', () => {
  it('never offers Archive for Myself, and offers removal only without a block', () => {
    expect(
      availableTravellerActions({ state: 'CURRENT', isMyself: true, removalBlock: 'LAST_MYSELF' }),
    ).toEqual([]);
    expect(
      availableTravellerActions({ state: 'CURRENT', isMyself: true, removalBlock: null }),
    ).toEqual(['REMOVE_EMPTY']);
    expect(
      availableTravellerActions({ state: 'CURRENT', isMyself: false, removalBlock: 'NOT_EMPTY' }),
    ).toEqual(['ARCHIVE']);
    expect(
      availableTravellerActions({ state: 'ARCHIVED', isMyself: false, removalBlock: null }),
    ).toEqual(['RESTORE', 'REMOVE_EMPTY']);
    expect(
      availableTravellerActions({ state: 'RECENTLY_DELETED', isMyself: false, removalBlock: null }),
    ).toEqual(['RESTORE_DELETED']);
  });
});

describe('travellers with the lifecycle tables present', () => {
  it(
    'archives and restores a family member, and the everyday list leaves the archived one out',
    async () => {
      const db = await freshDb();
      const owner = await seedAccount(db, 'lc-e-archive@example.com');
      const self = await addTraveller(db, owner, 'SELF');
      const family = await addTraveller(db, owner);
      await addFact(db, owner, family);

      const archived = await archiveTraveller(await manage(db, owner, family));
      expect(archived.ok && archived.value.state).toBe('ARCHIVED');
      expect(ids(await listApplicants(db, owner))).toEqual([self]);
      const archivedList = await listApplicants(db, owner, { view: 'archived' });
      expect(ids(archivedList)).toEqual([family]);
      expect(archivedList[0]?.archivedAt).toBeInstanceOf(Date);
      expect(await listApplicants(db, owner, { view: 'recentlyDeleted' })).toEqual([]);
      // Archiving twice changes nothing; restoring brings the person back.
      expect((await archiveTraveller(await manage(db, owner, family))).ok).toBe(true);
      const restored = await restoreTraveller(await manage(db, owner, family));
      expect(restored.ok && restored.value.state).toBe('CURRENT');
      expect(ids(await listApplicants(db, owner))).toEqual([self, family].sort());
      expect(await listApplicants(db, owner, { view: 'archived' })).toEqual([]);
      expect(await auditTypes(db, family)).toEqual(
        expect.arrayContaining(['APPLICANT_ARCHIVED', 'APPLICANT_RESTORED']),
      );
    },
    HEAVY,
  );

  it(
    'never archives Myself',
    async () => {
      const db = await freshDb();
      const owner = await seedAccount(db, 'lc-e-myself@example.com');
      const self = await addTraveller(db, owner, 'SELF');
      const result = await archiveTraveller(await manage(db, owner, self));
      expect(!result.ok && result.error.message).toBe(TRAVELLER_REFUSALS.myselfArchive);
      expect(ids(await listApplicants(db, owner))).toEqual([self]);
    },
    HEAVY,
  );

  it(
    'refuses another person: a stranger never gets a proof for the record',
    async () => {
      const db = await freshDb();
      const owner = await seedAccount(db, 'lc-e-owner@example.com');
      await addTraveller(db, owner, 'SELF');
      const family = await addTraveller(db, owner);
      const stranger = await seedAccount(db, 'lc-e-stranger@example.com');
      const proof = await requireAccess(
        db,
        accountPrincipal(stranger),
        'MANAGE',
        { applicantId: family },
        { purpose: 'self' },
      );
      expect(proof.ok).toBe(false);
      // And the stranger's own records do not include it.
      expect(await listApplicants(db, stranger)).toEqual([]);
    },
    HEAVY,
  );

  it(
    'refuses to remove a traveller with one fact (red first)',
    async () => {
      const db = await freshDb();
      const owner = await seedAccount(db, 'lc-e-fact@example.com');
      await addTraveller(db, owner, 'SELF');
      const family = await addTraveller(db, owner);
      await addFact(db, owner, family);
      const access = await manage(db, owner, family);
      expect(await travellerIsEmpty(db, family, access)).toBe(false);
      const result = await deleteEmptyTraveller(access);
      expect(!result.ok && result.error.message).toBe(TRAVELLER_REFUSALS.notEmpty);
      const view = await getTravellerManageView(access);
      expect(view.ok && view.value?.removalBlock).toBe('NOT_EMPTY');
      expect(view.ok && view.value?.actions).toEqual(['ARCHIVE']);
      expect(ids(await listApplicants(db, owner))).toContain(family);
    },
    HEAVY,
  );

  it(
    'removes an empty record into Recently Deleted for 30 days, with its Removal Record on Myself, and restores it',
    async () => {
      const db = await freshDb();
      const owner = await seedAccount(db, 'lc-e-remove@example.com');
      const self = await addTraveller(db, owner, 'SELF');
      const family = await addTraveller(db, owner);
      const now = new Date('2026-11-01T10:00:00Z');
      const access = await manage(db, owner, family);
      expect(await travellerIsEmpty(db, family, access)).toBe(true);
      const view = await getTravellerManageView(access);
      expect(view.ok && view.value?.actions).toEqual(['ARCHIVE', 'REMOVE_EMPTY']);

      const removed = await deleteEmptyTraveller(access, { now });
      expect(removed.ok).toBe(true);
      const purgeAfter = new Date(now.getTime() + TRAVELLER_RECENTLY_DELETED_DAYS * DAY_MS);
      expect(removed.ok && removed.value.purgeAfter).toEqual(purgeAfter);
      expect(ids(await listApplicants(db, owner))).toEqual([self]);
      const deletedList = await listApplicants(db, owner, { view: 'recentlyDeleted' });
      expect(ids(deletedList)).toEqual([family]);
      expect(deletedList[0]?.purgeAfter).toEqual(purgeAfter);
      expect(await listApplicants(db, owner, { view: 'archived' })).toEqual([]);

      // The record of it sits on Myself, which stays; none on the removed record.
      const [receipt] = await receiptsOf(db, self);
      expect(receipt).toMatchObject({
        subjectKind: 'TRAVELLER',
        path: 'EMPTY_TRAVELLER',
        status: 'SCHEDULED',
        scheduledFor: purgeAfter,
      });
      expect(receipt?.subjectCode).toMatch(/^P-[0-9A-HJKMNP-TV-Z]{5,8}$/);
      expect(await receiptsOf(db, family)).toEqual([]);
      // Nothing else is possible on a record in Recently Deleted.
      const again = await manage(db, owner, family);
      expect((await archiveTraveller(again)).ok).toBe(false);
      expect((await deleteEmptyTraveller(again)).ok).toBe(false);
      const deletedView = await getTravellerManageView(again);
      expect(deletedView.ok && deletedView.value?.actions).toEqual(['RESTORE_DELETED']);

      const restored = await restoreDeletedTraveller(again);
      expect(restored.ok && restored.value.state).toBe('CURRENT');
      expect(ids(await listApplicants(db, owner))).toEqual([self, family].sort());
      expect((await receiptsOf(db, self))[0]?.status).toBe('RESTORED');
      expect((await restoreDeletedTraveller(again)).ok).toBe(false);
      expect(await auditTypes(db, family)).toEqual(
        expect.arrayContaining(['APPLICANT_DELETED', 'APPLICANT_RESTORED']),
      );
    },
    HEAVY,
  );

  it(
    'removes an empty Myself only while another Myself stays, anchoring the record on it',
    async () => {
      const db = await freshDb();
      const owner = await seedAccount(db, 'lc-e-two-selves@example.com');
      const first = await addTraveller(db, owner, 'SELF');
      await addTraveller(db, owner);
      const onlySelf = await deleteEmptyTraveller(await manage(db, owner, first));
      expect(!onlySelf.ok && onlySelf.error.message).toBe(TRAVELLER_REFUSALS.lastMyself);

      const second = await addTraveller(db, owner, 'SELF');
      expect((await deleteEmptyTraveller(await manage(db, owner, first))).ok).toBe(true);
      expect((await receiptsOf(db, second))[0]?.path).toBe('EMPTY_TRAVELLER');
      // The other one now holds that Removal Record, so it is not empty (and is the last Myself).
      const last = await deleteEmptyTraveller(await manage(db, owner, second));
      expect(!last.ok && last.error.message).toBe(TRAVELLER_REFUSALS.notEmpty);
    },
    HEAVY,
  );

  it(
    'never removes the only record on an account, and an archived record can still be removed when empty',
    async () => {
      const db = await freshDb();
      const owner = await seedAccount(db, 'lc-e-only@example.com');
      const family = await addTraveller(db, owner);
      const only = await deleteEmptyTraveller(await manage(db, owner, family));
      expect(!only.ok && only.error.message).toBe(TRAVELLER_REFUSALS.onlyRecord);

      const other = await addTraveller(db, owner);
      expect((await archiveTraveller(await manage(db, owner, family))).ok).toBe(true);
      expect((await deleteEmptyTraveller(await manage(db, owner, family))).ok).toBe(true);
      // No Myself: the record is anchored on the other record that stays.
      expect((await receiptsOf(db, other))[0]?.status).toBe('SCHEDULED');
    },
    HEAVY,
  );

  it(
    'refuses a record holding a file still being destroyed, and allows it once destruction is verified',
    async () => {
      const db = await freshDb();
      const owner = await seedAccount(db, 'lc-e-erasure@example.com');
      await addTraveller(db, owner, 'SELF');
      const family = await addTraveller(db, owner);
      const access = await manage(db, owner, family);
      await db.execute(
        sql`insert into erasure_jobs (applicant_id, storage_object_id, bucket, object_key, reason, status)
            select ${family}::uuid, gen_random_uuid(), 'CLEAN', 'lc-e-erasure-object', 'ACCOUNT_DELETION', 'PENDING'`,
      );
      expect(await travellerIsEmpty(db, family, access)).toBe(false);
      await db.execute(
        sql`update erasure_jobs set status = 'VERIFIED' where applicant_id = ${family}::uuid`,
      );
      expect(await travellerIsEmpty(db, family, access)).toBe(true);
    },
    HEAVY,
  );

  it(
    'answers "not empty" for a proof that does not cover the record',
    async () => {
      const db = await freshDb();
      const owner = await seedAccount(db, 'lc-e-cover@example.com');
      const self = await addTraveller(db, owner, 'SELF');
      const family = await addTraveller(db, owner);
      expect(await travellerIsEmpty(db, family, await manage(db, owner, self))).toBe(false);
      expect(await travellerIsEmpty(db, 'not-a-uuid', await manage(db, owner, family))).toBe(false);
    },
    HEAVY,
  );
});

describe('travellers with the lifecycle tables missing', () => {
  it(
    'lists every record as before, hides the lifecycle actions and refuses every command',
    async () => {
      const db = await freshDb({ withoutLifecycle: true });
      const owner = await seedAccount(db, 'lc-e-missing@example.com');
      const self = await addTraveller(db, owner, 'SELF');
      const family = await addTraveller(db, owner);
      expect(ids(await listApplicants(db, owner))).toEqual([self, family].sort());
      expect(await listApplicants(db, owner, { view: 'archived' })).toEqual([]);
      expect(await listApplicants(db, owner, { view: 'recentlyDeleted' })).toEqual([]);
      const access = await manage(db, owner, family);
      const view = await getTravellerManageView(access);
      expect(view.ok && view.value).toBeNull();
      for (const command of [
        archiveTraveller,
        restoreTraveller,
        deleteEmptyTraveller,
        restoreDeletedTraveller,
      ]) {
        const result = await command(access);
        expect(!result.ok && result.error.message).toBe(TRAVELLER_REFUSALS.unavailable);
      }
      // Emptiness still answers from the tables that exist.
      expect(await travellerIsEmpty(db, family, access)).toBe(true);
    },
    HEAVY,
  );
});
