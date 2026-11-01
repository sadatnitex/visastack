// PROGRAMME section 8, row "Records" (lanes F, C, D and E): Removal Records hold no name, title,
// number, text or raw fingerprint; their content columns cannot be changed; the person and a
// privacy administrator can read them.
import { type SQL, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { listDeletionReceipts } from '../foundation';
import { deleteDuplicate } from '../recently-deleted';
import { decideRemovalRequest, requestRemoval } from '../removal-requests';
import { deleteEmptyTraveller } from '../travellers';
import {
  JOURNEY_TIMEOUT,
  type JourneyOwner,
  MemoryBlobStore,
  addTraveller,
  auditEventsOf,
  freshJourneyDb,
  openCase,
  ownerProof,
  receiptsOf,
  runErasure,
  seedOwner,
  staffScope,
  uploadDocument,
} from './journey-helpers.test-support';

const STAFF = 'lcz-records-staff@example.com';
const PERSON = 'Rahima Synthetic-Uddin';
const NUMBER = 'X9876543';
const TITLE = `Passport ${NUMBER} ${PERSON}.pdf`;
const RAW_HASH = '0123456789abcdef'.repeat(4);
const UNIQUE_HASH = 'fedcba9876543210'.repeat(4);
const EMPTY_NAME = 'Empty Synthetic Cousin';

/** Everything personal that must never reach a Removal Record, a request or a lifecycle audit row. */
const FORBIDDEN = [
  PERSON,
  'Rahima',
  NUMBER,
  'Passport X',
  '.pdf',
  RAW_HASH,
  UNIQUE_HASH,
  EMPTY_NAME,
];

const LIFECYCLE_AUDIT_TYPES = [
  'DOCUMENT_DELETED',
  'DOCUMENT_REMOVAL_QUEUED',
  'DOCUMENT_REMOVAL_REQUESTED',
  'DOCUMENT_REMOVAL_DECIDED',
  'APPLICANT_DELETED',
  'ERASURE_VERIFIED',
];

async function refusal(db: Db, statement: SQL): Promise<string> {
  try {
    await db.execute(statement);
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return `${String(error)} ${cause ? String((cause as Error).message ?? cause) : ''}`;
  }
  return 'ACCEPTED';
}

describe('Records', () => {
  let db: Db;
  let owner: JourneyOwner;
  beforeAll(async () => {
    ({ db } = await freshJourneyDb());
    owner = await seedOwner(db, 'lcz-records@example.com', { displayName: PERSON });
    const storage = new MemoryBlobStore();
    const proof = await ownerProof(db, owner);
    // DUPLICATE: an identical copy used in an open case, deleted.
    await uploadDocument(db, owner, { sha: RAW_HASH, name: TITLE, storage });
    const copy = await uploadDocument(db, owner, { sha: RAW_HASH, name: TITLE, storage });
    await openCase(db, owner, { documentId: copy.documentId, title: `Trip of ${PERSON}` });
    const deleted = await deleteDuplicate(proof, { documentId: copy.documentId });
    if (!deleted.ok) throw new Error(`delete: ${deleted.error.code}`);
    // REQUEST: a unique file, approved and destroyed.
    const unique = await uploadDocument(db, owner, { sha: UNIQUE_HASH, name: TITLE, storage });
    const asked = await requestRemoval(proof, {
      documentId: unique.documentId,
      reason: 'PRIVACY_CONCERN',
    });
    if (!asked.ok) throw new Error('request');
    const approved = await decideRemovalRequest(
      await staffScope(db, STAFF, 'RETENTION_PURGE'),
      { id: asked.value.id, decision: 'APPROVE', stepUpSatisfied: true },
      { db },
    );
    if (!approved.ok) throw new Error('approve');
    expect((await runErasure(db, storage)).processed).toBe(1);
    // EMPTY_TRAVELLER: an empty record removed.
    const empty = await addTraveller(db, owner.accountId, {
      relationship: 'FAMILY_MEMBER',
      displayName: EMPTY_NAME,
    });
    const removed = await deleteEmptyTraveller(
      await ownerProof(db, { accountId: owner.accountId, applicantId: empty }),
    );
    if (!removed.ok) throw new Error(`remove: ${removed.error.code}`);
  }, JOURNEY_TIMEOUT);

  it(
    'stores no name, title, number, text or raw fingerprint, in records, requests or lifecycle audit rows',
    async () => {
      const receipts = await receiptsOf(db, owner.applicantId);
      expect(receipts.map((r) => r.path).sort()).toEqual([
        'DUPLICATE',
        'EMPTY_TRAVELLER',
        'REQUEST',
      ]);
      const requests = await db.execute(sql`select * from document_removal_requests`);
      const audits = (
        await Promise.all(LIFECYCLE_AUDIT_TYPES.map((type) => auditEventsOf(db, type)))
      ).flat();
      expect(audits.length).toBeGreaterThanOrEqual(LIFECYCLE_AUDIT_TYPES.length);
      for (const [label, value] of [
        ['receipts', receipts],
        ['requests', requests],
        ['audit metadata', audits.map((a) => a.metadata)],
      ] as const) {
        const text = JSON.stringify(value);
        for (const forbidden of FORBIDDEN)
          expect(text, `${label}: ${forbidden}`).not.toContain(forbidden);
      }
      // Codes and catalogue keys only.
      for (const receipt of receipts) {
        expect(receipt.subjectCode).toMatch(/^[DP]-[0-9A-HJKMNP-TV-Z]{5,8}$/);
        expect(receipt.documentKind === null || /^[a-z_]+$/.test(receipt.documentKind)).toBe(true);
      }
      // No free-text column exists to hold any of it.
      const textColumns = await db.execute(sql`
        select table_name, column_name from information_schema.columns
        where table_name in ('deletion_receipts', 'document_removal_requests')
          and data_type in ('text', 'character varying')
        order by table_name, column_name`);
      expect(
        (textColumns as { rows: Array<{ table_name: string; column_name: string }> }).rows.map(
          (row) => `${row.table_name}.${row.column_name}`,
        ),
      ).toEqual([
        'deletion_receipts.document_kind',
        'deletion_receipts.path',
        'deletion_receipts.status',
        'deletion_receipts.subject_code',
        'deletion_receipts.subject_kind',
        'deletion_receipts.uploaded_by_role',
        'document_removal_requests.decision_code',
        'document_removal_requests.document_code',
        'document_removal_requests.reason',
        'document_removal_requests.status',
      ]);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'refuses an UPDATE of any content column, a DELETE, a status moving back and effects losing a key',
    async () => {
      const [removed] = (await receiptsOf(db, owner.applicantId)).filter(
        (r) => r.path === 'REQUEST',
      );
      if (!removed) throw new Error('receipt');
      expect(removed.status).toBe('REMOVED');
      const id = removed.id;
      const other = await seedOwner(db, 'lcz-records-other@example.com');
      const edits: ReadonlyArray<readonly [string, SQL]> = [
        [
          'applicant_id',
          sql`update deletion_receipts set applicant_id = ${other.applicantId} where id = ${id}`,
        ],
        [
          'subject_kind',
          sql`update deletion_receipts set subject_kind = 'TRAVELLER' where id = ${id}`,
        ],
        [
          'subject_code',
          sql`update deletion_receipts set subject_code = 'D-AAAAAA' where id = ${id}`,
        ],
        [
          'document_kind',
          sql`update deletion_receipts set document_kind = 'visa' where id = ${id}`,
        ],
        [
          'uploaded_at',
          sql`update deletion_receipts set uploaded_at = now() - interval '9 days' where id = ${id}`,
        ],
        [
          'uploaded_by_role',
          sql`update deletion_receipts set uploaded_by_role = 'SYSTEM' where id = ${id}`,
        ],
        ['path', sql`update deletion_receipts set path = 'DUPLICATE' where id = ${id}`],
        [
          'requested_at',
          sql`update deletion_receipts set requested_at = now() - interval '9 days' where id = ${id}`,
        ],
        ['scheduled_for', sql`update deletion_receipts set scheduled_for = now() where id = ${id}`],
        [
          'created_at',
          sql`update deletion_receipts set created_at = now() - interval '9 days' where id = ${id}`,
        ],
        [
          'requested_by_account_id',
          sql`update deletion_receipts set requested_by_account_id = ${other.accountId} where id = ${id}`,
        ],
        [
          'approved_by_account_id',
          sql`update deletion_receipts set approved_by_account_id = ${other.accountId} where id = ${id}`,
        ],
        [
          'verified_gone_at',
          sql`update deletion_receipts set verified_gone_at = now() + interval '1 day' where id = ${id}`,
        ],
        [
          'status backward',
          sql`update deletion_receipts set status = 'SCHEDULED' where id = ${id}`,
        ],
        [
          'effects shrink',
          sql`update deletion_receipts set effects = '{}'::jsonb where id = ${id}`,
        ],
        ['delete', sql`delete from deletion_receipts where id = ${id}`],
      ];
      for (const [label, statement] of edits) {
        expect(await refusal(db, statement), label).toMatch(/deletion_receipts: /);
      }
      // Unchanged after every attempt.
      const [after] = (await receiptsOf(db, owner.applicantId)).filter((r) => r.id === id);
      expect(after).toEqual(removed);
      // The one change allowed on a finished record: effects may gain a key.
      expect(
        await refusal(
          db,
          sql`update deletion_receipts set effects = effects || '{"sharesAffected": 0}'::jsonb where id = ${id}`,
        ),
      ).toBe('ACCEPTED');
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'shows the records to the person and to a privacy administrator, never to anyone else',
    async () => {
      const mine = await listDeletionReceipts(await ownerProof(db, owner, 'VIEW_METADATA'));
      expect(mine.ok && mine.value).toHaveLength(3);
      const admin = await staffScope(db, STAFF, 'APPLICANT_DIRECTORY_VIEW');
      const byAdmin = await listDeletionReceipts(admin, { db, applicantId: owner.applicantId });
      expect(byAdmin.ok && byAdmin.value.map((r) => r.id).sort()).toEqual(
        mine.ok ? mine.value.map((r) => r.id).sort() : [],
      );
      // Codes, kinds, dates and counts only: never who asked or approved.
      for (const record of mine.ok ? mine.value : []) {
        expect(Object.keys(record)).not.toContain('requestedByAccountId');
        expect(Object.keys(record)).not.toContain('approvedByAccountId');
      }
      const stranger = await seedOwner(db, 'lcz-records-stranger@example.com');
      const theirs = await listDeletionReceipts(await ownerProof(db, stranger, 'VIEW_METADATA'));
      expect(theirs.ok && theirs.value).toEqual([]);
    },
    JOURNEY_TIMEOUT,
  );
});
