import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import {
  decideEvidenceResponse,
  listEvidenceRequestDecisions,
  startEvidenceReview,
} from './agency';
import type { Db } from './db';
import { readDocumentAccessToken } from './document-access-token';
import { recheckDocumentAccess } from './documents';
import {
  LEGACY_SEND_LABEL,
  downloadEvidenceSubmissionFile,
  listEvidenceSubmissions,
} from './evidence-submissions';
import {
  ACCESS_TOKEN_SECRET,
  type Agency,
  FakeStorage,
  type Traveller,
  addVersion,
  agency,
  agencyProof,
  cleanDocument,
  freshDb,
  openRequest,
  ownerProof,
  send,
  share,
  stepUpFor,
  traveller,
} from './evidence-submissions.test-support';
import { revokeGrant } from './sharing';

/**
 * Lane D: the exact copy a traveller sends in answer to an evidence request, its decision, its
 * list and the agency's original download. Two travellers, two agencies, synthetic data only.
 */

const TIMEOUT = 120_000;

interface World {
  db: Db;
  alice: Traveller;
  bob: Traveller;
  harbor: Agency;
  summit: Agency;
}

async function world(): Promise<World> {
  const db = await freshDb();
  const alice = await traveller(db, 'alice-d@example.com');
  const bob = await traveller(db, 'bob-d@example.com');
  const harbor = await agency(db, 'harbor-d@example.com', 'Harbor Visas');
  const summit = await agency(db, 'summit-d@example.com', 'Summit Visas');
  await share(db, alice, harbor);
  await share(db, alice, summit);
  await share(db, bob, harbor);
  return { db, alice, bob, harbor, summit };
}

async function submissionRows(db: Db, requestId: string) {
  return db
    .select()
    .from(schema.evidenceRequestSubmissions)
    .where(eq(schema.evidenceRequestSubmissions.evidenceRequestId, requestId));
}

async function decide(
  w: World,
  requestId: string,
  outcome: 'ACCEPTED' | 'NEEDS_REPLACEMENT' | 'CONTRADICTION' | 'CORRECTION_PROPOSED',
  extra: { submissionId?: string; agencyOf?: Agency } = {},
) {
  const who = extra.agencyOf ?? w.harbor;
  return decideEvidenceResponse(w.db, {
    actorAccountId: who.accountId,
    requestId,
    outcome,
    ...(outcome === 'ACCEPTED' ? {} : { reason: 'does not stand' }),
    ...(extra.submissionId ? { submissionId: extra.submissionId } : {}),
  });
}

