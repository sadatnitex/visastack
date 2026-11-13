import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from '../access';
import { evidenceSubmissionStillCovers } from '../access/evidence-submission-access';
import { provisionAccount } from '../accounts';
import {
  cancelEvidenceRequest,
  decideEvidenceResponse,
  requestEvidence,
  startEvidenceReview,
  submitEvidenceResponse,
} from '../agency';
import { approveProposal, listPendingProposals, rejectProposal } from '../ai';
import { listConsentHistory, setConsent } from '../consent';
import { renameDocument } from '../document-naming';
import { recheckDocumentAccess } from '../documents';
import { listEvidenceSubmissions } from '../evidence-submissions';
import {
  type Agency,
  addVersion,
  agencyProof,
  cleanDocument,
  openRequest,
  ownerProof,
  send,
  share,
} from '../evidence-submissions.test-support';
import { setMembershipActive, suspendOrganization } from '../organizations';
import { editFact, getCurrentFactVersion, listApplicantProfile, listFactHistory } from '../profile';
import { revokeGrant } from '../sharing';
import {
  type TrustWorld,
  addAdmin,
  agencyNoticesFor,
  auditCount,
  connectSuggestionApp,
  decisionRows,
  downloadFresh,
  downloadWith,
  fieldsOfLink,
  ownerMetaProof,
  randomId,
  registerCatalogueField,
  requestRow,
  retryKey,
  submissionsOf,
  trustWorld,
} from './trust-rules.test-support';

/**
 * Seven product promises, written as rules and run against the real services on a migrated
 * in-memory database. Nothing but the file store is replaced, and that records every call.
 * Plain-language list and failure proofs: docs/product/breakthrough/TRUST-RULES.md.
 */

const TIMEOUT = 60_000;

async function ownerRenameProof(w: TrustWorld, documentId: string) {
  const proof = await requireAccess(
    w.db,
    accountPrincipal(w.rahim.accountId),
    'MANAGE',
    { documentId },
    { purpose: 'owner_document_rename' },
  );
  if (!isOk(proof)) throw new Error('rename proof');
  return proof.value;
}

async function decide(
  w: TrustWorld,
  requestId: string,
  outcome: 'ACCEPTED' | 'NEEDS_REPLACEMENT',
  by: Agency = w.north,
) {
  return decideEvidenceResponse(w.db, {
    actorAccountId: by.accountId,
    requestId,
    outcome,
    ...(outcome === 'ACCEPTED' ? {} : { reason: 'does not stand' }),
  });
}

