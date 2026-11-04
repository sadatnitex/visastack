import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import {
  cancelEvidenceRequest,
  decideEvidenceResponse,
  requestEvidence,
  startEvidenceReview,
  submitEvidenceResponse,
} from './agency';
import type { Db } from './db';
import { readDocumentAccessToken } from './document-access-token';
import { recheckDocumentAccess } from './documents';
import { downloadEvidenceSubmissionFile, listEvidenceSubmissions } from './evidence-submissions';
import {
  ACCESS_TOKEN_SECRET,
  type Agency,
  FakeStorage,
  type Traveller,
  agency,
  agencyProof,
  cleanDocument,
  freshDb,
  openRequest,
  send,
  share,
  stepUpFor,
  traveller,
} from './evidence-submissions.test-support';
import { createMission } from './missions';
import { addMembership } from './organizations';
import { revokeGrant } from './sharing';

/**
 * Lane D review round: the request-state guards on start review and cancel, the retry key rules,
 * malformed ids, a send decided by an older deployment, a legacy acceptance, and the standing of
 * members and of case-scoped grants.
 */

const TIMEOUT = 120_000;
const NO_ID = '00000000-0000-4000-8000-000000000000';

interface World {
  db: Db;
  alice: Traveller;
  harbor: Agency;
  summit: Agency;
}

async function world(): Promise<World> {
  const db = await freshDb();
  const alice = await traveller(db, 'alice-r@example.com');
  const harbor = await agency(db, 'harbor-r@example.com', 'Harbor Visas');
  const summit = await agency(db, 'summit-r@example.com', 'Summit Visas');
  await share(db, alice, harbor);
  await share(db, alice, summit);
  return { db, alice, harbor, summit };
}

function decide(
  w: World,
  requestId: string,
  outcome: 'ACCEPTED' | 'NEEDS_REPLACEMENT',
  extra: { submissionId?: string } = {},
) {
  return decideEvidenceResponse(w.db, {
    actorAccountId: w.harbor.accountId,
    requestId,
    outcome,
    ...(outcome === 'ACCEPTED' ? {} : { reason: 'does not stand' }),
    ...(extra.submissionId ? { submissionId: extra.submissionId } : {}),
  });
}

async function sentRequest(w: World) {
  const doc = await cleanDocument(w.db, w.alice);
  const requestId = await openRequest(w.db, w.harbor, w.alice);
  const sent = await send(w.db, w.alice, requestId, doc.documentId);
  if (!isOk(sent)) throw new Error('send');
  return { doc, requestId, submissionId: sent.value.submissionId ?? '' };
}

