import { schema } from '@visastack/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountPrincipal, requireAccess } from '../access';
import { agencyCollectionPrincipal, collectionLinkProof } from '../access/collection-scope';
import { guestCollectionSessionProof } from '../access/guest-collection';
import { verifyStepUp } from '../access/step-up-proof';
import { buildManifest, listRequirements } from '../packs';
import { issueStepUpAssurance } from '../step-up';
import {
  createCollectionRequest,
  endCollectionRequest,
  issueCollectionRequest,
} from '../umpe-collection-request-service';
import { AGENCY_COLLECTION_REQUESTS_SWITCH } from '../umpe-collection-request-switch';
import {
  RESPONSE_CONSENT_VERSION,
  documentKey,
  factKey,
} from '../umpe-collection-response-evidence';
import { recordCollectionReview } from '../umpe-collection-response-review';
import {
  proposeCollectionResponse,
  submitCollectionResponse,
  withdrawCollectionResponse,
} from '../umpe-collection-response-service';
import { startGuestSession } from '../umpe-guest-collection';
import type { CollectionAnswer } from './load';
import {
  AGENCY_B_NAME,
  EMPLOYMENT_FIELD,
  HEAVY,
  type ImpactWorld,
  PASSPORT_TYPE,
  buildImpactWorld,
  changeEmploymentDetail,
  itemOf,
  must,
  ownerManage,
  readDetailImpact,
  readDocumentImpact,
  replaceWithNewerPassport,
} from './scenario.test-support';
import { collectionAnswerDrafts } from './shared';

/*
 * An answered agency checklist (a collection response) carries exact copies and exact saved
 * values. Agency B asks for a passport and the employment detail through its own checklist link;
 * the traveller answers from their record through the real services.
 *
 * What the agency then decides about the answer is its own review, kept for the asking agency
 * alone and not part of this read by design. So an answer that holds the earlier copy or value
 * gets its own item that says exactly that and points at the answer, never a guess at its state;
 * nothing failed, so the read stays complete. An answer that holds the current copy or value
 * needs nothing either way.
 */

const STEP_UP_SECRET = 'impact-collection-step-up-secret';

/**
 * A published checklist the agency's request can be built from. Its rows are written directly, as
 * the collection tests do: no service publishes an authoritative checklist for a country and purpose.
 */
async function officialChecklist(w: ImpactWorld): Promise<void> {
  const [pack] = await w.db
    .insert(schema.packs)
    .values({
      key: 'impact.sample.gb.tourism',
      name: 'Sample UK Visit',
      jurisdiction: 'United Kingdom',
      purpose: 'Tourism',
      authoritative: true,
    })
    .returning();
  if (!pack) throw new Error('pack');
  const [version] = await w.db
    .insert(schema.packVersions)
    .values({ packId: pack.id, version: 1, status: 'PUBLISHED' })
    .returning();
  if (!version) throw new Error('version');
  await w.db.insert(schema.packRequirements).values([
    {
      packVersionId: version.id,
      kind: 'DOCUMENT',
      docType: PASSPORT_TYPE,
      citation: 'Sample rule 1',
      optional: false,
    },
    {
      packVersionId: version.id,
      kind: 'FIELD',
      fieldKey: EMPLOYMENT_FIELD,
      citation: 'Sample rule 2',
      optional: false,
    },
  ]);
  const { checksum } = buildManifest(await listRequirements(w.db, version.id));
  await w.db
    .update(schema.packVersions)
    .set({ checksum })
    .where(eq(schema.packVersions.id, version.id));
}

async function agencyScope(w: ImpactWorld) {
  return must(
    await agencyCollectionPrincipal(w.db, w.agencyB.accountId, w.agencyB.organizationId),
    'agency scope',
  );
}

