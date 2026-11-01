import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal } from '../../access/principal';
import { type AuthorizedApplicant, requireAccess } from '../../access/require-access';
import { systemScopeForTest } from '../../access/system-scope.test-support';
import { provisionAccount } from '../../accounts';
import { createApplicant } from '../../applicants';
import { setConsent } from '../../consent';
import type { Db } from '../../db';
import { addDocumentVersion, registerDocument } from '../../documents';
import { attachPackVersion, createMission, selectEvidence } from '../../missions';
import { createOrganization } from '../../organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from '../../packs';
import { duplicateStatus, duplicateStatuses } from '../duplicates';
import {
  DELETE_DUPLICATE_REFUSALS,
  RESTORE_REFUSALS,
  deleteDuplicate,
  previewDeleteDuplicate,
  purgeDueDocuments,
  restoreDeleted,
  undoDelete,
} from './index';

const HEAVY = 60_000;
const DAY_MS = 86_400_000;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

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

interface Owner {
  readonly accountId: string;
  readonly applicantId: string;
}

async function seedOwner(db: Db, email: string): Promise<Owner> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: accountId, accountId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Synthetic Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId, applicantId: applicant.value.id };
}

let keyCounter = 0;

/** A document with one version holding `sha` (null: no fingerprint); `ready` makes it usable. */
async function addDocument(
  db: Db,
  owner: Owner,
  sha: string | null,
  options: { readonly ready?: boolean; readonly createdAt?: Date } = {},
): Promise<string> {
  const doc = await registerDocument(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    originalName: 'synthetic.pdf',
    docType: 'PASSPORT',
  });
  if (!isOk(doc)) throw new Error('document');
  if (options.createdAt) {
    await db
      .update(schema.documents)
      .set({ createdAt: options.createdAt })
      .where(eq(schema.documents.id, doc.value.id));
  }
  keyCounter += 1;
  const ready = options.ready ?? true;
  const version = await addDocumentVersion(db, {
    actorAccountId: owner.accountId,
    documentId: doc.value.id,
    bucket: ready ? 'CLEAN' : 'QUARANTINE',
    objectKey: `lc-c-test-${keyCounter}`,
    safetyStatus: ready ? 'CLEAN' : 'PENDING',
    processingStatus: ready ? 'AWAITING_REVIEW' : 'SCANNING',
    ...(sha === null ? {} : { sha256: sha }),
  });
  if (!isOk(version)) throw new Error(`version: ${version.error.code}`);
  return doc.value.id;
}

async function manage(db: Db, owner: Owner): Promise<AuthorizedApplicant<'MANAGE'>> {
  const result = await requireAccess(
    db,
    accountPrincipal(owner.accountId),
    'MANAGE',
    { applicantId: owner.applicantId },
    { purpose: 'self' },
  );
  if (!result.ok) throw new Error(`proof: ${result.error.code}`);
  return result.value;
}

/** A published case for `owner` with `documentId` selected; `state` sets how far it got. */
async function caseUsing(
  db: Db,
  owner: Owner,
  documentId: string,
  state?: 'SUBMITTED' | 'CLOSED',
): Promise<string> {
  keyCounter += 1;
  const pack = await createPack(db, {
    actorAccountId: owner.accountId,
    key: `lcc.case.${keyCounter}`,
    name: 'P',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, {
    actorAccountId: owner.accountId,
    packId: pack.value.id,
  });
  if (!isOk(version)) throw new Error('version');
  const requirement = await addRequirement(db, {
    actorAccountId: owner.accountId,
    packVersionId: version.value.id,
    kind: 'DOCUMENT',
    docType: 'PASSPORT',
    citation: 'rule 1',
  });
  if (!isOk(requirement)) throw new Error('requirement');
  await approvePackVersion(db, {
    actorAccountId: owner.accountId,
    packVersionId: version.value.id,
  });
  await publishPackVersion(db, {
    actorAccountId: owner.accountId,
    packVersionId: version.value.id,
  });
  const mission = await createMission(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    title: `Case ${keyCounter}`,
  });
  if (!isOk(mission)) throw new Error('mission');
  await attachPackVersion(db, {
    actorAccountId: owner.accountId,
    missionId: mission.value.id,
    packVersionId: version.value.id,
  });
  const selected = await selectEvidence(db, {
    actorAccountId: owner.accountId,
    missionId: mission.value.id,
    packRequirementId: requirement.value.id,
    documentId,
  });
  if (!isOk(selected)) throw new Error(`select: ${selected.error.code}`);
  if (state) {
    await db.update(schema.missions).set({ state }).where(eq(schema.missions.id, mission.value.id));
  }
  return mission.value.id;
}