describe('Lane D review: start review and cancel only move a request that still allows it', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, TIMEOUT);

  it('refuses to start a review after the request was sent back', async () => {
    const { requestId } = await sentRequest(w);
    expect(isOk(await decide(w, requestId, 'NEEDS_REPLACEMENT'))).toBe(true);
    const started = await startEvidenceReview(w.db, {
      actorAccountId: w.harbor.accountId,
      requestId,
    });
    expect(isErr(started) && started.error.code).toBe('invalid');
    const [request] = await w.db
      .select()
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, requestId));
    expect(request?.status).toBe('NEEDS_REPLACEMENT');
  });

  it('refuses to cancel an accepted or an already cancelled request, and keeps it as it was', async () => {
    const { requestId } = await sentRequest(w);
    expect(isOk(await decide(w, requestId, 'ACCEPTED'))).toBe(true);
    const cancelled = await cancelEvidenceRequest(w.db, {
      actorAccountId: w.harbor.accountId,
      requestId,
    });
    expect(isErr(cancelled) && cancelled.error.code).toBe('invalid');
    const [accepted] = await w.db
      .select()
      .from(schema.evidenceRequests)
      .where(eq(schema.evidenceRequests.id, requestId));
    expect(accepted?.status).toBe('ACCEPTED');
    const decisionsBefore = await w.db.select().from(schema.evidenceRequestDecisions);
    expect(decisionsBefore.map((d) => d.outcome)).toEqual(['ACCEPTED']);

    const other = await openRequest(w.db, w.harbor, w.alice);
    expect(
      isOk(
        await cancelEvidenceRequest(w.db, { actorAccountId: w.harbor.accountId, requestId: other }),
      ),
    ).toBe(true);
    const again = await cancelEvidenceRequest(w.db, {
      actorAccountId: w.harbor.accountId,
      requestId: other,
    });
    expect(isErr(again) && again.error.code).toBe('invalid');
  });

  it('tells an admin of another agency that the request does not exist, for start, cancel and decide', async () => {
    const { requestId } = await sentRequest(w);
    const start = await startEvidenceReview(w.db, {
      actorAccountId: w.summit.accountId,
      requestId,
    });
    const cancel = await cancelEvidenceRequest(w.db, {
      actorAccountId: w.summit.accountId,
      requestId,
    });
    const decided = await decideEvidenceResponse(w.db, {
      actorAccountId: w.summit.accountId,
      requestId,
      outcome: 'ACCEPTED',
    });
    const missing = await startEvidenceReview(w.db, {
      actorAccountId: w.summit.accountId,
      requestId: NO_ID,
    });
    for (const refused of [start, cancel, decided, missing]) {
      expect(isErr(refused) && refused.error.code).toBe('not_found');
    }
    if (isErr(start) && isErr(missing)) expect(start.error).toEqual(missing.error);
  });

  it('refuses to accept a document request that points at no document', async () => {
    const { requestId } = await sentRequest(w);
    await w.db
      .update(schema.evidenceRequests)
      .set({ respondingDocumentId: null })
      .where(eq(schema.evidenceRequests.id, requestId));
    const accepted = await decide(w, requestId, 'ACCEPTED');
    expect(isErr(accepted) && accepted.error.code).toBe('invalid');
    expect(await w.db.select().from(schema.evidenceRequestDecisions)).toEqual([]);
  });
});

describe('Lane D review: a send recorded without an exact copy is still checked when accepted', () => {
  it(
    'refuses to accept an older unpinned send whose newest version is no longer safe, and accepts a usable one',
    async () => {
      const w = await world();
      const bad = await cleanDocument(w.db, w.alice, 'bank_statement', 'bad.pdf');
      const good = await cleanDocument(w.db, w.alice, 'bank_statement', 'good.pdf');
      const badRequest = await openRequest(w.db, w.harbor, w.alice);
      const goodRequest = await openRequest(w.db, w.harbor, w.alice);
      // As the older code wrote them: pointers only, no exact-copy row.
      for (const [requestId, documentId] of [
        [badRequest, bad.documentId],
        [goodRequest, good.documentId],
      ] as const) {
        await w.db
          .update(schema.evidenceRequests)
          .set({ status: 'RECEIVED', respondingDocumentId: documentId, respondedAt: new Date() })
          .where(eq(schema.evidenceRequests.id, requestId));
      }
      await w.db
        .update(schema.documentVersions)
        .set({ safetyStatus: 'QUARANTINED' })
        .where(eq(schema.documentVersions.id, bad.versionId));
      const refused = await decide(w, badRequest, 'ACCEPTED');
      expect(isErr(refused) && refused.error.code).toBe('invalid');
      expect(isOk(await decide(w, badRequest, 'NEEDS_REPLACEMENT'))).toBe(true);
      const accepted = await decide(w, goodRequest, 'ACCEPTED');
      expect(isOk(accepted) && accepted.value.decidedSubmissionId).toBeNull();
    },
    TIMEOUT,
  );
});

