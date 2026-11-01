import { type Result, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from '../../access';
import { provisionAccount } from '../../accounts';
import { createApplicant } from '../../applicants';
import { setConsent } from '../../consent';
import type { Db } from '../../db';
import { addDocumentVersion, registerDocument } from '../../documents';
import type { ServiceError } from '../../errors';
import { attachPackVersion, computeReadiness, createMission, selectEvidence } from '../../missions';
import { createOrganization, reviewOrganization } from '../../organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from '../../packs';
import { acceptGrant, createGrant } from '../../sharing';
import { getDocumentLifecycle } from '../foundation';
import { archiveDocument, restoreDocument } from './archive';

function code<T>(result: Result<T, ServiceError>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

async function account(db: Db, email: string): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error(`provision ${email}`);
  return result.value.id;
}

async function setUp(options: { readonly withoutLifecycle?: boolean } = {}) {
  const client = await createMigratedPglite();
  if (options.withoutLifecycle) {
    await client.exec(
      'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade',
    );
  }
  const db = drizzle(client, { schema }) as unknown as Db;
  const ownerId = await account(db, 'owner@example.com');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const applicantId = applicant.value.id;
  const addDocument = async (name: string) => {
    const doc = await registerDocument(db, {
      actorAccountId: ownerId,
      applicantId,
      originalName: name,
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: ownerId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: `k-${name}`,
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    return doc.value.id;
  };
  const documentId = await addDocument('bank.pdf');
  const manage = async (accountId = ownerId, ref: object = { documentId }) => {
    const proof = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      ref as { documentId: string },
      { purpose: EACH_GRANT },
    );
    if (!proof.ok) throw new Error(`manage proof: ${proof.error.code}`);
    return proof.value;
  };
  const lifecycleRow = async () =>
    (
      await db
        .select()
        .from(schema.documentLifecycle)
        .where(eq(schema.documentLifecycle.documentId, documentId))
    )[0];
  const auditTypes = async () =>
    (
      await db
        .select({ eventType: schema.auditEvents.eventType, metadata: schema.auditEvents.metadata })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.resourceId, documentId),
            eq(schema.auditEvents.resourceType, 'document'),
          ),
        )
    ).filter(
      (row) => row.eventType === 'DOCUMENT_ARCHIVED' || row.eventType === 'DOCUMENT_RESTORED',
    );
  const productTypes = async () =>
    (await db.select({ eventType: schema.productEvents.eventType }).from(schema.productEvents))
      .map((row) => row.eventType)
      .filter((type) => type === 'DOCUMENT_ARCHIVED' || type === 'DOCUMENT_RESTORED');
  return {
    db,
    ownerId,
    applicantId,
    documentId,
    addDocument,
    manage,
    lifecycleRow,
    auditTypes,
    productTypes,
  };
}