async function selectedDocumentsOf(db: Db, missionId: string): Promise<string[]> {
  const rows = await db
    .select({ documentId: schema.selectedEvidence.documentId })
    .from(schema.selectedEvidence)
    .where(eq(schema.selectedEvidence.missionId, missionId));
  return rows.flatMap((row) => (row.documentId ? [row.documentId] : []));
}

async function revisionOf(db: Db, missionId: string): Promise<number> {
  const [row] = await db
    .select({ revision: schema.missions.materialRevision })
    .from(schema.missions)
    .where(eq(schema.missions.id, missionId));
  return row?.revision ?? -1;
}

async function receiptOf(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(schema.deletionReceipts)
    .where(eq(schema.deletionReceipts.id, id));
  return row;
}

async function lifecycleOf(db: Db, documentId: string) {
  const [row] = await db
    .select()
    .from(schema.documentLifecycle)
    .where(eq(schema.documentLifecycle.documentId, documentId));
  return row;
}

async function erasureJobsFor(db: Db, documentId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.erasureJobs.id })
    .from(schema.erasureJobs)
    .where(eq(schema.erasureJobs.documentId, documentId));
  return rows.length;
}

const erasureScope = () => systemScopeForTest('process-erasure');

describe('Delete Duplicate with the lifecycle tables missing', () => {
  let db: Db;
  let owner: Owner;
  beforeEach(async () => {
    db = await freshDb({ withoutLifecycle: true });
    owner = await seedOwner(db, 'lcc-missing@example.com');
  }, HEAVY);

  it(
    'offers nothing, deletes nothing and purges nothing',
    async () => {
      const older = await addDocument(db, owner, SHA_A);
      const newer = await addDocument(db, owner, SHA_A);
      const proof = await manage(db, owner);
      const statuses = await duplicateStatuses(db, [older, newer], proof);
      expect(statuses.get(older)?.isDuplicate).toBe(false);
      expect(statuses.get(newer)?.isDuplicate).toBe(false);
      const deleted = await deleteDuplicate(proof, { documentId: newer });
      expect(deleted.ok).toBe(false);
      if (!deleted.ok) expect(deleted.error.code).toBe('not_found');
      expect((await previewDeleteDuplicate(proof, { documentId: newer })).ok).toBe(false);
      expect((await restoreDeleted(proof, { documentId: newer })).ok).toBe(false);
      expect(await purgeDueDocuments(db, erasureScope())).toEqual({
        queued: 0,
        removed: 0,
        blocked: 0,
        failed: 0,
      });
    },
    HEAVY,
  );
});