describe('Lane D review: retry keys and malformed ids', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, TIMEOUT);

  it('accepts only a key of 16 to 200 plain characters, and numbers the send itself otherwise', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    for (const key of [
      'short',
      'has spaces in the key',
      `${'k'.repeat(201)}`,
      'bad:colon:in:key:xx',
    ]) {
      const refused = await send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: key });
      expect(isErr(refused) && refused.error.code, key).toBe('invalid');
    }
    expect(await w.db.select().from(schema.evidenceRequestSubmissions)).toEqual([]);
    expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
    const [row] = await w.db.select().from(schema.evidenceRequestSubmissions);
    expect(row?.idempotencyKey).toBe('auto:round-1');
  });

  it('does not call a send a retry once it was decided, replaced, or when the file differs', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const other = await cleanDocument(w.db, w.alice, 'bank_statement', 'other.pdf');
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    const key = 'retry-key-0000000001';
    const first = await send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: key });
    expect(isOk(first)).toBe(true);
    const differentFile = await send(w.db, w.alice, requestId, other.documentId, {
      idempotencyKey: key,
    });
    expect(isErr(differentFile) && differentFile.error.code).toBe('invalid');
    // Decided: the same key is no longer a retry of something still waiting.
    expect(isOk(await decide(w, requestId, 'NEEDS_REPLACEMENT'))).toBe(true);
    const afterDecision = await send(w.db, w.alice, requestId, doc.documentId, {
      idempotencyKey: key,
    });
    expect(isErr(afterDecision) && afterDecision.error.code).toBe('stale');
    // A newer send exists: the older key is stale too.
    expect(
      isOk(
        await send(w.db, w.alice, requestId, other.documentId, {
          idempotencyKey: 'retry-key-0000000002',
        }),
      ),
    ).toBe(true);
    const replaced = await send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: key });
    expect(isErr(replaced) && replaced.error.code).toBe('stale');
    expect(await w.db.select().from(schema.evidenceRequestSubmissions)).toHaveLength(2);
  });

  it('answers malformed ids like missing ones instead of failing', async () => {
    const { doc, requestId } = await sentRequest(w);
    const bad = 'not-an-id';
    const results = [
      await submitEvidenceResponse(w.db, {
        actorAccountId: w.alice.accountId,
        requestId: bad,
        documentId: doc.documentId,
      }),
      await submitEvidenceResponse(w.db, {
        actorAccountId: w.alice.accountId,
        requestId,
        documentId: bad,
      }),
      await submitEvidenceResponse(w.db, {
        actorAccountId: w.alice.accountId,
        requestId,
        documentId: doc.documentId,
        documentVersionId: bad,
      }),
      await submitEvidenceResponse(w.db, {
        actorAccountId: w.alice.accountId,
        requestId,
        factId: bad,
      }),
      await decideEvidenceResponse(w.db, {
        actorAccountId: w.harbor.accountId,
        requestId: bad,
        outcome: 'ACCEPTED',
      }),
      await decideEvidenceResponse(w.db, {
        actorAccountId: w.harbor.accountId,
        requestId,
        outcome: 'ACCEPTED',
        submissionId: bad,
      }),
      await startEvidenceReview(w.db, { actorAccountId: w.harbor.accountId, requestId: bad }),
      await cancelEvidenceRequest(w.db, { actorAccountId: w.harbor.accountId, requestId: bad }),
    ];
    for (const result of results) expect(isErr(result) && result.error.code).toBe('not_found');
  });
});

describe('Lane D review: a send decided by an older deployment running beside this one', () => {
  it(
    'stops serving, stops being decidable and is listed as decided',
    async () => {
      const w = await world();
      const { doc, requestId, submissionId } = await sentRequest(w);
      // The older code sent it back (a decision with no link, the request back to waiting) and the
      // traveller answered again through the older code (pointers only, same document).
      await w.db.insert(schema.evidenceRequestDecisions).values({
        evidenceRequestId: requestId,
        outcome: 'NEEDS_REPLACEMENT',
        reason: 'older code',
        respondingDocumentId: doc.documentId,
        decidedByAccountId: w.harbor.accountId,
      });
      await w.db
        .update(schema.evidenceRequests)
        .set({ status: 'RECEIVED', respondingDocumentId: doc.documentId })
        .where(eq(schema.evidenceRequests.id, requestId));

      const download = await downloadEvidenceSubmissionFile(
        new FakeStorage(),
        await agencyProof(w.db, w.harbor, w.alice.applicantId),
        {
          submissionId,
          accessTokenSecret: ACCESS_TOKEN_SECRET,
          stepUp: stepUpFor(w.harbor.accountId, doc.versionId),
        },
      );
      expect(isErr(download) && download.error.code).toBe('forbidden');
      const stale = await decide(w, requestId, 'ACCEPTED', { submissionId });
      expect(isErr(stale) && stale.error.code).toBe('stale');
      const listed = await listEvidenceSubmissions(
        await agencyProof(w.db, w.harbor, w.alice.applicantId),
        { requestId },
      );
      expect(isOk(listed)).toBe(true);
      if (!isOk(listed)) return;
      expect(listed.value.submissions.map((s) => [s.state, s.fileAvailable])).toEqual([
        ['NEEDS_REPLACEMENT', false],
      ]);
      // The newer, unpinned send shows as older and waiting; the decision is not listed twice.
      expect(listed.value.legacy.map((l) => l.state)).toEqual(['AWAITING_DECISION']);
    },
    TIMEOUT,
  );
});