describe('LC-A1 archiveDocument / restoreDocument', () => {
  it('the owner archives and restores, recorded once each, ids only in the audit trail', async () => {
    const t = await setUp();
    const archived = await archiveDocument(t.documentId, await t.manage());
    expect(archived).toEqual({ ok: true, value: { state: 'ARCHIVED', changed: true } });
    const row = await t.lifecycleRow();
    expect(row?.archivedAt).toBeInstanceOf(Date);
    expect(row?.archivedByAccountId).toBe(t.ownerId);
    expect(row?.applicantId).toBe(t.applicantId);
    expect(row?.deletedAt).toBeNull();
    const proof = await t.manage();
    expect((await getDocumentLifecycle(t.db, t.documentId, proof))?.state).toBe('ARCHIVED');

    // A second click (or a racing Undo) changes nothing and records nothing.
    expect(await archiveDocument(t.documentId, await t.manage())).toEqual({
      ok: true,
      value: { state: 'ARCHIVED', changed: false },
    });

    const restored = await restoreDocument(t.documentId, await t.manage());
    expect(restored).toEqual({ ok: true, value: { state: 'CURRENT', changed: true } });
    const after = await t.lifecycleRow();
    expect(after?.archivedAt).toBeNull();
    expect(after?.archivedByAccountId).toBeNull();
    expect((await getDocumentLifecycle(t.db, t.documentId, proof))?.state).toBe('CURRENT');
    expect(await restoreDocument(t.documentId, await t.manage())).toEqual({
      ok: true,
      value: { state: 'CURRENT', changed: false },
    });

    const audit = await t.auditTypes();
    expect(audit.map((row) => row.eventType)).toEqual(['DOCUMENT_ARCHIVED', 'DOCUMENT_RESTORED']);
    for (const row of audit) expect(JSON.stringify(row.metadata ?? {})).not.toContain('bank');
    expect(await t.productTypes()).toEqual(['DOCUMENT_ARCHIVED', 'DOCUMENT_RESTORED']);

    // Archive again after a restore: the same row is used again.
    expect(code(await archiveDocument(t.documentId, await t.manage()))).toBeUndefined();
    expect((await t.lifecycleRow())?.archivedAt).toBeInstanceOf(Date);
  });

  it('works from a proof for the whole record as well as for the document', async () => {
    const t = await setUp();
    const recordProof = await t.manage(t.ownerId, { applicantId: t.applicantId });
    expect(code(await archiveDocument(t.documentId, recordProof))).toBeUndefined();
    expect(code(await restoreDocument(t.documentId, recordProof))).toBeUndefined();
  });

  it('never changes the document itself (its retention clock), its case selections or its shares', async () => {
    const t = await setUp();
    const pack = await createPack(t.db, { actorAccountId: t.ownerId, key: 'uk', name: 'UK' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(t.db, {
      actorAccountId: t.ownerId,
      packId: pack.value.id,
    });
    if (!isOk(version)) throw new Error('version');
    const requirement = await addRequirement(t.db, {
      actorAccountId: t.ownerId,
      packVersionId: version.value.id,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      citation: 'rule',
    });
    if (!isOk(requirement)) throw new Error('requirement');
    await approvePackVersion(t.db, { actorAccountId: t.ownerId, packVersionId: version.value.id });
    await publishPackVersion(t.db, { actorAccountId: t.ownerId, packVersionId: version.value.id });
    const mission = await createMission(t.db, {
      actorAccountId: t.ownerId,
      applicantId: t.applicantId,
      title: 'UK',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(t.db, {
      actorAccountId: t.ownerId,
      missionId: mission.value.id,
      packVersionId: version.value.id,
    });
    expect(
      isOk(
        await selectEvidence(t.db, {
          actorAccountId: t.ownerId,
          missionId: mission.value.id,
          packRequirementId: requirement.value.id,
          documentId: t.documentId,
        }),
      ),
    ).toBe(true);
    const readerId = await account(t.db, 'reader@example.com');
    const grant = await createGrant(t.db, {
      actorAccountId: t.ownerId,
      applicantId: t.applicantId,
      recipientAccountId: readerId,
      actions: ['VIEW_METADATA'],
      documentIds: [t.documentId],
      purpose: 'visa-review',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    const documentBefore = await t.db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, t.documentId));
    const selectionsBefore = await t.db.select().from(schema.selectedEvidence);
    const grantsBefore = await t.db.select().from(schema.grants);
    const missionBefore = await t.db.select().from(schema.missions);

    expect(code(await archiveDocument(t.documentId, await t.manage()))).toBeUndefined();
    expect(
      await t.db.select().from(schema.documents).where(eq(schema.documents.id, t.documentId)),
    ).toEqual(documentBefore);
    expect(await t.db.select().from(schema.selectedEvidence)).toEqual(selectionsBefore);
    expect(await t.db.select().from(schema.grants)).toEqual(grantsBefore);
    expect(await t.db.select().from(schema.missions)).toEqual(missionBefore);
    // The case chose it on purpose, so it still counts there (D6), flagged.
    const readiness = await computeReadiness(t.db, mission.value.id);
    if (!isOk(readiness)) throw new Error('readiness');
    expect(readiness.value.requirementResults[0]?.state).toBe('SATISFIED');
    expect(readiness.value.requirementResults[0]?.selectedButReplacedOrArchived).toBe(true);

    expect(code(await restoreDocument(t.documentId, await t.manage()))).toBeUndefined();
    expect(
      await t.db.select().from(schema.documents).where(eq(schema.documents.id, t.documentId)),
    ).toEqual(documentBefore);
  });

  it('refuses a stranger at the gate, and an agency recipient, a guessed id, another document and a copied proof with not found', async () => {
    const t = await setUp();
    const strangerId = await account(t.db, 'stranger@example.com');
    const stranger = await requireAccess(
      t.db,
      accountPrincipal(strangerId),
      'MANAGE',
      { documentId: t.documentId },
      { purpose: EACH_GRANT },
    );
    expect(stranger.ok).toBe(false);

    // An agency with MANAGE on the whole record still cannot archive the owner's documents.
    const agentId = await account(t.db, 'agent@acme.example.com');
    const org = await createOrganization(t.db, { actorAccountId: agentId, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await account(t.db, 'reviewer@platform.example.com');
    await reviewOrganization(t.db, {
      reviewerAccountId: reviewer,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const grant = await createGrant(t.db, {
      actorAccountId: t.ownerId,
      applicantId: t.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['VIEW_METADATA', 'MANAGE'],
      purpose: 'visa-review',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    const accepted = await acceptGrant(t.db, { actorAccountId: agentId, grantId: grant.value.id });
    if (!isOk(accepted)) throw new Error('accept');
    const agencyProof = await t.manage(agentId, { applicantId: t.applicantId });
    expect(agencyProof.actor.kind).toBe('organization_member');
    expect(code(await archiveDocument(t.documentId, agencyProof))).toBe('not_found');
    expect(code(await restoreDocument(t.documentId, agencyProof))).toBe('not_found');

    const owner = await t.manage(t.ownerId, { applicantId: t.applicantId });
    expect(code(await archiveDocument('00000000-0000-4000-8000-000000000000', owner))).toBe(
      'not_found',
    );
    expect(code(await archiveDocument('not-a-uuid', owner))).toBe('not_found');

    // A proof for one document never reaches another.
    const other = await t.addDocument('other.pdf');
    expect(code(await archiveDocument(other, await t.manage()))).toBe('not_found');

    // Another person's document, named with this owner's record proof.
    const secondOwner = await account(t.db, 'second@example.com');
    await setConsent(t.db, {
      actorAccountId: secondOwner,
      accountId: secondOwner,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const theirs = await createApplicant(t.db, {
      actorAccountId: secondOwner,
      ownerAccountId: secondOwner,
      displayName: 'Second',
    });
    if (!isOk(theirs)) throw new Error('second applicant');
    const theirDoc = await registerDocument(t.db, {
      actorAccountId: secondOwner,
      applicantId: theirs.value.id,
      originalName: 'theirs.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(theirDoc)) throw new Error('their doc');
    expect(code(await archiveDocument(theirDoc.value.id, owner))).toBe('not_found');

    const copy = { ...(await t.manage()) } as never;
    expect(code(await archiveDocument(t.documentId, copy))).toBe('not_found');
    const viewProof = await requireAccess(
      t.db,
      accountPrincipal(t.ownerId),
      'VIEW_METADATA',
      { documentId: t.documentId },
      { purpose: EACH_GRANT },
    );
    if (!viewProof.ok) throw new Error('view proof');
    expect(code(await archiveDocument(t.documentId, viewProof.value as never))).toBe('not_found');

    expect(await t.lifecycleRow()).toBeUndefined();
    expect(await t.auditTypes()).toEqual([]);
  });

  it('leaves a document in Recently Deleted alone', async () => {
    const t = await setUp();
    const now = new Date();
    await t.db.insert(schema.documentLifecycle).values({
      documentId: t.documentId,
      applicantId: t.applicantId,
      deletedAt: now,
      deletePath: 'DUPLICATE',
      purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(code(await archiveDocument(t.documentId, await t.manage()))).toBe('invalid');
    expect(code(await restoreDocument(t.documentId, await t.manage()))).toBe('invalid');
    const row = await t.lifecycleRow();
    expect(row?.archivedAt).toBeNull();
    expect(row?.deletedAt).toEqual(now);
  });

  it('answers not found and writes nothing while the lifecycle tables are missing', async () => {
    const t = await setUp({ withoutLifecycle: true });
    expect(code(await archiveDocument(t.documentId, await t.manage()))).toBe('not_found');
    expect(code(await restoreDocument(t.documentId, await t.manage()))).toBe('not_found');
    expect(await t.auditTypes()).toEqual([]);
    expect(await t.productTypes()).toEqual([]);
  });
});