/** Agency B issues a checklist request and the traveller answers it with what the desk proposes. */
async function answerChecklist(w: ImpactWorld, token?: string) {
  let rawToken = token;
  if (!rawToken) {
    const created = must(
      await createCollectionRequest(w.db, await agencyScope(w), {
        destination: 'GB',
        purpose: 'Tourism',
        route: null,
        travelFrom: '2027-03-01',
        travelTo: '2027-03-15',
        dueAt: null,
        nationality: 'Bangladesh',
        residence: null,
        applicationPlace: null,
        recipientNameHint: 'Test Traveller',
        recipientEmailHint: null,
        packTerms: {
          country: ['GB', 'United Kingdom'],
          purpose: ['tourism', 'Tourism'],
          traveller: {
            nationality: { terms: [], known: false },
            residence: { terms: [], known: false },
          },
        },
      }),
      'collection request',
    );
    const issued = must(
      await issueCollectionRequest(w.db, await agencyScope(w), created.id),
      'issue',
    );
    rawToken = issued.link.rawToken;
  }
  const session = async () => {
    const link = collectionLinkProof(rawToken ?? '');
    if (!link) throw new Error('link');
    const started = await startGuestSession(w.db, link, null);
    const proof = guestCollectionSessionProof(started?.rawSessionId ?? undefined);
    if (!proof) throw new Error('session');
    return proof;
  };
  const principal = accountPrincipal(w.rahim.accountId);
  const ref = { applicantId: w.rahim.applicantId };
  const view = must(
    await requireAccess(w.db, principal, 'VIEW_METADATA', ref, { purpose: 'collection_response' }),
    'view',
  );
  const proposal = must(
    await proposeCollectionResponse(w.db, await session(), view, {}),
    'propose',
  );
  const selections: Record<string, string[]> = {};
  for (const line of proposal.proposals) {
    if (line.proposedKey) selections[line.item.id] = [line.proposedKey];
  }
  const binding = {
    accountId: w.rahim.accountId,
    action: 'SHARE' as const,
    resourceId: w.rahim.applicantId,
  };
  const stepUp = verifyStepUp(
    STEP_UP_SECRET,
    issueStepUpAssurance(STEP_UP_SECRET, binding),
    binding,
  );
  if (!stepUp) throw new Error('step up');
  const share = must(
    await requireAccess(w.db, principal, 'SHARE', ref, { purpose: 'collection_response', stepUp }),
    'share',
  );
  const submitted = must(
    await submitCollectionResponse(w.db, await session(), share, {
      selections,
      consentVersion: RESPONSE_CONSENT_VERSION,
      linkId: proposal.desk.linkId,
      revisionId: proposal.desk.revisionId,
    }),
    'submit',
  );
  return { responseId: submitted.responseId, token: rawToken, selections };
}

async function review(
  w: ImpactWorld,
  responseId: string,
  decision: 'RECEIVED' | 'NEEDS_CORRECTION' | 'ACCEPTED',
) {
  return must(
    await recordCollectionReview(w.db, await agencyScope(w), {
      source: 'account',
      answerId: responseId,
      decision,
      ...(decision === 'NEEDS_CORRECTION' ? { note: 'made-up note' } : {}),
    }),
    `review ${decision}`,
  );
}