describe('Lane D review: members, case-scoped grants and mixed-up links', () => {
  it(
    'serves nothing to a member who is not an owner or admin, and refuses their link at redemption',
    async () => {
      const w = await world();
      const { doc, requestId, submissionId } = await sentRequest(w);
      const member = await provisionAccount(w.db, { email: 'member-r@example.com' });
      if (!isOk(member)) throw new Error('member');
      const added = await addMembership(w.db, {
        actorAccountId: w.harbor.accountId,
        organizationId: w.harbor.organizationId,
        accountId: member.value.id,
        role: 'CASE_MANAGER',
      });
      expect(isOk(added)).toBe(true);
      const asMember: Agency = {
        accountId: member.value.id,
        organizationId: w.harbor.organizationId,
      };
      const proof = await agencyProof(w.db, asMember, w.alice.applicantId);
      const storage = new FakeStorage();
      const download = await downloadEvidenceSubmissionFile(storage, proof, {
        submissionId,
        accessTokenSecret: ACCESS_TOKEN_SECRET,
        stepUp: stepUpFor(member.value.id, doc.versionId),
      });
      expect(isErr(download) && download.error.code).toBe('not_found');
      const listed = await listEvidenceSubmissions(proof, { requestId });
      expect(isErr(listed) && listed.error.code).toBe('not_found');
      expect(storage.calls).toEqual([]);

      // A link minted for the admin, replayed under the member's account.
      const ref = await downloadEvidenceSubmissionFile(
        storage,
        await agencyProof(w.db, w.harbor, w.alice.applicantId),
        {
          submissionId,
          accessTokenSecret: ACCESS_TOKEN_SECRET,
          stepUp: stepUpFor(w.harbor.accountId, doc.versionId),
        },
      );
      if (!isOk(ref)) throw new Error('mint');
      const fields = readDocumentAccessToken(new URL(ref.value.url).searchParams);
      if (!fields) throw new Error('token');
      expect(
        await recheckDocumentAccess(w.db, { ...fields, actorAccountId: member.value.id }),
      ).toEqual({ allowed: false, reason: 'not_an_agency_admin' });
    },
    TIMEOUT,
  );

  it(
    'serves nothing when the request is no longer waiting, even with no decision recorded',
    async () => {
      const w = await world();
      const { doc, requestId, submissionId } = await sentRequest(w);
      await w.db
        .update(schema.evidenceRequests)
        .set({ status: 'NEEDS_REPLACEMENT' })
        .where(eq(schema.evidenceRequests.id, requestId));
      const refused = await downloadEvidenceSubmissionFile(
        new FakeStorage(),
        await agencyProof(w.db, w.harbor, w.alice.applicantId),
        {
          submissionId,
          accessTokenSecret: ACCESS_TOKEN_SECRET,
          stepUp: stepUpFor(w.harbor.accountId, doc.versionId),
        },
      );
      expect(isErr(refused) && refused.error.code).toBe('forbidden');
    },
    TIMEOUT,
  );

  it(
    'refuses another agency admin replaying a link under their own agency, with the reason',
    async () => {
      const w = await world();
      const { doc, submissionId } = await sentRequest(w);
      const ref = await downloadEvidenceSubmissionFile(
        new FakeStorage(),
        await agencyProof(w.db, w.harbor, w.alice.applicantId),
        {
          submissionId,
          accessTokenSecret: ACCESS_TOKEN_SECRET,
          stepUp: stepUpFor(w.harbor.accountId, doc.versionId),
        },
      );
      if (!isOk(ref)) throw new Error('mint');
      const fields = readDocumentAccessToken(new URL(ref.value.url).searchParams);
      if (!fields) throw new Error('token');
      expect(
        await recheckDocumentAccess(w.db, { ...fields, organizationId: w.summit.organizationId }),
      ).toEqual({ allowed: false, reason: 'not_an_agency_admin' });
      // The other agency's own admin, replaying the link under their own agency: that agency holds
      // a MANAGE grant on this traveller too, but the request is not theirs.
      expect(
        await recheckDocumentAccess(w.db, {
          ...fields,
          actorAccountId: w.summit.accountId,
          organizationId: w.summit.organizationId,
        }),
      ).toEqual({ allowed: false, reason: 'not_this_organizations_request' });
    },
    TIMEOUT,
  );

  it(
    'refuses a response-kind link that carries an evidence purpose',
    async () => {
      const w = await world();
      const { doc, submissionId } = await sentRequest(w);
      const ref = await downloadEvidenceSubmissionFile(
        new FakeStorage(),
        await agencyProof(w.db, w.harbor, w.alice.applicantId),
        {
          submissionId,
          accessTokenSecret: ACCESS_TOKEN_SECRET,
          stepUp: stepUpFor(w.harbor.accountId, doc.versionId),
        },
      );
      if (!isOk(ref)) throw new Error('mint');
      const fields = readDocumentAccessToken(new URL(ref.value.url).searchParams);
      if (!fields) throw new Error('token');
      expect(
        await recheckDocumentAccess(w.db, { ...fields, actorKind: 'collection_response' }),
      ).toEqual({ allowed: false, reason: 'missing_collection_response_context' });
    },
    TIMEOUT,
  );

  it(
    'serves nothing once the grant that covered the request is gone, even with a proof for another case',
    async () => {
      const w = await world();
      // A second traveller keeps this case-scoped scenario apart from the shared grants above.
      const carol = await traveller(w.db, 'carol-r@example.com');
      const caseA = await createMission(w.db, {
        actorAccountId: carol.accountId,
        applicantId: carol.applicantId,
        title: 'Case A',
      });
      const caseB = await createMission(w.db, {
        actorAccountId: carol.accountId,
        applicantId: carol.applicantId,
        title: 'Case B',
      });
      if (!isOk(caseA) || !isOk(caseB)) throw new Error('missions');
      const grantA = await share(w.db, carol, w.harbor, caseA.value.id);
      await share(w.db, carol, w.harbor, caseB.value.id);
      const doc = await cleanDocument(w.db, carol);
      const request = await requestEvidence(w.db, {
        actorAccountId: w.harbor.accountId,
        organizationId: w.harbor.organizationId,
        applicantId: carol.applicantId,
        missionId: caseA.value.id,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
      });
      if (!isOk(request)) throw new Error(`request ${request.error.message}`);
      const sent = await send(w.db, carol, request.value.id, doc.documentId);
      if (!isOk(sent)) throw new Error('send');

      // The grant for case A goes away; the agency still holds case B, and a proof for case B.
      expect(
        isOk(await revokeGrant(w.db, { actorAccountId: carol.accountId, grantId: grantA })),
      ).toBe(true);
      const proofB = await requireAccess(
        w.db,
        accountPrincipal(w.harbor.accountId),
        'MANAGE',
        { missionId: caseB.value.id },
        { purpose: EACH_GRANT, actingFor: { organizationId: w.harbor.organizationId } },
      );
      if (!isOk(proofB)) throw new Error('proof');
      const listed = await listEvidenceSubmissions(proofB.value, { requestId: request.value.id });
      expect(isErr(listed) && listed.error.code).toBe('not_found');
      const storage = new FakeStorage();
      const download = await downloadEvidenceSubmissionFile(storage, proofB.value, {
        submissionId: sent.value.submissionId ?? '',
        accessTokenSecret: ACCESS_TOKEN_SECRET,
        stepUp: stepUpFor(w.harbor.accountId, doc.versionId),
      });
      expect(isErr(download) && download.error.code).toBe('not_found');
      expect(storage.calls).toEqual([]);
      const decided = await decideEvidenceResponse(w.db, {
        actorAccountId: w.harbor.accountId,
        requestId: request.value.id,
        outcome: 'ACCEPTED',
      });
      expect(isErr(decided) && decided.error.code).toBe('forbidden');
    },
    TIMEOUT,
  );
});