describe('Delete Duplicate with the lifecycle tables present', () => {
  let db: Db;
  let owner: Owner;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedOwner(db, 'lcc-owner@example.com');
  }, HEAVY);

  it(
    'knows a duplicate only when another usable document holds every version',
    async () => {
      const older = await addDocument(db, owner, SHA_A, {
        createdAt: new Date(Date.now() - DAY_MS),
      });
      const newer = await addDocument(db, owner, SHA_A);
      const unique = await addDocument(db, owner, SHA_B);
      const noPrint = await addDocument(db, owner, null);
      const proof = await manage(db, owner);
      const statuses = await duplicateStatuses(db, [older, newer, unique, noPrint], proof);
      expect(statuses.get(newer)).toEqual({
        isDuplicate: true,
        survivorDocumentId: older,
        blockReason: null,
      });
      expect(statuses.get(older)?.survivorDocumentId).toBe(newer);
      expect(statuses.get(unique)?.isDuplicate).toBe(false);
      expect(statuses.get(noPrint)?.isDuplicate).toBe(false);

      // A copy that is still being checked cannot stand in for one that is deleted.
      const other = await seedOwner(db, 'lcc-other@example.com');
      const checked = await addDocument(db, other, SHA_B, { ready: false });
      const fresh = await addDocument(db, other, SHA_B);
      const otherProof = await manage(db, other);
      expect((await duplicateStatus(db, fresh, otherProof))?.isDuplicate).toBe(false);
      expect((await duplicateStatus(db, checked, otherProof))?.survivorDocumentId).toBe(fresh);
      // Another person's identical file never counts, and is not even visible to this proof.
      expect(await duplicateStatus(db, checked, proof)).toBeNull();
    },
    HEAVY,
  );

  // Red first (lanes/C.md).
  it(
    'refuses to delete a duplicate whose only copy is itself in Recently Deleted',
    async () => {
      const older = await addDocument(db, owner, SHA_A);
      const newer = await addDocument(db, owner, SHA_A);
      const proof = await manage(db, owner);
      const first = await deleteDuplicate(proof, { documentId: newer });
      expect(first.ok).toBe(true);
      const second = await deleteDuplicate(proof, { documentId: older });
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error.code).toBe('invalid');
        expect(second.error.message).toBe(DELETE_DUPLICATE_REFUSALS.notDuplicate);
      }
      expect((await lifecycleOf(db, older))?.deletedAt ?? null).toBeNull();
      const again = await deleteDuplicate(proof, { documentId: newer });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe('stale');
    },
    HEAVY,
  );

  // Red first (lanes/C.md).
  it(
    'refuses when a finished case selected it, and switches open cases to the copy',
    async () => {
      const older = await addDocument(db, owner, SHA_A);
      const newer = await addDocument(db, owner, SHA_A);
      const finished = await caseUsing(db, owner, newer, 'SUBMITTED');
      const proof = await manage(db, owner);
      expect((await duplicateStatus(db, newer, proof))?.blockReason).toBe('FINISHED_CASE');
      const refused = await deleteDuplicate(proof, { documentId: newer });
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.error.message).toBe(DELETE_DUPLICATE_REFUSALS.blocked.FINISHED_CASE);
      }
      expect(await selectedDocumentsOf(db, finished)).toEqual([newer]);

      const open = await caseUsing(db, owner, older);
      const before = await revisionOf(db, open);
      const preview = await previewDeleteDuplicate(proof, { documentId: older });
      expect(preview.ok && preview.value.cases.map((c) => c.missionId)).toEqual([open]);
      expect(preview.ok && preview.value.survivorDocumentId).toBe(newer);
      const deleted = await deleteDuplicate(proof, { documentId: older });
      expect(deleted.ok).toBe(true);
      expect(await selectedDocumentsOf(db, open)).toEqual([newer]);
      expect(await revisionOf(db, open)).toBe(before + 1);
      if (!deleted.ok) return;
      const receipt = await receiptOf(db, deleted.value.receiptId);
      expect(receipt?.status).toBe('SCHEDULED');
      expect(receipt?.path).toBe('DUPLICATE');
      expect(receipt?.subjectCode).toMatch(/^D-/);
      expect((receipt?.effects as { casesSwitched?: string[] }).casesSwitched).toHaveLength(1);
      expect(JSON.stringify(receipt)).not.toContain('synthetic');
      const lifecycle = await lifecycleOf(db, older);
      expect(lifecycle?.deletePath).toBe('DUPLICATE');
      expect((lifecycle?.purgeAfter?.getTime() ?? 0) - (lifecycle?.deletedAt?.getTime() ?? 0)).toBe(
        30 * DAY_MS,
      );

      // Restoring later does not switch the case back (D4).
      expect((await undoDelete(proof, { documentId: older })).ok).toBe(true);
      expect(await selectedDocumentsOf(db, open)).toEqual([newer]);
      expect((await receiptOf(db, deleted.value.receiptId))?.status).toBe('RESTORED');
      expect((await lifecycleOf(db, older))?.deletedAt ?? null).toBeNull();
    },
    HEAVY,
  );

  it(
    'refuses for a legal hold, a share by name, an agency answer and a contributor handover',
    async () => {
      const keep = await addDocument(db, owner, SHA_A);
      const held = await addDocument(db, owner, SHA_A);
      const shared = await addDocument(db, owner, SHA_A);
      const answered = await addDocument(db, owner, SHA_A);
      const handed = await addDocument(db, owner, SHA_A);
      await db
        .insert(schema.legalHolds)
        .values({ applicantId: owner.applicantId, documentId: held, reason: 'synthetic' });
      const org = await createOrganization(db, { actorAccountId: owner.accountId, name: 'Acme' });
      if (!isOk(org)) throw new Error('org');
      await db.insert(schema.grants).values({
        applicantId: owner.applicantId,
        recipientOrganizationId: org.value.id,
        actions: ['VIEW_METADATA'],
        documentIds: [shared],
        purpose: 'review',
        status: 'ACTIVE',
      });
      await db.insert(schema.evidenceRequests).values({
        organizationId: org.value.id,
        applicantId: owner.applicantId,
        kind: 'DOCUMENT',
        respondingDocumentId: answered,
      });
      const mission = await caseUsing(db, owner, keep);
      await db.insert(schema.contributorRequests).values({
        missionId: mission,
        applicantId: owner.applicantId,
        contributorEmail: 'sponsor@example.com',
        docType: 'PASSPORT',
        purpose: 'sponsor',
        tokenHash: 'synthetic-token-hash',
        expiresAt: new Date(Date.now() + DAY_MS),
        submittedDocumentId: handed,
      });
      const proof = await manage(db, owner);
      const statuses = await duplicateStatuses(db, [keep, held, shared, answered, handed], proof);
      expect(statuses.get(held)?.blockReason).toBe('LEGAL_HOLD');
      expect(statuses.get(shared)?.blockReason).toBe('SHARED_BY_NAME');
      expect(statuses.get(answered)?.blockReason).toBe('AGENCY_REQUEST_ANSWER');
      expect(statuses.get(handed)?.blockReason).toBe('CONTRIBUTOR_HANDOVER');
      expect(statuses.get(keep)?.blockReason).toBeNull();
      for (const id of [held, shared, answered, handed]) {
        expect((await deleteDuplicate(proof, { documentId: id })).ok).toBe(false);
      }
    },
    HEAVY,
  );

  it(
    'moves AI app choices to the copy that stays',
    async () => {
      const older = await addDocument(db, owner, SHA_A);
      const newer = await addDocument(db, owner, SHA_A);
      const [connection] = await db
        .insert(schema.aiConnections)
        .values({
          accountId: owner.accountId,
          applicantId: owner.applicantId,
          clientId: 'synthetic',
          clientName: 'Synthetic App',
          clientHost: 'app.example.com',
          caseMode: 'NONE',
        })
        .returning({ id: schema.aiConnections.id });
      if (!connection) throw new Error('connection');
      await db
        .insert(schema.aiConnectionDocuments)
        .values({ connectionId: connection.id, documentId: newer, variant: 'SAFE_COPY' });
      const deleted = await deleteDuplicate(await manage(db, owner), { documentId: newer });
      expect(deleted.ok).toBe(true);
      const choices = await db
        .select({ documentId: schema.aiConnectionDocuments.documentId })
        .from(schema.aiConnectionDocuments)
        .where(eq(schema.aiConnectionDocuments.connectionId, connection.id));
      expect(choices.map((c) => c.documentId)).toEqual([older]);
      if (deleted.ok) {
        const effects = (await receiptOf(db, deleted.value.receiptId))?.effects;
        expect(effects).toMatchObject({ aiChoicesMoved: 1 });
      }
    },
    HEAVY,
  );

  it(
    'purges only after 30 days, through verified erasure, and cannot be restored then',
    async () => {
      await addDocument(db, owner, SHA_A);
      const newer = await addDocument(db, owner, SHA_A);
      const proof = await manage(db, owner);
      const deleted = await deleteDuplicate(proof, { documentId: newer });
      if (!deleted.ok) throw new Error('delete');

      expect((await purgeDueDocuments(db, erasureScope())).queued).toBe(0);
      expect(await erasureJobsFor(db, newer)).toBe(0);

      const later = new Date(Date.now() + 31 * DAY_MS);
      expect(await purgeDueDocuments(db, erasureScope(), { now: later })).toEqual({
        queued: 1,
        removed: 0,
        blocked: 0,
        failed: 0,
      });
      expect(await erasureJobsFor(db, newer)).toBe(1);
      expect((await receiptOf(db, deleted.value.receiptId))?.status).toBe('REMOVING');
      // The document row stays until the erasure worker verifies the file is gone.
      expect(await lifecycleOf(db, newer)).toBeDefined();
      const restored = await restoreDeleted(proof, { documentId: newer }, { now: later });
      expect(restored.ok).toBe(false);
      if (!restored.ok) expect(restored.error.message).toBe(RESTORE_REFUSALS.tooLate);
      // A second run does not queue it again.
      expect((await purgeDueDocuments(db, erasureScope(), { now: later })).queued).toBe(0);
    },
    HEAVY,
  );

  // Red first (lanes/C.md).
  it(
    'never purges under a legal hold placed during the 30 days',
    async () => {
      await addDocument(db, owner, SHA_A);
      const newer = await addDocument(db, owner, SHA_A);
      const deleted = await deleteDuplicate(await manage(db, owner), { documentId: newer });
      if (!deleted.ok) throw new Error('delete');
      const [hold] = await db
        .insert(schema.legalHolds)
        .values({ applicantId: owner.applicantId, reason: 'synthetic' })
        .returning({ id: schema.legalHolds.id });
      const later = new Date(Date.now() + 31 * DAY_MS);
      expect((await purgeDueDocuments(db, erasureScope(), { now: later })).blocked).toBe(1);
      expect(await erasureJobsFor(db, newer)).toBe(0);
      expect((await receiptOf(db, deleted.value.receiptId))?.status).toBe('BLOCKED');
      const [doc] = await db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, newer));
      expect(doc).toBeDefined();

      // Released: the next run starts the removal.
      if (!hold) throw new Error('hold');
      await db
        .update(schema.legalHolds)
        .set({ active: false })
        .where(eq(schema.legalHolds.id, hold.id));
      expect((await purgeDueDocuments(db, erasureScope(), { now: later })).queued).toBe(1);
    },
    HEAVY,
  );

  it(
    'lets only the record owner delete, and only with the erasure job purge',
    async () => {
      await addDocument(db, owner, SHA_A);
      const newer = await addDocument(db, owner, SHA_A);
      const read = await requireAccess(
        db,
        accountPrincipal(owner.accountId),
        'VIEW_METADATA',
        { applicantId: owner.applicantId },
        { purpose: 'self' },
      );
      if (!read.ok) throw new Error('proof');
      const refused = await deleteDuplicate(
        read.value as unknown as AuthorizedApplicant<'MANAGE'>,
        { documentId: newer },
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe('forbidden');
      await expect(
        purgeDueDocuments(
          db,
          systemScopeForTest('process-deletions') as unknown as ReturnType<typeof erasureScope>,
        ),
      ).rejects.toThrow();
    },
    HEAVY,
  );

  it(
    'queues the reading again when a document read while deleted comes back',
    async () => {
      await addDocument(db, owner, SHA_A);
      const newer = await addDocument(db, owner, SHA_A);
      const proof = await manage(db, owner);
      const [version] = await db
        .select({ id: schema.documentVersions.id })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, newer));
      if (!version) throw new Error('version');
      const deleted = await deleteDuplicate(proof, { documentId: newer });
      if (!deleted.ok) throw new Error('delete');
      // The reading ran (and skipped it quietly) while it was deleted.
      await db.insert(schema.processingJobs).values({
        documentVersionId: version.id,
        idempotencyKey: `${version.id}:AI_READING:1`,
        status: 'DONE',
        completedAt: new Date(Date.now() + 1000),
      });
      expect((await restoreDeleted(proof, { documentId: newer })).ok).toBe(true);
      const [job] = await db
        .select({ status: schema.processingJobs.status })
        .from(schema.processingJobs)
        .where(
          and(
            eq(schema.processingJobs.documentVersionId, version.id),
            eq(schema.processingJobs.idempotencyKey, `${version.id}:AI_READING:1`),
          ),
        );
      expect(job?.status).toBe('PENDING');
    },
    HEAVY,
  );
});