describe('Lane D: sending an exact copy', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, TIMEOUT);

  it('pins the exact version, its stored object, size and checksum, and keeps the older pointers', async () => {
    const doc = await cleanDocument(w.db, w.alice, 'bank_statement', 'march.pdf', 'b'.repeat(64));
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    const sent = await send(w.db, w.alice, requestId, doc.documentId);
    expect(isOk(sent)).toBe(true);
    if (!isOk(sent)) return;
    expect(sent.value.status).toBe('RECEIVED');
    expect(sent.value.respondingDocumentId).toBe(doc.documentId);
    expect(sent.value.replayed).toBe(false);
    const [row] = await submissionRows(w.db, requestId);
    expect(sent.value.submissionId).toBe(row?.id);
    expect(row).toMatchObject({
      roundNo: 1,
      documentId: doc.documentId,
      documentVersionId: doc.versionId,
      storageObjectId: doc.storageObjectId,
      contentSha256: 'b'.repeat(64),
      sizeBytes: 1234,
      versionNumber: 1,
      docTypeAtSend: 'bank_statement',
      titleAtSend: 'march.pdf',
      sentByAccountId: w.alice.accountId,
    });
    expect(row?.grantIdAtSend).not.toBeNull();
  });

  it('keeps a later upload out of an earlier send, and two sends stay two distinct copies', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    const first = await send(w.db, w.alice, requestId, doc.documentId);
    expect(isOk(first)).toBe(true);
    // A newer version of the same document arrives after sending.
    const newer = await addVersion(w.db, w.alice, doc.documentId, { sha256: 'c'.repeat(64) });
    let rows = await submissionRows(w.db, requestId);
    expect(rows.map((r) => r.documentVersionId)).toEqual([doc.versionId]);
    // The agency sends it back; the traveller corrects with the newer version.
    expect(isOk(await decide(w, requestId, 'NEEDS_REPLACEMENT'))).toBe(true);
    const second = await send(w.db, w.alice, requestId, doc.documentId);
    expect(isOk(second)).toBe(true);
    rows = (await submissionRows(w.db, requestId)).sort((a, b) => a.roundNo - b.roundNo);
    expect(rows.map((r) => [r.roundNo, r.documentVersionId])).toEqual([
      [1, doc.versionId],
      [2, newer.versionId],
    ]);
    expect(rows.map((r) => r.contentSha256)).toEqual(['a'.repeat(64), 'c'.repeat(64)]);
  });

  it('pins an older version when the traveller names it, and refuses a version of another document', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    await addVersion(w.db, w.alice, doc.documentId);
    const other = await cleanDocument(w.db, w.alice, 'bank_statement', 'other.pdf');
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    const wrong = await send(w.db, w.alice, requestId, doc.documentId, {
      documentVersionId: other.versionId,
    });
    expect(isErr(wrong) && wrong.error.code).toBe('not_found');
    expect(await submissionRows(w.db, requestId)).toEqual([]);
    const right = await send(w.db, w.alice, requestId, doc.documentId, {
      documentVersionId: doc.versionId,
    });
    expect(isOk(right)).toBe(true);
    const [row] = await submissionRows(w.db, requestId);
    expect(row?.documentVersionId).toBe(doc.versionId);
    expect(row?.versionNumber).toBe(1);
  });

  it('answers a retry with the same key with the first send and writes nothing more', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    const first = await send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: 'tap-1' });
    const again = await send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: 'tap-1' });
    expect(isOk(first) && isOk(again)).toBe(true);
    if (!isOk(first) || !isOk(again)) return;
    expect(again.value.submissionId).toBe(first.value.submissionId);
    expect(again.value.replayed).toBe(true);
    expect(await submissionRows(w.db, requestId)).toHaveLength(1);
    const events = await w.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'EVIDENCE_RESPONDED'));
    expect(events).toHaveLength(1);
  });

  it('refuses a second send with a different key while the first still waits', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    expect(
      isOk(await send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: 'a' })),
    ).toBe(true);
    const second = await send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: 'b' });
    expect(isErr(second) && second.error.code).toBe('invalid');
    expect(await submissionRows(w.db, requestId)).toHaveLength(1);
  });

  it('lets only one of two sends made at the same moment through', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    const results = await Promise.all([
      send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: 'x' }),
      send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: 'y' }),
    ]);
    expect(results.filter((r) => isOk(r))).toHaveLength(1);
    expect(await submissionRows(w.db, requestId)).toHaveLength(1);
  });

  it('gives a stranger the same answer as a request that does not exist, and writes nothing', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    const bobDoc = await cleanDocument(w.db, w.bob);
    const stranger = await send(w.db, w.bob, requestId, bobDoc.documentId);
    const missing = await send(
      w.db,
      w.bob,
      '00000000-0000-4000-8000-000000000000',
      bobDoc.documentId,
    );
    expect(isErr(stranger) && isErr(missing)).toBe(true);
    if (!isErr(stranger) || !isErr(missing)) return;
    expect(stranger.error).toEqual(missing.error);
    expect(await submissionRows(w.db, requestId)).toEqual([]);
    // Someone else's file is not a valid answer either.
    const stolen = await send(w.db, w.alice, requestId, bobDoc.documentId);
    expect(isErr(stolen) && stolen.error.code).toBe('not_found');
    expect(doc.documentId).toBeDefined();
  });

  it('refuses a file that is not safe to share, and writes nothing', async () => {
    const unsafe = await cleanDocument(w.db, w.alice);
    await w.db
      .update(schema.documentVersions)
      .set({ safetyStatus: 'QUARANTINED' })
      .where(eq(schema.documentVersions.id, unsafe.versionId));
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    const refused = await send(w.db, w.alice, requestId, unsafe.documentId);
    expect(isErr(refused) && refused.error.code).toBe('invalid');
    expect(await submissionRows(w.db, requestId)).toEqual([]);
    const [request] = await w.db
      .select()
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, requestId));
    expect(request?.status).toBe('OPEN');
  });

  it('refuses a send once the organization has lost its standing', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    // Revoked grant.
    const revokedRequest = await openRequest(w.db, w.summit, w.alice);
    const grants = await w.db
      .select()
      .from(schema.grants)
      .where(
        and(
          eq(schema.grants.applicantId, w.alice.applicantId),
          eq(schema.grants.recipientOrganizationId, w.summit.organizationId),
        ),
      );
    const revoked = await revokeGrant(w.db, {
      actorAccountId: w.alice.accountId,
      grantId: grants[0]?.id ?? '',
    });
    expect(isOk(revoked)).toBe(true);
    const afterRevoke = await send(w.db, w.alice, revokedRequest, doc.documentId);
    expect(isErr(afterRevoke) && afterRevoke.error.code).toBe('forbidden');

    // Expired grant.
    const expiredRequest = await openRequest(w.db, w.harbor, w.alice);
    await w.db
      .update(schema.grants)
      .set({ expiryAt: new Date(Date.now() - 60_000) })
      .where(
        and(
          eq(schema.grants.applicantId, w.alice.applicantId),
          eq(schema.grants.recipientOrganizationId, w.harbor.organizationId),
        ),
      );
    const afterExpiry = await send(w.db, w.alice, expiredRequest, doc.documentId);
    expect(isErr(afterExpiry) && afterExpiry.error.code).toBe('forbidden');

    for (const id of [revokedRequest, expiredRequest]) {
      expect(await submissionRows(w.db, id)).toEqual([]);
    }
  });

  it('refuses a send to a suspended organization', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    await w.db
      .update(schema.organizations)
      .set({ status: 'SUSPENDED' })
      .where(eq(schema.organizations.id, w.harbor.organizationId));
    const refused = await send(w.db, w.alice, requestId, doc.documentId);
    expect(isErr(refused) && refused.error.code).toBe('forbidden');
    expect(await submissionRows(w.db, requestId)).toEqual([]);
  });

  it('keeps no record for a fact (a value is not a file) and still guards the status', async () => {
    const { registerFieldDefinition, editFact } = await import('./profile');
    await registerFieldDefinition(w.db, { key: 'given_name', dataType: 'string' });
    const fact = await editFact(w.db, {
      actorAccountId: w.alice.accountId,
      applicantId: w.alice.applicantId,
      fieldKey: 'given_name',
      value: 'Alice',
    });
    if (!isOk(fact)) throw new Error('fact');
    const { requestEvidence, submitEvidenceResponse } = await import('./agency');
    const request = await requestEvidence(w.db, {
      actorAccountId: w.harbor.accountId,
      organizationId: w.harbor.organizationId,
      applicantId: w.alice.applicantId,
      kind: 'FIELD',
      fieldKey: 'given_name',
    });
    if (!isOk(request)) throw new Error('request');
    const sent = await submitEvidenceResponse(w.db, {
      actorAccountId: w.alice.accountId,
      requestId: request.value.id,
      factId: fact.value.fact.id,
    });
    expect(isOk(sent) ? 'ok' : JSON.stringify(sent.error)).toBe('ok');
    if (isOk(sent)) expect(sent.value.submissionId).toBeNull();
    expect(await submissionRows(w.db, request.value.id)).toEqual([]);
    const again = await submitEvidenceResponse(w.db, {
      actorAccountId: w.alice.accountId,
      requestId: request.value.id,
      factId: fact.value.fact.id,
    });
    expect(isErr(again) && again.error.code).toBe('invalid');
  });
});