describe('Lane D review: last follow-ups', () => {
  it(
    'does not answer a retry as sent once the request no longer waits',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      const key = 'retry-key-0000000003';
      expect(
        isOk(await send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: key })),
      ).toBe(true);
      // Withdrawn after the send, with no decision row (the status alone has moved).
      await w.db
        .update(schema.evidenceRequests)
        .set({ status: 'CANCELLED' })
        .where(eq(schema.evidenceRequests.id, requestId));
      const retry = await send(w.db, w.alice, requestId, doc.documentId, { idempotencyKey: key });
      expect(isErr(retry) && retry.error.code).toBe('stale');
      expect(await w.db.select().from(schema.evidenceRequestSubmissions)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'refuses a chosen version while the exact-copy tables are missing, and still sends without one',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      await w.db.execute(
        sql`drop table evidence_request_decision_submissions, evidence_request_submissions`,
      );
      const chosen = await send(w.db, w.alice, requestId, doc.documentId, {
        documentVersionId: doc.versionId,
      });
      expect(isErr(chosen) && chosen.error.code).toBe('invalid');
      expect(isErr(chosen) && chosen.error.message).toMatch(/exact version is not available yet/);
      const [untouched] = await w.db
        .select()
        .from(schema.evidenceRequests)
        .where(eq(schema.evidenceRequests.id, requestId));
      expect(untouched?.status).toBe('OPEN');
      expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
    },
    TIMEOUT,
  );
});