// ---------------------------------------------------------------------------------------------
describe('Rule 1: ended access never yields a fresh read', () => {
  type Ending =
    | 'the traveller revokes the grant'
    | 'the grant expires'
    | 'the admin is removed'
    | 'the agency is suspended';
  const endings: readonly Ending[] = [
    'the traveller revokes the grant',
    'the grant expires',
    'the admin is removed',
    'the agency is suspended',
  ];

  for (const ending of endings) {
    it(
      `when ${ending}: no link, no storage call, no listing, a link minted earlier is refused`,
      async () => {
        const w = await trustWorld();
        const admin =
          ending === 'the admin is removed'
            ? await addAdmin(w.db, w.north, 'test-north-second-admin@example.test')
            : { ...w.north, membershipId: '' };

        // One copy still waiting for a decision, one already accepted.
        const waitingDoc = await cleanDocument(w.db, w.rahim, 'bank_statement', 'waiting.pdf');
        const acceptedDoc = await cleanDocument(
          w.db,
          w.rahim,
          'bank_statement',
          'accepted.pdf',
          'd'.repeat(64),
        );
        const waitingRequest = await openRequest(w.db, w.north, w.rahim);
        const acceptedRequest = await openRequest(w.db, w.north, w.rahim);
        const sentWaiting = await send(w.db, w.rahim, waitingRequest, waitingDoc.documentId);
        const sentAccepted = await send(w.db, w.rahim, acceptedRequest, acceptedDoc.documentId);
        expect(isOk(sentWaiting) && isOk(sentAccepted)).toBe(true);
        expect(isOk(await decide(w, acceptedRequest, 'ACCEPTED'))).toBe(true);
        const rows = [
          {
            row: (await submissionsOf(w.db, waitingRequest))[0],
            doc: waitingDoc,
            requestId: waitingRequest,
          },
          {
            row: (await submissionsOf(w.db, acceptedRequest))[0],
            doc: acceptedDoc,
            requestId: acceptedRequest,
          },
        ];

        // The agency member's proof is made while access still stands.
        const proof = await agencyProof(w.db, admin, w.rahim.applicantId);

        // Control: before the end, everything works, so the later refusals mean something.
        const links: string[] = [];
        for (const { row, doc, requestId } of rows) {
          if (!row) throw new Error('row');
          const ref = await downloadWith(w.storage, proof, admin, row);
          expect(isOk(ref)).toBe(true);
          if (isOk(ref)) links.push(ref.value.url);
          const listed = await listEvidenceSubmissions(proof, { requestId });
          expect(isOk(listed) && listed.value.submissions).toHaveLength(1);
          expect(doc.versionId).toBe(row.documentVersionId);
        }
        const callsBefore = w.storage.calls.length;
        expect(callsBefore).toBe(2);

        // The access ends.
        if (ending === 'the traveller revokes the grant') {
          expect(
            isOk(
              await revokeGrant(w.db, {
                actorAccountId: w.rahim.accountId,
                grantId: w.northGrantId,
              }),
            ),
          ).toBe(true);
        } else if (ending === 'the grant expires') {
          await w.db
            .update(schema.grants)
            .set({ expiryAt: new Date(Date.now() - 60_000) })
            .where(eq(schema.grants.id, w.northGrantId));
        } else if (ending === 'the admin is removed') {
          expect(
            isOk(
              await setMembershipActive(w.db, {
                actorAccountId: w.north.accountId,
                organizationId: w.north.organizationId,
                membershipId: admin.membershipId,
                active: false,
              }),
            ),
          ).toBe(true);
        } else {
          const reviewer = await provisionAccount(w.db, { email: 'test-reviewer@example.test' });
          if (!isOk(reviewer)) throw new Error('reviewer');
          expect(
            isOk(
              await suspendOrganization(w.db, {
                reviewerAccountId: reviewer.value.id,
                organizationId: w.north.organizationId,
                stepUpSatisfied: true,
              }),
            ),
          ).toBe(true);
        }

        for (const [index, { row, requestId }] of rows.entries()) {
          if (!row) throw new Error('row');
          // No link and no storage call.
          const refused = await downloadWith(w.storage, proof, admin, row);
          expect(isErr(refused), `download ${index} must be refused`).toBe(true);
          // The re-check made when a link is opened says no, for the link minted earlier too.
          const covers = await evidenceSubmissionStillCovers(w.db, {
            submissionId: row.id,
            accountId: admin.accountId,
            organizationId: admin.organizationId,
            documentId: row.documentId,
            documentVersionId: row.documentVersionId,
          });
          expect(covers.allowed, `still-covers ${index} must say no`).toBe(false);
          const opened = await recheckDocumentAccess(w.db, fieldsOfLink(links[index] ?? ''));
          expect(opened.allowed, `link ${index} must not open`).toBe(false);
          // The agency's listing does not describe the request.
          const listed = await listEvidenceSubmissions(proof, { requestId });
          expect(isErr(listed), `listing ${index} must not describe the request`).toBe(true);
        }
        expect(w.storage.calls).toHaveLength(callsBefore);
      },
      TIMEOUT,
    );
  }
});