describe('Lane D: deciding on an exact copy', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, TIMEOUT);

  async function sentRequest(extra: { docType?: string } = {}) {
    const doc = await cleanDocument(w.db, w.alice, extra.docType);
    const requestId = await openRequest(w.db, w.harbor, w.alice, extra.docType);
    const sent = await send(w.db, w.alice, requestId, doc.documentId);
    if (!isOk(sent)) throw new Error('send');
    return { doc, requestId, submissionId: sent.value.submissionId ?? '' };
  }

  it('links an acceptance to the one copy that was reviewed', async () => {
    const { requestId, submissionId } = await sentRequest();
    const accepted = await decide(w, requestId, 'ACCEPTED', { submissionId });
    expect(isOk(accepted)).toBe(true);
    if (!isOk(accepted)) return;
    expect(accepted.value.decidedSubmissionId).toBe(submissionId);
    const links = await w.db.select().from(schema.evidenceRequestDecisionSubmissions);
    expect(links.map((l) => l.submissionId)).toEqual([submissionId]);
    const history = await listEvidenceRequestDecisions(w.db, w.alice.accountId, requestId);
    expect(isOk(history) && history.value[0]?.id).toBe(links[0]?.decisionId);
  });

  it('keeps an earlier copy reviewable and distinct after a replacement is sent', async () => {
    const first = await sentRequest();
    expect(isOk(await decide(w, first.requestId, 'CONTRADICTION'))).toBe(true);
    const doc2 = await cleanDocument(w.db, w.alice, 'bank_statement', 'second.pdf', 'd'.repeat(64));
    const second = await send(w.db, w.alice, first.requestId, doc2.documentId);
    expect(isOk(second)).toBe(true);
    const listed = await listEvidenceSubmissions(
      await agencyProof(w.db, w.harbor, w.alice.applicantId),
      {
        requestId: first.requestId,
      },
    );
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value.submissions.map((s) => [s.roundNo, s.state, s.title])).toEqual([
      [1, 'CONTRADICTION', 'statement.pdf'],
      [2, 'AWAITING_DECISION', 'second.pdf'],
    ]);
    expect(listed.value.submissions[0]?.reason).toBe('does not stand');
    expect(listed.value.legacy).toEqual([]);
  });

  it('refuses to decide on a copy that was replaced, and records nothing', async () => {
    const first = await sentRequest();
    expect(isOk(await decide(w, first.requestId, 'NEEDS_REPLACEMENT'))).toBe(true);
    const doc2 = await cleanDocument(w.db, w.alice, 'bank_statement', 'second.pdf');
    expect(isOk(await send(w.db, w.alice, first.requestId, doc2.documentId))).toBe(true);
    const before = await w.db.select().from(schema.evidenceRequestDecisions);
    // The reviewer still looks at the first copy.
    const stale = await decide(w, first.requestId, 'ACCEPTED', {
      submissionId: first.submissionId,
    });
    expect(isErr(stale) && stale.error.code).toBe('stale');
    expect(await w.db.select().from(schema.evidenceRequestDecisions)).toHaveLength(before.length);
    const [request] = await w.db
      .select()
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, first.requestId));
    expect(request?.status).toBe('RECEIVED');
  });

  it('decides a copy only once', async () => {
    const { requestId, submissionId } = await sentRequest();
    expect(isOk(await decide(w, requestId, 'ACCEPTED', { submissionId }))).toBe(true);
    const again = await decide(w, requestId, 'NEEDS_REPLACEMENT', { submissionId });
    expect(isErr(again)).toBe(true);
    expect(await w.db.select().from(schema.evidenceRequestDecisionSubmissions)).toHaveLength(1);
    // And the database itself refuses a second decision on the same copy.
    const [decision] = await w.db.select().from(schema.evidenceRequestDecisions);
    const [other] = await w.db
      .insert(schema.evidenceRequestDecisions)
      .values({
        evidenceRequestId: requestId,
        outcome: 'NEEDS_REPLACEMENT',
        decidedByAccountId: w.harbor.accountId,
      })
      .returning();
    await expect(
      w.db
        .insert(schema.evidenceRequestDecisionSubmissions)
        .values({ decisionId: other?.id ?? '', submissionId }),
    ).rejects.toThrow();
    expect(decision).toBeDefined();
  });

  it('lets only the asking agency decide, and only while it holds its standing', async () => {
    const { requestId } = await sentRequest();
    const otherAgency = await decide(w, requestId, 'ACCEPTED', { agencyOf: w.summit });
    expect(isErr(otherAgency) && otherAgency.error.code).toBe('forbidden');
    expect(await w.db.select().from(schema.evidenceRequestDecisionSubmissions)).toEqual([]);

    const grants = await w.db
      .select()
      .from(schema.grants)
      .where(
        and(
          eq(schema.grants.applicantId, w.alice.applicantId),
          eq(schema.grants.recipientOrganizationId, w.harbor.organizationId),
        ),
      );
    expect(
      isOk(
        await revokeGrant(w.db, {
          actorAccountId: w.alice.accountId,
          grantId: grants[0]?.id ?? '',
        }),
      ),
    ).toBe(true);
    const afterRevoke = await decide(w, requestId, 'ACCEPTED');
    expect(isErr(afterRevoke) && afterRevoke.error.code).toBe('forbidden');
    expect(await w.db.select().from(schema.evidenceRequestDecisions)).toEqual([]);
  });

  it('refuses to accept a copy whose file is no longer safe, but always allows sending it back', async () => {
    const { doc, requestId } = await sentRequest();
    await w.db
      .update(schema.documentVersions)
      .set({ safetyStatus: 'QUARANTINED' })
      .where(eq(schema.documentVersions.id, doc.versionId));
    const accepted = await decide(w, requestId, 'ACCEPTED');
    expect(isErr(accepted) && accepted.error.code).toBe('invalid');
    expect(await w.db.select().from(schema.evidenceRequestDecisions)).toEqual([]);
    expect(isOk(await decide(w, requestId, 'NEEDS_REPLACEMENT'))).toBe(true);
  });

  it('refuses to accept a copy whose checksum changed after it was sent', async () => {
    const { doc, requestId } = await sentRequest();
    await w.db
      .update(schema.documentVersions)
      .set({ sha256: 'e'.repeat(64) })
      .where(eq(schema.documentVersions.id, doc.versionId));
    const accepted = await decide(w, requestId, 'ACCEPTED');
    expect(isErr(accepted) && accepted.error.code).toBe('invalid');
  });

  it('refuses to accept a copy whose stored object is no longer the one sent', async () => {
    const { doc, requestId } = await sentRequest();
    const other = await cleanDocument(w.db, w.alice);
    await w.db
      .update(schema.documentVersions)
      .set({ storageObjectId: other.storageObjectId })
      .where(eq(schema.documentVersions.id, doc.versionId));
    const accepted = await decide(w, requestId, 'ACCEPTED');
    expect(isErr(accepted) && accepted.error.code).toBe('invalid');
  });

  it('refuses to accept a copy that was filed as a different kind after it was sent', async () => {
    const { doc, requestId } = await sentRequest();
    await w.db
      .update(schema.documents)
      .set({ docType: 'passport' })
      .where(eq(schema.documents.id, doc.documentId));
    const accepted = await decide(w, requestId, 'ACCEPTED');
    expect(isErr(accepted) && accepted.error.code).toBe('invalid');
  });

  it('still accepts the same copy after the document was archived or replaced by a newer one', async () => {
    const { doc, requestId, submissionId } = await sentRequest();
    const newer = await cleanDocument(w.db, w.alice, 'bank_statement', 'newer.pdf');
    await w.db
      .update(schema.documents)
      .set({ supersededByDocumentId: newer.documentId })
      .where(eq(schema.documents.id, doc.documentId));
    await addVersion(w.db, w.alice, doc.documentId);
    const accepted = await decide(w, requestId, 'ACCEPTED', { submissionId });
    expect(isOk(accepted)).toBe(true);
    const [row] = await submissionRows(w.db, requestId);
    expect(row?.documentVersionId).toBe(doc.versionId);
  });

  it('does not let a review start undo a decision already made', async () => {
    const { requestId } = await sentRequest();
    expect(isOk(await decide(w, requestId, 'ACCEPTED'))).toBe(true);
    const started = await startEvidenceReview(w.db, {
      actorAccountId: w.harbor.accountId,
      requestId,
    });
    expect(isErr(started)).toBe(true);
  });
});