describe('an answered agency checklist', () => {
  beforeEach(() => {
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    'needs nothing while it holds what is current, and is named but never guessed at once it holds the earlier copy or value',
    async () => {
      const w = await buildImpactWorld();
      await officialChecklist(w);
      const answer = await answerChecklist(w);
      // The answer carried the older passport and the first value of the employment detail.
      expect(Object.values(answer.selections).flat().sort()).toEqual(
        [documentKey(w.p1.versionId), factKey(w.e.v1)].sort(),
      );
      const id = `response:${answer.responseId}`;

      // Before the detail changes, the answer holds its current value: nothing to do.
      expect((await readDetailImpact(w)).complete).toBe(true);
      // A preview of replacing the passport already says the answer would hold the earlier copy.
      const preview = await readDocumentImpact(w);
      expect(preview.phase).toBe('PREVIEW');
      expect(itemOf(preview, id).reason).toBe('CHECKLIST_ANSWER_HOLDS_EARLIER');
      expect(preview.complete).toBe(true);
      expect(itemOf(await readDetailImpact(w), id)).toEqual({
        id,
        outcome: 'NO_ACTION',
        reason: 'AGENCY_HOLDS_CURRENT',
        area: 'AGENCY_REQUESTS',
        about: {
          kind: 'AGENCY_REQUEST',
          source: 'COLLECTION_RESPONSE',
          requestId: answer.responseId,
          organizationId: w.agencyB.organizationId,
          organizationName: AGENCY_B_NAME,
          missionId: null,
          caseTitle: null,
          sentAt: expect.any(Date),
          decidedAt: null,
        },
        nextStep: null,
      });

      await replaceWithNewerPassport(w);
      await changeEmploymentDetail(w);

      // The answer now holds the earlier copy and value. Whatever the agency decides, the read
      // does not see it, so it never says "checking", "accepted" or "sent back": it says the
      // answer holds the earlier copy or value and offers the answer itself.
      const unknown = async () => {
        for (const impact of [await readDocumentImpact(w), await readDetailImpact(w)]) {
          expect(itemOf(impact, id)).toEqual({
            id,
            outcome: 'UNKNOWN',
            reason: 'CHECKLIST_ANSWER_HOLDS_EARLIER',
            area: 'AGENCY_REQUESTS',
            about: {
              kind: 'AGENCY_REQUEST',
              source: 'COLLECTION_RESPONSE',
              requestId: answer.responseId,
              organizationId: w.agencyB.organizationId,
              organizationName: AGENCY_B_NAME,
              missionId: null,
              caseTitle: null,
              sentAt: expect.any(Date),
              decidedAt: null,
            },
            nextStep: { kind: 'OPEN_REQUEST', requestId: answer.responseId },
          });
          // Nothing failed: no part is reported as unread, and the read is complete.
          expect(impact.items.some((item) => item.reason === 'COULD_NOT_CHECK')).toBe(false);
          expect(impact.complete).toBe(true);
          expect(impact.quiet).toBe(false);
          expect(impact.counts.UNKNOWN).toBe(1);
        }
      };
      await unknown();
      await review(w, answer.responseId, 'RECEIVED');
      await unknown();
      await review(w, answer.responseId, 'NEEDS_CORRECTION');
      await unknown();
      await review(w, answer.responseId, 'ACCEPTED');
      await unknown();
      // The rest of the agency part still answers: Agency A's request is listed as before.
      expect(itemOf(await readDocumentImpact(w), `request:${w.documentRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );

      // The traveller answers again with the current passport and value: the earlier answer is
      // replaced (no longer listed) and the new one holds what is current.
      const again = await answerChecklist(w, answer.token);
      for (const impact of [await readDocumentImpact(w), await readDetailImpact(w)]) {
        expect(impact.items.some((item) => item.id === id)).toBe(false);
        expect(itemOf(impact, `response:${again.responseId}`)).toMatchObject({
          outcome: 'NO_ACTION',
          reason: 'AGENCY_HOLDS_CURRENT',
          nextStep: null,
        });
        expect(impact.complete).toBe(true);
      }

      // Withdrawn by the traveller: not listed.
      must(
        await withdrawCollectionResponse(w.db, await ownerManage(w.db, w.rahim), again.responseId),
        'withdraw',
      );
      const withdrawn = await readDocumentImpact(w);
      expect(withdrawn.items.some((item) => item.id.startsWith('response:'))).toBe(false);
    },
    HEAVY,
  );

  it(
    'holds the earlier copy while any line of the answer still carries it, even beside the newer one',
    async () => {
      const w = await buildImpactWorld();
      await officialChecklist(w);
      const answer = await answerChecklist(w);
      const { newer } = await replaceWithNewerPassport(w);
      // By hand: the same passport line also carries the newer passport, as an answer that
      // chose two copies for one line records it.
      const items = schema.agencyCollectionResponseItems;
      const [line] = await w.db
        .select({ itemId: items.itemId })
        .from(items)
        .where(and(eq(items.responseId, answer.responseId), eq(items.documentId, w.p1.documentId)));
      if (!line) throw new Error('passport line');
      await w.db.insert(items).values({
        responseId: answer.responseId,
        itemId: line.itemId,
        kind: 'DOCUMENT',
        documentId: newer.documentId,
        documentVersionId: newer.versionId,
        title: 'sample-passport-newer.pdf',
      });

      expect(itemOf(await readDocumentImpact(w), `response:${answer.responseId}`)).toMatchObject({
        outcome: 'UNKNOWN',
        reason: 'CHECKLIST_ANSWER_HOLDS_EARLIER',
      });
    },
    HEAVY,
  );
});

describe('an answered agency checklist whose collection has ended', () => {
  beforeEach(() => {
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    'is history once the agency has closed the collection, and stays "cannot tell" while the collection is still open',
    async () => {
      const w = await buildImpactWorld();
      await officialChecklist(w);
      const answer = await answerChecklist(w);
      const id = `response:${answer.responseId}`;
      const [response] = await w.db
        .select({ requestId: schema.agencyCollectionResponses.requestId })
        .from(schema.agencyCollectionResponses)
        .where(eq(schema.agencyCollectionResponses.id, answer.responseId));
      if (!response) throw new Error('response');
      await replaceWithNewerPassport(w);
      await changeEmploymentDetail(w);

      // Still being collected: where the answer stands is not known here, so it is never history.
      for (const impact of [await readDocumentImpact(w), await readDetailImpact(w)]) {
        expect(itemOf(impact, id)).toMatchObject({
          outcome: 'UNKNOWN',
          reason: 'CHECKLIST_ANSWER_HOLDS_EARLIER',
        });
      }

      // The agency closes the collection: it is finished, and the earlier answer is on record.
      must(
        await endCollectionRequest(w.db, await agencyScope(w), response.requestId, 'CLOSED'),
        'close',
      );
      for (const impact of [await readDocumentImpact(w), await readDetailImpact(w)]) {
        expect(itemOf(impact, id)).toMatchObject({
          outcome: 'HISTORY_PRESERVED',
          reason: 'CHECKLIST_ANSWER_FINISHED',
          nextStep: null,
        });
        expect(impact.complete).toBe(true);
        expect(impact.counts.UNKNOWN).toBe(0);
      }
    },
    HEAVY,
  );
});

describe('judging a checklist answer from what is recorded about its collection', () => {
  const answer = (requestStatus: string | null): CollectionAnswer => ({
    responseId: 'r-1',
    agencyId: 'a-1',
    agencyName: 'Sample Agency',
    submittedAt: new Date('2026-11-01T00:00:00Z'),
    carriedIds: ['v-1'],
    requestStatus,
  });
  const reasonFor = (requestStatus: string | null, carries: 'EARLIER' | 'CURRENT') =>
    collectionAnswerDrafts([answer(requestStatus)], () => carries).map((d) => d.item.reason);

  it('is history only for a collection recorded as closed that holds the earlier answer', () => {
    expect(reasonFor('CLOSED', 'EARLIER')).toEqual(['CHECKLIST_ANSWER_FINISHED']);
  });

  it('never assumes a collection is closed from a missing or unfinished record', () => {
    for (const status of [null, 'SENT', 'DRAFT', 'SOMETHING_NEW']) {
      expect(reasonFor(status, 'EARLIER')).toEqual(['CHECKLIST_ANSWER_HOLDS_EARLIER']);
    }
  });

  it('still needs nothing when the answer holds the current copy or value, closed or not', () => {
    expect(reasonFor('CLOSED', 'CURRENT')).toEqual(['AGENCY_HOLDS_CURRENT']);
    expect(reasonFor('SENT', 'CURRENT')).toEqual(['AGENCY_HOLDS_CURRENT']);
  });
});