// ---------------------------------------------------------------------------------------------
describe('Rule 2: an accepted receipt always names the same exact copy', () => {
  it(
    'stays byte-identical, still shown as accepted, and is served from the pinned object only',
    async () => {
      const w = await trustWorld();
      const doc = await cleanDocument(w.db, w.rahim, 'bank_statement', 'march.pdf', 'b'.repeat(64));
      const requestId = await openRequest(w.db, w.north, w.rahim);
      expect(isOk(await send(w.db, w.rahim, requestId, doc.documentId))).toBe(true);
      expect(isOk(await decide(w, requestId, 'ACCEPTED'))).toBe(true);
      const [accepted] = await submissionsOf(w.db, requestId);
      if (!accepted) throw new Error('row');
      const snapshot = structuredClone(accepted);
      expect(snapshot).toMatchObject({
        documentId: doc.documentId,
        documentVersionId: doc.versionId,
        storageObjectId: doc.storageObjectId,
        contentSha256: 'b'.repeat(64),
        versionNumber: 1,
        titleAtSend: 'march.pdf',
      });

      // Everything that could move the pointer: a newer version, a rename, a replacement
      // document, and another request answered with the newer version.
      const newer = await addVersion(w.db, w.rahim, doc.documentId, { sha256: 'c'.repeat(64) });
      expect(
        isOk(
          await renameDocument(await ownerRenameProof(w, doc.documentId), {
            name: 'Renamed later',
          }),
        ),
      ).toBe(true);
      const replacement = await cleanDocument(
        w.db,
        w.rahim,
        'bank_statement',
        'replacement.pdf',
        'e'.repeat(64),
      );
      const second = await openRequest(w.db, w.north, w.rahim);
      expect(
        isOk(
          await send(w.db, w.rahim, second, doc.documentId, { documentVersionId: newer.versionId }),
        ),
      ).toBe(true);
      expect(isOk(await decide(w, second, 'ACCEPTED'))).toBe(true);
      expect(replacement.documentId).not.toBe(doc.documentId);

      // A third answer that names the older version still pins that older version, even though a
      // newer one now exists.
      const third = await openRequest(w.db, w.north, w.rahim);
      expect(
        isOk(
          await send(w.db, w.rahim, third, doc.documentId, { documentVersionId: doc.versionId }),
        ),
      ).toBe(true);
      const [olderPin] = await submissionsOf(w.db, third);
      expect(olderPin).toMatchObject({ documentVersionId: doc.versionId, versionNumber: 1 });

      const [after] = await submissionsOf(w.db, requestId);
      expect(after).toEqual(snapshot);

      const proof = await agencyProof(w.db, w.north, w.rahim.applicantId);
      const listed = await listEvidenceSubmissions(proof, { requestId });
      expect(isOk(listed)).toBe(true);
      if (!isOk(listed)) return;
      expect(listed.value.submissions).toHaveLength(1);
      expect(listed.value.submissions[0]).toMatchObject({
        state: 'ACCEPTED',
        versionNumber: 1,
        checksumFingerprint: 'b'.repeat(12),
        title: 'march.pdf',
        documentVersionId: doc.versionId,
        fileAvailable: true,
      });

      const callsBefore = w.storage.calls.length;
      const ref = await downloadWith(w.storage, proof, w.north, accepted);
      expect(isOk(ref)).toBe(true);
      expect(w.storage.calls).toHaveLength(callsBefore + 1);
      expect(w.storage.calls.at(-1)?.objectKey).toBe(doc.objectKey);
      expect(w.storage.calls.at(-1)?.objectKey).not.toBe(newer.objectKey);
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
describe('Rule 3: an unrelated party cannot tell whether a record exists', () => {
  async function waitingCopy(w: TrustWorld) {
    const doc = await cleanDocument(w.db, w.rahim);
    const requestId = await openRequest(w.db, w.north, w.rahim);
    expect(isOk(await send(w.db, w.rahim, requestId, doc.documentId))).toBe(true);
    const [row] = await submissionsOf(w.db, requestId);
    if (!row) throw new Error('row');
    return { requestId, submissionId: row.id, versionId: row.documentVersionId };
  }

  it(
    `${'TEST Agency Unrelated'} with no grant of any kind gets one and the same answer for a real and a made-up record`,
    async () => {
      const w = await trustWorld();
      const real = await waitingCopy(w);
      const callsBefore = w.storage.calls.length;
      for (const entry of [startEvidenceReview, cancelEvidenceRequest] as const) {
        const onReal = await entry(w.db, {
          actorAccountId: w.unrelated.accountId,
          requestId: real.requestId,
        });
        const onMadeUp = await entry(w.db, {
          actorAccountId: w.unrelated.accountId,
          requestId: randomId(),
        });
        expect(isErr(onReal)).toBe(true);
        expect(onReal).toEqual(onMadeUp);
      }
      const decideOn = (requestId: string) =>
        decideEvidenceResponse(w.db, {
          actorAccountId: w.unrelated.accountId,
          requestId,
          outcome: 'ACCEPTED',
        });
      const decidedReal = await decideOn(real.requestId);
      expect(isErr(decidedReal)).toBe(true);
      expect(decidedReal).toEqual(await decideOn(randomId()));

      // Nothing moved, nothing was served.
      expect((await requestRow(w.db, real.requestId)).status).toBe('RECEIVED');
      expect(await decisionRows(w.db, real.requestId)).toEqual([]);
      expect(w.storage.calls).toHaveLength(callsBefore);
    },
    TIMEOUT,
  );

  it(
    `${'TEST Agency Unrelated'} holding only another traveller's grant gets one and the same answer from the listing and the download`,
    async () => {
      const w = await trustWorld();
      const real = await waitingCopy(w);
      await share(w.db, w.karim, w.unrelated);
      const proof = await agencyProof(w.db, w.unrelated, w.karim.applicantId);
      const callsBefore = w.storage.calls.length;
      const listedReal = await listEvidenceSubmissions(proof, { requestId: real.requestId });
      expect(isErr(listedReal)).toBe(true);
      expect(listedReal).toEqual(await listEvidenceSubmissions(proof, { requestId: randomId() }));
      const downloadOn = (submissionId: string) =>
        downloadWith(w.storage, proof, w.unrelated, {
          id: submissionId,
          documentVersionId: real.versionId,
        });
      const downloadReal = await downloadOn(real.submissionId);
      expect(isErr(downloadReal)).toBe(true);
      expect(downloadReal).toEqual(await downloadOn(randomId()));
      expect(w.storage.calls).toHaveLength(callsBefore);
    },
    TIMEOUT,
  );

  it(
    'a second traveller who is not the owner gets one and the same answer for a real and a made-up record',
    async () => {
      const w = await trustWorld();
      const real = await waitingCopy(w);
      const callsBefore = w.storage.calls.length;
      const karimProof = await ownerProof(w.db, w.karim);
      const listedReal = await listEvidenceSubmissions(karimProof, { requestId: real.requestId });
      expect(isErr(listedReal)).toBe(true);
      expect(listedReal).toEqual(
        await listEvidenceSubmissions(karimProof, { requestId: randomId() }),
      );
      const downloadOn = (submissionId: string) =>
        downloadWith(w.storage, karimProof, w.karim, {
          id: submissionId,
          documentVersionId: real.versionId,
        });
      const downloadReal = await downloadOn(real.submissionId);
      expect(isErr(downloadReal)).toBe(true);
      expect(downloadReal).toEqual(await downloadOn(randomId()));

      const sendOn = (requestId: string) =>
        submitEvidenceResponse(w.db, {
          actorAccountId: w.karim.accountId,
          requestId,
          documentId: randomId(),
        });
      const sentReal = await sendOn(real.requestId);
      expect(isErr(sentReal)).toBe(true);
      expect(sentReal).toEqual(await sendOn(randomId()));

      for (const entry of [startEvidenceReview, cancelEvidenceRequest] as const) {
        const onReal = await entry(w.db, {
          actorAccountId: w.karim.accountId,
          requestId: real.requestId,
        });
        expect(onReal).toEqual(
          await entry(w.db, { actorAccountId: w.karim.accountId, requestId: randomId() }),
        );
        expect(isErr(onReal)).toBe(true);
      }
      const decideOn = (requestId: string) =>
        decideEvidenceResponse(w.db, {
          actorAccountId: w.karim.accountId,
          requestId,
          outcome: 'ACCEPTED',
        });
      expect(await decideOn(real.requestId)).toEqual(await decideOn(randomId()));

      expect((await requestRow(w.db, real.requestId)).status).toBe('RECEIVED');
      expect(w.storage.calls).toHaveLength(callsBefore);
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
describe('Access gate contract: it answers differently, so every caller must give one answer', () => {
  /**
   * Rule 3 asks for one identical answer, for a record that exists and one that does not. The gate
   * itself (requireAccess, used for every agency and traveller proof) answers differently, by its
   * documented contract: a real applicant the caller has no access to gets `forbidden` "access
   * denied (default_deny)", a made-up applicant id gets `not_found` "record not found". The
   * contract is deliberate and unchanged; the duty to give one answer sits with the caller, before
   * anything reaches a screen. The three callers an audit on 12 Nov 2026 found passing the
   * difference on were corrected on 13 Nov 2026, and the web package holds the guard that fails if
   * a server action shows a person a different line for the two (apps/web/src/lib/gate-refusal.test.ts).
   *
   * These tests pin the contract's exact answers, so nobody is surprised if it ever changes: both
   * answers must be refusals, with exactly these codes. If the gate is ever changed to give one
   * answer, replace them with one assertion that the two results are equal and retire the guard.
   */
  const pinGap = (
    real: Awaited<ReturnType<typeof requireAccess>>,
    madeUp: Awaited<ReturnType<typeof requireAccess>>,
  ) => {
    // Never let in, whichever id was named.
    expect(isErr(real)).toBe(true);
    expect(isErr(madeUp)).toBe(true);
    expect(real.ok ? null : real.error).toMatchObject({
      code: 'forbidden',
      message: 'access denied (default_deny)',
    });
    expect(madeUp.ok ? null : madeUp.error).toMatchObject({
      code: 'not_found',
      message: 'record not found',
    });
  };

  it(
    'TEST Agency Unrelated is refused for a real and for a made-up applicant id, with different words',
    async () => {
      const w = await trustWorld();
      const gate = (applicantId: string) =>
        requireAccess(
          w.db,
          accountPrincipal(w.unrelated.accountId),
          'MANAGE',
          { applicantId },
          { purpose: EACH_GRANT, actingFor: { organizationId: w.unrelated.organizationId } },
        );
      pinGap(await gate(w.rahim.applicantId), await gate(randomId()));
    },
    TIMEOUT,
  );

  it(
    'a second traveller is refused for another traveller and for a made-up applicant id, with different words',
    async () => {
      const w = await trustWorld();
      const gate = (applicantId: string) =>
        requireAccess(
          w.db,
          accountPrincipal(w.karim.accountId),
          'MANAGE',
          { applicantId },
          { purpose: 'owner_view_sends' },
        );
      pinGap(await gate(w.rahim.applicantId), await gate(randomId()));
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
describe('Rule 4: nothing is shared without the traveller confirming it', () => {
  it(
    'an agency asking, a newer version or another matching document sends nothing',
    async () => {
      const w = await trustWorld();
      const doc = await cleanDocument(w.db, w.rahim);
      const requestId = await openRequest(w.db, w.north, w.rahim);
      expect(await submissionsOf(w.db, requestId)).toEqual([]);
      expect((await requestRow(w.db, requestId)).status).toBe('OPEN');

      await addVersion(w.db, w.rahim, doc.documentId, { sha256: 'c'.repeat(64) });
      await cleanDocument(w.db, w.rahim, 'bank_statement', 'another.pdf', 'f'.repeat(64));
      expect(await submissionsOf(w.db, requestId)).toEqual([]);
      const row = await requestRow(w.db, requestId);
      expect(row.status).toBe('OPEN');
      expect(row.respondingDocumentId).toBeNull();

      // Nothing to download, and the agency's listing is empty.
      const proof = await agencyProof(w.db, w.north, w.rahim.applicantId);
      const listed = await listEvidenceSubmissions(proof, { requestId });
      expect(isOk(listed) && listed.value.submissions).toEqual([]);
      expect(isOk(listed) && listed.value.legacy).toEqual([]);
      const refused = await downloadWith(w.storage, proof, w.north, {
        id: randomId(),
        documentVersionId: doc.versionId,
      });
      expect(isErr(refused)).toBe(true);
      expect(w.storage.calls).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'only the owner can send: the agency admin, an unrelated account and a second traveller create nothing',
    async () => {
      const w = await trustWorld();
      const doc = await cleanDocument(w.db, w.rahim);
      const requestId = await openRequest(w.db, w.north, w.rahim);
      for (const who of [w.north, w.unrelated, w.karim]) {
        const result = await submitEvidenceResponse(w.db, {
          actorAccountId: who.accountId,
          requestId,
          documentId: doc.documentId,
        });
        expect(isErr(result)).toBe(true);
        expect(await submissionsOf(w.db, requestId)).toEqual([]);
        expect((await requestRow(w.db, requestId)).status).toBe('OPEN');
      }
      const owner = await send(w.db, w.rahim, requestId, doc.documentId);
      expect(isOk(owner)).toBe(true);
      expect(await submissionsOf(w.db, requestId)).toHaveLength(1);
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
describe('Rule 5: earlier declarations and accepted copies stay readable and unchanged', () => {
  it(
    'documents: the earlier version and the accepted copy survive a newer version and a replacement',
    async () => {
      const w = await trustWorld();
      const doc = await cleanDocument(w.db, w.rahim, 'bank_statement', 'first.pdf', 'b'.repeat(64));
      const requestId = await openRequest(w.db, w.north, w.rahim);
      expect(isOk(await send(w.db, w.rahim, requestId, doc.documentId))).toBe(true);
      expect(isOk(await decide(w, requestId, 'ACCEPTED'))).toBe(true);
      const readVersion = async () =>
        (
          await w.db
            .select()
            .from(schema.documentVersions)
            .where(eq(schema.documentVersions.id, doc.versionId))
        )[0];
      const earlier = structuredClone(await readVersion());
      expect(earlier).toBeDefined();
      const [accepted] = await submissionsOf(w.db, requestId);
      if (!accepted) throw new Error('row');
      const acceptedSnapshot = structuredClone(accepted);

      await addVersion(w.db, w.rahim, doc.documentId, { sha256: 'c'.repeat(64) });
      await cleanDocument(w.db, w.rahim, 'bank_statement', 'replacement.pdf', 'e'.repeat(64));

      expect(await readVersion()).toEqual(earlier);
      expect((await submissionsOf(w.db, requestId))[0]).toEqual(acceptedSnapshot);
      const ref = await downloadFresh(w, w.north, accepted);
      expect(isOk(ref)).toBe(true);
      expect(w.storage.calls.at(-1)?.objectKey).toBe(doc.objectKey);
    },
    TIMEOUT,
  );

  it(
    'facts: changing a detail keeps the earlier saved version unchanged and in the owner history',
    async () => {
      const w = await trustWorld();
      await registerCatalogueField(w.db, 'phone');
      const first = await editFact(w.db, {
        actorAccountId: w.rahim.accountId,
        applicantId: w.rahim.applicantId,
        fieldKey: 'phone',
        value: '+8801700000111',
      });
      if (!isOk(first)) throw new Error(`first fact: ${first.error.message}`);
      const factId = first.value.fact.id;
      const earlierRows = structuredClone(await listFactHistory(w.db, factId));
      expect(earlierRows).toHaveLength(1);

      const second = await editFact(w.db, {
        actorAccountId: w.rahim.accountId,
        applicantId: w.rahim.applicantId,
        fieldKey: 'phone',
        value: '+8801700000222',
      });
      expect(isOk(second)).toBe(true);

      const after = await listFactHistory(w.db, factId);
      expect(after).toHaveLength(2);
      expect(after.find((v) => v.id === earlierRows[0]?.id)).toEqual(earlierRows[0]);

      const history = await listApplicantProfile(w.db, await ownerMetaProof(w.db, w.rahim), {
        history: {},
      });
      expect(isOk(history)).toBe(true);
      if (!isOk(history)) return;
      const oldEntry = history.value.items.find((e) => e.id === earlierRows[0]?.id);
      expect(oldEntry).toMatchObject({
        value: '+8801700000111',
        isCurrent: false,
        fieldKey: 'phone',
      });
      const newEntry = history.value.items.find((e) => e.isCurrent && e.fieldKey === 'phone');
      expect(newEntry?.value).toBe('+8801700000222');
    },
    TIMEOUT,
  );

  it(
    'consent: withdrawing and granting again only adds rows; the earlier rows are unchanged',
    async () => {
      const w = await trustWorld();
      const before = structuredClone(await listConsentHistory(w.db, w.rahim.accountId));
      expect(before.length).toBeGreaterThan(0);
      for (const granted of [false, true]) {
        const result = await setConsent(w.db, {
          actorAccountId: w.rahim.accountId,
          accountId: w.rahim.accountId,
          type: 'SHARING',
          granted,
        });
        expect(isOk(result)).toBe(true);
      }
      const after = await listConsentHistory(w.db, w.rahim.accountId);
      expect(after).toHaveLength(before.length + 2);
      for (const row of before) {
        expect(after.find((r) => r.id === row.id)).toEqual(row);
      }
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
describe('Rule 6: retrying an action never duplicates it', () => {
  it(
    'the same send with the same retry key twice: one copy, one notice per admin and channel, one audit entry',
    async () => {
      const w = await trustWorld();
      await addAdmin(w.db, w.north, 'test-north-second-admin@example.test');
      const doc = await cleanDocument(w.db, w.rahim);
      const requestId = await openRequest(w.db, w.north, w.rahim);
      const key = retryKey('send');
      const first = await send(w.db, w.rahim, requestId, doc.documentId, { idempotencyKey: key });
      const again = await send(w.db, w.rahim, requestId, doc.documentId, { idempotencyKey: key });
      expect(isOk(first) && isOk(again)).toBe(true);
      if (!isOk(first) || !isOk(again)) return;
      expect(first.value.replayed).toBe(false);
      expect(again.value.replayed).toBe(true);
      expect(again.value.submissionId).toBe(first.value.submissionId);
      expect(await submissionsOf(w.db, requestId)).toHaveLength(1);

      const notices = await agencyNoticesFor(w.db, requestId);
      // Two active admins times two channels.
      expect(notices).toHaveLength(4);
      const perPair = new Set(notices.map((n) => `${n.recipientAccountId}:${n.channel}`));
      expect(perPair.size).toBe(4);
      expect(await auditCount(w.db, 'EVIDENCE_RESPONDED', requestId)).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'deciding twice records one decision and refuses the second',
    async () => {
      const w = await trustWorld();
      const doc = await cleanDocument(w.db, w.rahim);
      const requestId = await openRequest(w.db, w.north, w.rahim);
      expect(isOk(await send(w.db, w.rahim, requestId, doc.documentId))).toBe(true);
      expect(isOk(await decide(w, requestId, 'ACCEPTED'))).toBe(true);
      const second = await decide(w, requestId, 'ACCEPTED');
      expect(isErr(second)).toBe(true);
      expect(await decisionRows(w.db, requestId)).toHaveLength(1);
      expect(await auditCount(w.db, 'EVIDENCE_REQUEST_DECIDED', requestId)).toBe(1);
      const links = await w.db.select().from(schema.evidenceRequestDecisionSubmissions);
      expect(links).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'two sends racing on one request: exactly one wins; two decisions racing: exactly one wins',
    async () => {
      const w = await trustWorld();
      const doc = await cleanDocument(w.db, w.rahim);
      const requestId = await openRequest(w.db, w.north, w.rahim);
      const sends = await Promise.all([
        send(w.db, w.rahim, requestId, doc.documentId, { idempotencyKey: retryKey('race-a') }),
        send(w.db, w.rahim, requestId, doc.documentId, { idempotencyKey: retryKey('race-b') }),
      ]);
      expect(sends.filter((r) => isOk(r))).toHaveLength(1);
      expect(await submissionsOf(w.db, requestId)).toHaveLength(1);

      const decisions = await Promise.all([
        decide(w, requestId, 'ACCEPTED'),
        decide(w, requestId, 'NEEDS_REPLACEMENT'),
      ]);
      expect(decisions.filter((r) => isOk(r))).toHaveLength(1);
      expect(await decisionRows(w.db, requestId)).toHaveLength(1);
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
describe('Rule 7: AI output never becomes a confirmed fact without a person approving it', () => {
  const EARLIER = '+8801700000111';
  const SUGGESTED = '+8801700000999';
  const SECOND_SUGGESTED = '+8801700000888';

  async function currentPhone(w: TrustWorld) {
    const profile = await listApplicantProfile(w.db, w.rahim.applicantId);
    return profile.find((e) => e.fieldKey === 'phone');
  }
  async function factVersionCount(w: TrustWorld) {
    return (await w.db.select().from(schema.factVersions)).length;
  }

  it(
    'a waiting suggestion changes no fact, shows nowhere, and cannot answer a request; a rejected one still does not; approval alone saves it, with its origin recorded',
    async () => {
      const w = await trustWorld();
      await registerCatalogueField(w.db, 'phone');
      const earlier = await editFact(w.db, {
        actorAccountId: w.rahim.accountId,
        applicantId: w.rahim.applicantId,
        fieldKey: 'phone',
        value: EARLIER,
      });
      if (!isOk(earlier)) throw new Error('earlier fact');
      const app = await connectSuggestionApp(w.db, w.rahim);
      const versionsBefore = await factVersionCount(w);
      await app.suggest('phone', SUGGESTED, 'The person told me their number changed.');

      // Waiting: the earlier value stands and nothing is listed with the suggested one.
      const [pending] = await listPendingProposals(w.db, w.rahim.applicantId);
      expect(pending?.proposal).toMatchObject({ status: 'PENDING', value: SUGGESTED });
      expect(await factVersionCount(w)).toBe(versionsBefore);
      expect((await currentPhone(w))?.value).toBe(EARLIER);
      expect(JSON.stringify(await listApplicantProfile(w.db, w.rahim.applicantId))).not.toContain(
        SUGGESTED,
      );
      const current = await getCurrentFactVersion(w.db, earlier.value.fact.id);
      expect(current?.value).toBe(EARLIER);

      // A detail request cannot be answered with the waiting suggestion: it is no fact.
      const field = await requestEvidence(w.db, {
        actorAccountId: w.north.accountId,
        organizationId: w.north.organizationId,
        applicantId: w.rahim.applicantId,
        kind: 'FIELD',
        fieldKey: 'phone',
      });
      if (!isOk(field)) throw new Error(`field request: ${field.error.message}`);
      const proposalId = pending?.proposal.id ?? '';
      const withProposal = await submitEvidenceResponse(w.db, {
        actorAccountId: w.rahim.accountId,
        requestId: field.value.id,
        factId: proposalId,
      });
      expect(isErr(withProposal)).toBe(true);
      expect((await requestRow(w.db, field.value.id)).status).toBe('OPEN');
      expect((await requestRow(w.db, field.value.id)).respondingFactId).toBeNull();

      // Rejected: still nothing.
      expect(
        isOk(await rejectProposal(w.db, { actorAccountId: w.rahim.accountId, proposalId })),
      ).toBe(true);
      expect(await factVersionCount(w)).toBe(versionsBefore);
      expect((await currentPhone(w))?.value).toBe(EARLIER);

      // A second suggestion, approved by the person: now, and only now, a fact version exists.
      await app.suggest('phone', SECOND_SUGGESTED, 'A newer number from the person.');
      const [second] = await listPendingProposals(w.db, w.rahim.applicantId);
      expect(await factVersionCount(w)).toBe(versionsBefore);
      const approved = await approveProposal(w.db, {
        actorAccountId: w.rahim.accountId,
        proposalId: second?.proposal.id ?? '',
        resolution: 'changed',
        effectiveFrom: new Date(),
      });
      if (!isOk(approved)) throw new Error(`approve: ${approved.error.message}`);
      expect(await factVersionCount(w)).toBe(versionsBefore + 1);
      expect(approved.value.version).toMatchObject({
        value: SECOND_SUGGESTED,
        status: 'APPLICANT_CONFIRMED',
        method: 'MANUAL',
        modelVersion: 'connector:claude.ai',
        reason: 'ai_app_suggestion_approved',
      });
      expect((await currentPhone(w))?.value).toBe(SECOND_SUGGESTED);
      const [row] = await w.db
        .select()
        .from(schema.fieldProposals)
        .where(eq(schema.fieldProposals.id, second?.proposal.id ?? ''));
      expect(row).toMatchObject({ status: 'APPROVED', decidedByAccountId: w.rahim.accountId });
    },
    TIMEOUT,
  );

  it(
    'with no earlier value, a waiting suggestion leaves the detail empty and there is no fact to answer a request with',
    async () => {
      const w = await trustWorld();
      const app = await connectSuggestionApp(w.db, w.rahim);
      await app.suggest('phone', SUGGESTED, 'The person told me their number.');
      expect(await currentPhone(w)).toBeUndefined();
      expect(await w.db.select().from(schema.facts)).toEqual([]);
      expect(await factVersionCount(w)).toBe(0);
    },
    TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
describe('KNOWN GAP: an accepted detail answer follows the detail, not the value accepted', () => {
  /**
   * What a traveller would expect: once an agency accepted "my phone is A", the accepted answer
   * still says A even after the traveller later changes the detail to B. Today the request keeps
   * only the id of the detail, so following it gives B.
   *
   * This test pins today's exact behaviour, step by step, so the gap is on record in every run
   * and nothing else can hide behind it. The day the record starts pinning the accepted value, its
   * last assertion fails on purpose: change it then to expect the value that was accepted.
   * Documents do not have this gap. See docs/product/breakthrough/TRUST-RULES.md.
   */
  it(
    'probe: an accepted detail answer after the fact changes',
    async () => {
      const w = await trustWorld();
      await registerCatalogueField(w.db, 'phone');
      const first = await editFact(w.db, {
        actorAccountId: w.rahim.accountId,
        applicantId: w.rahim.applicantId,
        fieldKey: 'phone',
        value: '+8801700000111',
      });
      if (!isOk(first)) throw new Error('first fact');
      const field = await requestEvidence(w.db, {
        actorAccountId: w.north.accountId,
        organizationId: w.north.organizationId,
        applicantId: w.rahim.applicantId,
        kind: 'FIELD',
        fieldKey: 'phone',
      });
      if (!isOk(field)) throw new Error('field request');
      const sent = await submitEvidenceResponse(w.db, {
        actorAccountId: w.rahim.accountId,
        requestId: field.value.id,
        factId: first.value.fact.id,
      });
      expect(isOk(sent)).toBe(true);
      expect(isOk(await decide(w, field.value.id, 'ACCEPTED'))).toBe(true);

      const changed = await editFact(w.db, {
        actorAccountId: w.rahim.accountId,
        applicantId: w.rahim.applicantId,
        fieldKey: 'phone',
        value: '+8801700000222',
      });
      expect(isOk(changed)).toBe(true);

      // What the record points at now: follow the accepted request to the value it names.
      const request = await requestRow(w.db, field.value.id);
      expect(request.status).toBe('ACCEPTED');
      // The record still names the same detail, and the detail's earlier value is kept unchanged
      // in its history (rule 5); but nothing on the request says which value was accepted.
      expect(request.respondingFactId).toBe(first.value.fact.id);
      const pointed = request.respondingFactId
        ? await getCurrentFactVersion(w.db, request.respondingFactId)
        : undefined;
      // The gap: this is the new value. A traveller would expect '+8801700000111' here.
      expect(pointed?.value).toBe('+8801700000222');
    },
    TIMEOUT,
  );
});