describe('Lane D: listing the copies', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, TIMEOUT);

  it('shows safe facts only, to the traveller and to the asking agency, and no storage key', async () => {
    const doc = await cleanDocument(w.db, w.alice, 'bank_statement', 'march.pdf', 'f'.repeat(64));
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);

    const asAgency = await listEvidenceSubmissions(
      await agencyProof(w.db, w.harbor, w.alice.applicantId),
      { requestId },
    );
    const asOwner = await listEvidenceSubmissions(await ownerProof(w.db, w.alice), { requestId });
    expect(isOk(asAgency) && isOk(asOwner)).toBe(true);
    if (!isOk(asAgency) || !isOk(asOwner)) return;
    expect(asAgency.value.available).toBe(true);
    expect(asAgency.value.submissions[0]).toMatchObject({
      roundNo: 1,
      versionNumber: 1,
      docType: 'bank_statement',
      title: 'march.pdf',
      sizeBytes: 1234,
      checksumFingerprint: 'f'.repeat(12),
      state: 'AWAITING_DECISION',
      fileAvailable: true,
    });
    // The traveller never gets a download affordance from this list.
    expect(asOwner.value.submissions[0]?.fileAvailable).toBe(false);
    for (const listed of [asAgency, asOwner]) {
      const text = JSON.stringify(listed.value);
      expect(text).not.toContain(doc.objectKey);
      expect(text).not.toContain(doc.storageObjectId);
      expect(text).not.toContain('f'.repeat(64));
    }
  });

  it('answers a stranger, another agency, another traveller and a missing request alike', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);

    // Summit holds a MANAGE grant on Alice too, but this request is Harbor's.
    const summit = await listEvidenceSubmissions(
      await agencyProof(w.db, w.summit, w.alice.applicantId),
      { requestId },
    );
    // Bob is a different traveller with his own proof.
    const bob = await listEvidenceSubmissions(await ownerProof(w.db, w.bob), { requestId });
    const missing = await listEvidenceSubmissions(await ownerProof(w.db, w.alice), {
      requestId: '00000000-0000-4000-8000-000000000000',
    });
    const malformed = await listEvidenceSubmissions(await ownerProof(w.db, w.alice), {
      requestId: 'not-an-id',
    });
    for (const refused of [summit, bob, missing, malformed]) {
      expect(isErr(refused) && refused.error.code).toBe('not_found');
    }
    expect(isErr(summit) && isErr(missing) && summit.error).toEqual(missing.error);
  });

  it('refuses an agency whose grant was revoked after the proof was made', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
    const proof = await agencyProof(w.db, w.harbor, w.alice.applicantId);
    const grants = await w.db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.recipientOrganizationId, w.harbor.organizationId));
    const mine = grants.find((g) => g.applicantId === w.alice.applicantId);
    expect(
      isOk(await revokeGrant(w.db, { actorAccountId: w.alice.accountId, grantId: mine?.id ?? '' })),
    ).toBe(true);
    const listed = await listEvidenceSubmissions(proof, { requestId });
    expect(isErr(listed) && listed.error.code).toBe('not_found');
  });

  it('labels a send made before exact copies were kept and never calls it pinned', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    // As the older code wrote it: pointers only, no exact-copy row.
    await w.db
      .update(schema.evidenceRequests)
      .set({ status: 'RECEIVED', respondingDocumentId: doc.documentId, respondedAt: new Date() })
      .where(eq(schema.evidenceRequests.id, requestId));
    const listed = await listEvidenceSubmissions(
      await agencyProof(w.db, w.harbor, w.alice.applicantId),
      {
        requestId,
      },
    );
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value.available).toBe(true);
    expect(listed.value.submissions).toEqual([]);
    expect(listed.value.legacy).toHaveLength(1);
    expect(listed.value.legacy[0]).toMatchObject({
      label: LEGACY_SEND_LABEL,
      documentId: doc.documentId,
      state: 'AWAITING_DECISION',
    });
    expect(LEGACY_SEND_LABEL).toBe('Sent before exact versions were kept');
    // A decision on it is recorded without a link, and says so.
    const decided = await decide(w, requestId, 'NEEDS_REPLACEMENT');
    expect(isOk(decided) && decided.value.decidedSubmissionId).toBeNull();
    const after = await listEvidenceSubmissions(
      await agencyProof(w.db, w.harbor, w.alice.applicantId),
      {
        requestId,
      },
    );
    expect(isOk(after) && after.value.legacy.map((l) => l.state)).toEqual(['NEEDS_REPLACEMENT']);
  });

  it('keeps working, and says so, while the exact-copy tables are missing', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    await w.db.execute(
      sql`drop table evidence_request_decision_submissions, evidence_request_submissions`,
    );
    const sent = await send(w.db, w.alice, requestId, doc.documentId);
    expect(isOk(sent)).toBe(true);
    if (isOk(sent)) expect(sent.value.submissionId).toBeNull();
    const listed = await listEvidenceSubmissions(
      await agencyProof(w.db, w.harbor, w.alice.applicantId),
      {
        requestId,
      },
    );
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value.available).toBe(false);
    expect(listed.value.submissions).toEqual([]);
    expect(listed.value.legacy.map((l) => l.label)).toEqual([LEGACY_SEND_LABEL]);
    const accepted = await decide(w, requestId, 'ACCEPTED');
    expect(isOk(accepted) && accepted.value.decidedSubmissionId).toBeNull();
    // No file can be opened without an exact copy.
    const download = await downloadEvidenceSubmissionFile(
      new FakeStorage(),
      await agencyProof(w.db, w.harbor, w.alice.applicantId),
      {
        submissionId: '00000000-0000-4000-8000-000000000000',
        accessTokenSecret: ACCESS_TOKEN_SECRET,
      },
    );
    expect(isErr(download) && download.error.code).toBe('not_found');
  });
});