describe('Lane D review: the file flag matches what the download would allow', () => {
  async function listed(w: World, requestId: string) {
    const result = await listEvidenceSubmissions(
      await agencyProof(w.db, w.harbor, w.alice.applicantId),
      { requestId },
    );
    if (!isOk(result)) throw new Error('list');
    return result.value.submissions[0];
  }

  it(
    'is true for a usable copy and false when the document was removed, the file is unsafe, or its checksum changed',
    async () => {
      const w = await world();
      const removed = await sentRequest(w);
      const unsafe = await sentRequest(w);
      const changed = await sentRequest(w);
      const fine = await sentRequest(w);
      expect((await listed(w, fine.requestId))?.fileAvailable).toBe(true);

      const now = new Date();
      await w.db.insert(schema.documentLifecycle).values({
        documentId: removed.doc.documentId,
        applicantId: w.alice.applicantId,
        deletedAt: now,
        deletePath: 'DUPLICATE',
        purgeAfter: new Date(now.getTime() + 30 * 86_400_000),
      });
      expect((await listed(w, removed.requestId))?.fileAvailable).toBe(false);

      await w.db
        .update(schema.documentVersions)
        .set({ safetyStatus: 'QUARANTINED' })
        .where(eq(schema.documentVersions.id, unsafe.doc.versionId));
      expect((await listed(w, unsafe.requestId))?.fileAvailable).toBe(false);

      await w.db
        .update(schema.documentVersions)
        .set({ sha256: '5'.repeat(64) })
        .where(eq(schema.documentVersions.id, changed.doc.versionId));
      expect((await listed(w, changed.requestId))?.fileAvailable).toBe(false);
      expect((await listed(w, fine.requestId))?.fileAvailable).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'refuses to accept an older unpinned send whose document was moved to Recently Deleted',
    async () => {
      const w = await world();
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      // As the older code wrote it: pointers only, no exact-copy row.
      await w.db
        .update(schema.evidenceRequests)
        .set({ status: 'RECEIVED', respondingDocumentId: doc.documentId, respondedAt: new Date() })
        .where(eq(schema.evidenceRequests.id, requestId));
      const now = new Date();
      await w.db.insert(schema.documentLifecycle).values({
        documentId: doc.documentId,
        applicantId: w.alice.applicantId,
        deletedAt: now,
        deletePath: 'DUPLICATE',
        purgeAfter: new Date(now.getTime() + 30 * 86_400_000),
      });
      const accepted = await decide(w, requestId, 'ACCEPTED');
      expect(isErr(accepted) && accepted.error.code).toBe('invalid');
      expect(isErr(accepted) && accepted.error.message).toMatch(/no longer available/);
      expect(isOk(await decide(w, requestId, 'NEEDS_REPLACEMENT'))).toBe(true);
    },
    TIMEOUT,
  );
});