describe('Lane D: the agency opens the exact original', () => {
  let w: World;
  let storage: FakeStorage;
  beforeEach(async () => {
    w = await world();
    storage = new FakeStorage();
  }, TIMEOUT);

  async function sentCopy(title = 'march.pdf') {
    const doc = await cleanDocument(w.db, w.alice, 'bank_statement', title);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    const sent = await send(w.db, w.alice, requestId, doc.documentId);
    if (!isOk(sent)) throw new Error('send');
    return { doc, requestId, submissionId: sent.value.submissionId ?? '' };
  }

  async function open(
    a: Agency,
    submissionId: string,
    versionId: string,
    opts: { stepUp?: boolean } = {},
  ) {
    return downloadEvidenceSubmissionFile(
      storage,
      await agencyProof(w.db, a, w.alice.applicantId),
      {
        submissionId,
        accessTokenSecret: ACCESS_TOKEN_SECRET,
        ...(opts.stepUp === false ? {} : { stepUp: stepUpFor(a.accountId, versionId) }),
      },
    );
  }

  function fieldsOf(url: string) {
    const fields = readDocumentAccessToken(new URL(url).searchParams);
    if (!fields) throw new Error('no access token on the link');
    return fields;
  }

  it('serves the original of the pinned version for 60 seconds, never a preview', async () => {
    const { doc, submissionId } = await sentCopy();
    const ref = await open(w.harbor, submissionId, doc.versionId);
    expect(isOk(ref)).toBe(true);
    if (!isOk(ref)) return;
    expect(ref.value.disposition).toBe('download');
    expect(ref.value.variant).toBe('original');
    expect(storage.calls).toHaveLength(1);
    expect(storage.calls[0]).toMatchObject({
      objectKey: doc.objectKey,
      disposition: 'download',
      variant: 'original',
      expiresInSeconds: 60,
      filename: 'march.pdf',
    });
    const fields = fieldsOf(ref.value.url);
    expect(fields).toMatchObject({
      actorKind: 'evidence_submission',
      documentVersionId: doc.versionId,
      action: 'DOWNLOAD_ORIGINAL',
      stepUpSatisfied: true,
      organizationId: w.harbor.organizationId,
      actorAccountId: w.harbor.accountId,
      purpose: `evidence_submission:${submissionId}`,
    });
    expect((await recheckDocumentAccess(w.db, fields, new Date(), doc.objectKey)).allowed).toBe(
      true,
    );
  });

  it('serves the sent version even after a newer one was uploaded', async () => {
    const { doc, submissionId } = await sentCopy();
    const newer = await addVersion(w.db, w.alice, doc.documentId);
    const ref = await open(w.harbor, submissionId, doc.versionId);
    expect(isOk(ref)).toBe(true);
    expect(storage.calls[0]?.objectKey).toBe(doc.objectKey);
    expect(storage.calls[0]?.objectKey).not.toBe(newer.objectKey);
  });

  it('records who opened what in the audit trail without any file content', async () => {
    const { doc, submissionId } = await sentCopy('private-name.pdf');
    expect(isOk(await open(w.harbor, submissionId, doc.versionId))).toBe(true);
    const events = await w.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'DOCUMENT_ACCESS'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      result: 'ALLOWED',
      action: 'DOWNLOAD_ORIGINAL',
      actorRole: 'org:evidence_submission',
      resourceId: doc.documentId,
    });
    const text = JSON.stringify(events);
    for (const secret of ['private-name', doc.objectKey, 'a'.repeat(64)]) {
      expect(text).not.toContain(secret);
    }
  });

  it('needs a recent identity confirmation for exactly this version and this person', async () => {
    const { doc, submissionId } = await sentCopy();
    const none = await open(w.harbor, submissionId, doc.versionId, { stepUp: false });
    expect(isErr(none) && none.error.code).toBe('step_up_required');
    const otherVersion = await downloadEvidenceSubmissionFile(
      storage,
      await agencyProof(w.db, w.harbor, w.alice.applicantId),
      {
        submissionId,
        accessTokenSecret: ACCESS_TOKEN_SECRET,
        stepUp: stepUpFor(w.harbor.accountId, '00000000-0000-4000-8000-0000000000aa'),
      },
    );
    expect(isErr(otherVersion) && otherVersion.error.code).toBe('step_up_required');
    const otherPerson = await downloadEvidenceSubmissionFile(
      storage,
      await agencyProof(w.db, w.harbor, w.alice.applicantId),
      {
        submissionId,
        accessTokenSecret: ACCESS_TOKEN_SECRET,
        stepUp: stepUpFor(w.summit.accountId, doc.versionId),
      },
    );
    expect(isErr(otherPerson) && otherPerson.error.code).toBe('step_up_required');
    expect(storage.calls).toEqual([]);
    const denied = await w.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'DOCUMENT_ACCESS'));
    expect(denied.map((e) => e.result)).toEqual(['DENIED', 'DENIED', 'DENIED']);
  });

  it('serves nothing for a copy that was sent back, replaced or withdrawn, and serves an accepted one', async () => {
    const { doc, requestId, submissionId } = await sentCopy();
    expect(isOk(await decide(w, requestId, 'NEEDS_REPLACEMENT'))).toBe(true);
    const sentBack = await open(w.harbor, submissionId, doc.versionId);
    expect(isErr(sentBack) && sentBack.error.code).toBe('forbidden');

    const second = await cleanDocument(w.db, w.alice, 'bank_statement', 'second.pdf');
    const resent = await send(w.db, w.alice, requestId, second.documentId);
    if (!isOk(resent)) throw new Error('resend');
    // Round 1 stays closed, round 2 is open.
    expect(isErr(await open(w.harbor, submissionId, doc.versionId))).toBe(true);
    expect(isOk(await open(w.harbor, resent.value.submissionId ?? '', second.versionId))).toBe(
      true,
    );

    // Accepted: still served. Withdrawn requests would not be (checked below with a new request).
    expect(isOk(await decide(w, requestId, 'ACCEPTED'))).toBe(true);
    expect(isOk(await open(w.harbor, resent.value.submissionId ?? '', second.versionId))).toBe(
      true,
    );

    const waiting = await sentCopy('waiting.pdf');
    const { cancelEvidenceRequest } = await import('./agency');
    expect(
      isOk(
        await cancelEvidenceRequest(w.db, {
          actorAccountId: w.harbor.accountId,
          requestId: waiting.requestId,
        }),
      ),
    ).toBe(true);
    const withdrawn = await open(w.harbor, waiting.submissionId, waiting.doc.versionId);
    expect(isErr(withdrawn) && withdrawn.error.code).toBe('forbidden');
  });

  it('serves nothing to another agency, the traveller or a stranger', async () => {
    const { doc, submissionId } = await sentCopy();
    const summit = await open(w.summit, submissionId, doc.versionId);
    expect(isErr(summit) && summit.error.code).toBe('not_found');
    const owner = await downloadEvidenceSubmissionFile(storage, await ownerProof(w.db, w.alice), {
      submissionId,
      accessTokenSecret: ACCESS_TOKEN_SECRET,
    });
    expect(isErr(owner) && owner.error.code).toBe('not_found');
    const bobProof = await requireAccess(
      w.db,
      accountPrincipal(w.bob.accountId),
      'MANAGE',
      { applicantId: w.bob.applicantId },
      { purpose: 'owner_view_sends' },
    );
    if (!isOk(bobProof)) throw new Error('proof');
    const bob = await downloadEvidenceSubmissionFile(storage, bobProof.value, {
      submissionId,
      accessTokenSecret: ACCESS_TOKEN_SECRET,
    });
    expect(isErr(bob) && bob.error.code).toBe('not_found');
    const malformed = await open(w.harbor, 'nope', doc.versionId);
    expect(isErr(malformed) && malformed.error.code).toBe('not_found');
    expect(storage.calls).toEqual([]);
  });

  it('refuses a proof made before the grant was revoked', async () => {
    const { doc, submissionId } = await sentCopy();
    const proof = await agencyProof(w.db, w.harbor, w.alice.applicantId);
    const grants = await w.db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.recipientOrganizationId, w.harbor.organizationId));
    const mine = grants.find((g) => g.applicantId === w.alice.applicantId);
    expect(
      isOk(await revokeGrant(w.db, { actorAccountId: w.alice.accountId, grantId: mine?.id ?? '' })),
    ).toBe(true);
    const refused = await downloadEvidenceSubmissionFile(storage, proof, {
      submissionId,
      accessTokenSecret: ACCESS_TOKEN_SECRET,
      stepUp: stepUpFor(w.harbor.accountId, doc.versionId),
    });
    expect(isErr(refused) && refused.error.code).toBe('not_found');
    expect(storage.calls).toEqual([]);
  });

  it('refuses a file that became unsafe, or whose checksum changed, after it was sent', async () => {
    const unsafe = await sentCopy('unsafe.pdf');
    await w.db
      .update(schema.documentVersions)
      .set({ safetyStatus: 'QUARANTINED' })
      .where(eq(schema.documentVersions.id, unsafe.doc.versionId));
    const refusedUnsafe = await open(w.harbor, unsafe.submissionId, unsafe.doc.versionId);
    expect(isErr(refusedUnsafe) && refusedUnsafe.error.code).toBe('forbidden');

    const changed = await sentCopy('changed.pdf');
    await w.db
      .update(schema.documentVersions)
      .set({ sha256: '9'.repeat(64) })
      .where(eq(schema.documentVersions.id, changed.doc.versionId));
    const refusedChanged = await open(w.harbor, changed.submissionId, changed.doc.versionId);
    expect(isErr(refusedChanged) && refusedChanged.error.code).toBe('forbidden');
    expect(storage.calls).toEqual([]);
  });

  describe('when the link is redeemed', () => {
    async function minted() {
      const copy = await sentCopy();
      const ref = await open(w.harbor, copy.submissionId, copy.doc.versionId);
      if (!isOk(ref)) throw new Error('mint');
      return { ...copy, fields: fieldsOf(ref.value.url) };
    }

    it('is allowed while everything still holds', async () => {
      const { fields, doc } = await minted();
      expect((await recheckDocumentAccess(w.db, fields, new Date(), doc.objectKey)).allowed).toBe(
        true,
      );
    });

    it('is refused once the grant is revoked', async () => {
      const { fields } = await minted();
      const grants = await w.db
        .select()
        .from(schema.grants)
        .where(eq(schema.grants.recipientOrganizationId, w.harbor.organizationId));
      const mine = grants.find((g) => g.applicantId === w.alice.applicantId);
      expect(
        isOk(
          await revokeGrant(w.db, { actorAccountId: w.alice.accountId, grantId: mine?.id ?? '' }),
        ),
      ).toBe(true);
      const result = await recheckDocumentAccess(w.db, fields);
      expect(result).toEqual({ allowed: false, reason: 'no_current_grant' });
    });

    it('is refused once the copy is sent back', async () => {
      const { fields, requestId } = await minted();
      expect(isOk(await decide(w, requestId, 'NEEDS_REPLACEMENT'))).toBe(true);
      expect((await recheckDocumentAccess(w.db, fields)).allowed).toBe(false);
    });

    it('is refused once a newer copy replaced it', async () => {
      const { fields, requestId } = await minted();
      expect(isOk(await decide(w, requestId, 'NEEDS_REPLACEMENT'))).toBe(true);
      const second = await cleanDocument(w.db, w.alice);
      expect(isOk(await send(w.db, w.alice, requestId, second.documentId))).toBe(true);
      expect((await recheckDocumentAccess(w.db, fields)).allowed).toBe(false);
    });

    it('is refused once the person is no longer an active member of the agency', async () => {
      const { fields } = await minted();
      const [membership] = await w.db
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.accountId, w.harbor.accountId));
      await w.db
        .update(schema.memberships)
        .set({ active: false })
        .where(eq(schema.memberships.id, membership?.id ?? ''));
      expect(await recheckDocumentAccess(w.db, fields)).toEqual({
        allowed: false,
        reason: 'not_an_agency_admin',
      });
    });

    it('is refused for a link whose send, version, step-up or action was altered', async () => {
      const { fields, doc } = await minted();
      const other = await sentCopy('other.pdf');
      const base = { ...fields };
      const swapped = await recheckDocumentAccess(w.db, {
        ...base,
        purpose: `evidence_submission:${other.submissionId}`,
      });
      expect(swapped.allowed).toBe(false);
      const noStepUp = await recheckDocumentAccess(w.db, { ...base, stepUpSatisfied: false });
      expect(noStepUp).toEqual({ allowed: false, reason: 'action_not_granted' });
      const preview = await recheckDocumentAccess(w.db, { ...base, action: 'PREVIEW' });
      expect(preview).toEqual({ allowed: false, reason: 'action_not_granted' });
      const malformed = await recheckDocumentAccess(w.db, {
        ...base,
        purpose: 'evidence_submission:x',
      });
      expect(malformed).toEqual({ allowed: false, reason: 'missing_evidence_submission_context' });
      const wrongOrg = await recheckDocumentAccess(w.db, {
        ...base,
        organizationId: w.summit.organizationId,
      });
      expect(wrongOrg.allowed).toBe(false);
      const wrongKey = await recheckDocumentAccess(w.db, base, new Date(), 'some-other-object');
      expect(wrongKey).toEqual({ allowed: false, reason: 'object_key_mismatch' });
      const newer = await addVersion(w.db, w.alice, doc.documentId);
      const otherVersion = await recheckDocumentAccess(w.db, {
        ...base,
        documentVersionId: newer.versionId,
      });
      expect(otherVersion).toEqual({ allowed: false, reason: 'not_this_send' });
    });
  });
});

describe('Lane D: the records cannot be edited', () => {
  it(
    'refuses any change to a send or to the link from a decision to its send',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      const sent = await send(w.db, w.alice, requestId, doc.documentId);
      if (!isOk(sent)) throw new Error('send');
      await expect(
        w.db
          .update(schema.evidenceRequestSubmissions)
          .set({ documentVersionId: doc.versionId })
          .where(eq(schema.evidenceRequestSubmissions.id, sent.value.submissionId ?? '')),
      ).rejects.toThrow();
      expect(isOk(await decide(w, requestId, 'ACCEPTED'))).toBe(true);
      await expect(
        w.db
          .update(schema.evidenceRequestDecisionSubmissions)
          .set({ submissionId: sent.value.submissionId ?? '' }),
      ).rejects.toThrow();
      // Removing the request removes its sends and links with it.
      await w.db.delete(schema.evidenceRequests).where(eq(schema.evidenceRequests.id, requestId));
      expect(await w.db.select().from(schema.evidenceRequestSubmissions)).toEqual([]);
      expect(await w.db.select().from(schema.evidenceRequestDecisionSubmissions)).toEqual([]);
    },
    TIMEOUT,
  );
});
