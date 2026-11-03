import { createHash, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AgencyCollectionScope, agencyCollectionPrincipal } from './access/collection-scope';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  addMembership,
  createOrganization,
  reviewOrganization,
  setMemberMayRequestDocuments,
} from './organizations';
import { summariseCollectionAnswers } from './umpe-collection-answer-summary';
import {
  COLLECTION_LIST_LIMIT,
  type CollectionRequestInput,
  createCollectionRequest,
  editCollectionDraft,
  endCollectionRequest,
  issueCollectionRequest,
} from './umpe-collection-request-service';
import { AGENCY_COLLECTION_REQUESTS_SWITCH } from './umpe-collection-request-switch';
import { recordCollectionReview } from './umpe-collection-response-review';
import { guestRecipientKey } from './umpe-guest-collection';

/** Synthetic data only. UMPE UX5: the answer counts on the agency's Document Requests list. */

const NONE = { terms: [], known: false };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

function input(overrides: Partial<CollectionRequestInput> = {}): CollectionRequestInput {
  return {
    destination: 'GB',
    purpose: 'Tourism',
    route: 'Standard Visitor',
    travelFrom: null,
    travelTo: null,
    dueAt: null,
    nationality: null,
    residence: null,
    applicationPlace: null,
    recipientNameHint: 'Synthetic Person',
    recipientEmailHint: null,
    packTerms: {
      country: ['GB'],
      purpose: ['Tourism'],
      traveller: { nationality: NONE, residence: NONE },
    },
    ...overrides,
  };
}

describe('UMPE UX5: answer counts for the request list', () => {
  let client: PGlite;
  let db: Db;
  let adminId: string;
  let orgId: string;
  let workerId: string;
  let workerMembershipId: string;
  let travellerId: string;

  async function account(email: string): Promise<string> {
    const result = await provisionAccount(db, { email });
    if (!isOk(result)) throw new Error('account');
    await setConsent(db, {
      actorAccountId: result.value.id,
      accountId: result.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    return result.value.id;
  }

  async function activeAgency(adminEmail: string, name: string) {
    const admin = await account(adminEmail);
    const org = await createOrganization(db, { actorAccountId: admin, name });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await account(`reviewer-${randomUUID()}@platform.example.test`);
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('activate');
    return { admin, organizationId: org.value.id };
  }

  async function scopeOf(
    accountId = adminId,
    organizationId = orgId,
  ): Promise<AgencyCollectionScope> {
    const minted = await agencyCollectionPrincipal(db, accountId, organizationId);
    if (!minted.ok) throw new Error('scope refused');
    return minted.value;
  }

  async function issuedRequest(by = adminId, organizationId = orgId) {
    const scope = await scopeOf(by, organizationId);
    const created = await createCollectionRequest(db, scope, input());
    if (!created.ok) throw new Error(created.error.message);
    const added = await editCollectionDraft(db, scope, created.value.id, {
      type: 'add',
      label: 'Synthetic bank letter',
      necessity: 'MANDATORY',
    });
    if (!added.ok) throw new Error(added.error.message);
    const issued = await issueCollectionRequest(db, scope, created.value.id);
    if (!issued.ok) throw new Error(issued.error.message);
    return {
      requestId: created.value.id,
      revisionId: issued.value.revisionId,
      linkId: issued.value.link.id,
    };
  }

  type Issued = Awaited<ReturnType<typeof issuedRequest>>;

  /** A signed-in person's live answer, written directly (the summary only reads rows). */
  async function accountAnswer(request: Issued, organizationId = orgId): Promise<string> {
    const created = await createApplicant(db, {
      actorAccountId: travellerId,
      ownerAccountId: travellerId,
      displayName: 'Synthetic Traveller',
    });
    if (!isOk(created)) throw new Error('applicant');
    const [row] = await db
      .insert(schema.agencyCollectionResponses)
      .values({
        organizationId,
        requestId: request.requestId,
        revisionId: request.revisionId,
        linkId: request.linkId,
        applicantId: created.value.id,
        submittedByAccountId: travellerId,
        destination: 'GB',
        revisionNo: 1,
        personName: 'Synthetic Traveller',
        consentVersion: 'synthetic-v1',
        contentSha256: sha(`answer-${randomUUID()}`),
      })
      .returning({ id: schema.agencyCollectionResponses.id });
    if (!row) throw new Error('response');
    return row.id;
  }

  async function withdraw(responseId: string, reason: 'WITHDRAWN' | 'REPLACED'): Promise<void> {
    const [response] = await db
      .select({ applicantId: schema.agencyCollectionResponses.applicantId })
      .from(schema.agencyCollectionResponses)
      .where(eq(schema.agencyCollectionResponses.id, responseId));
    await db.insert(schema.agencyCollectionResponseWithdrawals).values({
      responseId,
      applicantId: response?.applicantId ?? '',
      withdrawnByAccountId: travellerId,
      reason,
    });
  }

  /** A guest's submission number `no` from the person at this address. */
  async function guestAnswer(
    request: Issued,
    address: string,
    no = 1,
    organizationId = orgId,
  ): Promise<string> {
    const [row] = await db
      .insert(schema.agencyCollectionGuestSubmissions)
      .values({
        organizationId,
        requestId: request.requestId,
        revisionId: request.revisionId,
        linkId: request.linkId,
        recipientKey: guestRecipientKey(address),
        revisionNo: 1,
        submissionNo: no,
        retentionDays: 30,
        consentVersion: 'synthetic-v1',
        contentSha256: sha(`guest-${randomUUID()}`),
      })
      .returning({ id: schema.agencyCollectionGuestSubmissions.id });
    if (!row) throw new Error('submission');
    return row.id;
  }

  /** One decision with a fixed time, so ordering is exact. */
  async function decide(
    source: 'account' | 'guest',
    request: Issued,
    answerId: string,
    decision: 'RECEIVED' | 'NEEDS_CORRECTION' | 'ACCEPTED',
    at: string,
  ): Promise<void> {
    await db.insert(schema.agencyCollectionReviews).values({
      organizationId: orgId,
      requestId: request.requestId,
      source,
      responseId: source === 'account' ? answerId : null,
      guestSubmissionId: source === 'guest' ? answerId : null,
      decision,
      note: decision === 'NEEDS_CORRECTION' ? 'Synthetic note' : null,
      decidedByAccountId: adminId,
      decidedAt: new Date(at),
    });
  }

  const summaryOf = async (request: Issued) =>
    (await summariseCollectionAnswers(db, await scopeOf(), [request.requestId])).get(
      request.requestId,
    );

  beforeEach(async () => {
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
    client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    const agency = await activeAgency('admin@agency-ux5.example.test', 'Synthetic Agency One');
    adminId = agency.admin;
    orgId = agency.organizationId;
    workerId = await account('worker@agency-ux5.example.test');
    const added = await addMembership(db, {
      actorAccountId: adminId,
      organizationId: orgId,
      accountId: workerId,
      role: 'CASE_MANAGER',
    });
    if (!isOk(added)) throw new Error('member');
    workerMembershipId = added.value.id;
    travellerId = await account('traveller@people.example.test');
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await client.close();
  });

  it('counts a signed-in answer and a guest answer, all waiting until someone decides', async () => {
    const request = await issuedRequest();
    await accountAnswer(request);
    await guestAnswer(request, 'guest@example.test');
    expect(await summaryOf(request)).toEqual({
      answers: 2,
      waiting: 2,
      needsCorrection: 0,
      accepted: 0,
    });
  });

  it('gives a request with no answer no entry, and keeps each request apart', async () => {
    const quiet = await issuedRequest();
    const busy = await issuedRequest();
    await guestAnswer(busy, 'guest@example.test');
    const summary = await summariseCollectionAnswers(db, await scopeOf(), [
      quiet.requestId,
      busy.requestId,
    ]);
    expect(summary.has(quiet.requestId)).toBe(false);
    expect(summary.get(busy.requestId)?.answers).toBe(1);
  });

  it('does not count a withdrawn or replaced answer', async () => {
    const request = await issuedRequest();
    const withdrawn = await accountAnswer(request);
    const replaced = await accountAnswer(request);
    await accountAnswer(request);
    await withdraw(withdrawn, 'WITHDRAWN');
    await withdraw(replaced, 'REPLACED');
    expect(await summaryOf(request)).toEqual({
      answers: 1,
      waiting: 1,
      needsCorrection: 0,
      accepted: 0,
    });
  });

  it('reads waiting, needs correction and accepted from the latest decision', async () => {
    const request = await issuedRequest();
    const a = await accountAnswer(request);
    const b = await accountAnswer(request);
    const c = await accountAnswer(request);
    const d = await accountAnswer(request);
    const g = await guestAnswer(request, 'guest@example.test');
    await decide('account', request, a, 'RECEIVED', '2026-11-01T10:00:00Z');
    await decide('account', request, b, 'NEEDS_CORRECTION', '2026-11-01T10:00:00Z');
    await decide('account', request, c, 'ACCEPTED', '2026-11-01T10:00:00Z');
    await decide('guest', request, g, 'ACCEPTED', '2026-11-01T10:00:00Z');
    // d has no decision at all.
    expect(d).toBeTruthy();
    // Received is still waiting: it is never reviewed or accepted.
    expect(await summaryOf(request)).toEqual({
      answers: 5,
      waiting: 2,
      needsCorrection: 1,
      accepted: 2,
    });
  });

  it('lets a later decision override an earlier one, in both directions', async () => {
    const request = await issuedRequest();
    const a = await accountAnswer(request);
    const g = await guestAnswer(request, 'guest@example.test');
    await decide('account', request, a, 'ACCEPTED', '2026-11-01T10:00:00Z');
    await decide('account', request, a, 'NEEDS_CORRECTION', '2026-11-02T10:00:00Z');
    await decide('guest', request, g, 'NEEDS_CORRECTION', '2026-11-01T10:00:00Z');
    await decide('guest', request, g, 'ACCEPTED', '2026-11-03T10:00:00Z');
    expect(await summaryOf(request)).toEqual({
      answers: 2,
      waiting: 0,
      needsCorrection: 1,
      accepted: 1,
    });
  });

  it('counts a decision made through the review service', async () => {
    const request = await issuedRequest();
    const g = await guestAnswer(request, 'guest@example.test');
    const decided = await recordCollectionReview(db, await scopeOf(), {
      source: 'guest',
      answerId: g,
      decision: 'ACCEPTED',
    });
    expect(decided.ok).toBe(true);
    expect((await summaryOf(request))?.accepted).toBe(1);
  });

  it('counts a guest who sent again once: only the newest submission of each recipient', async () => {
    const request = await issuedRequest();
    const first = await guestAnswer(request, 'guest@example.test', 1);
    await guestAnswer(request, 'guest@example.test', 2);
    await guestAnswer(request, 'other@example.test', 1);
    // The old revision was never reviewed, and an old decision on it changes nothing either.
    await decide('guest', request, first, 'ACCEPTED', '2026-11-01T10:00:00Z');
    expect(await summaryOf(request)).toEqual({
      answers: 2,
      waiting: 2,
      needsCorrection: 0,
      accepted: 0,
    });
  });

  it('keeps the answers of a closed request but counts none for a revoked one', async () => {
    const closed = await issuedRequest();
    const revoked = await issuedRequest();
    for (const request of [closed, revoked]) {
      await accountAnswer(request);
      await guestAnswer(request, 'guest@example.test');
    }
    const scope = await scopeOf();
    expect((await endCollectionRequest(db, scope, closed.requestId, 'CLOSED')).ok).toBe(true);
    expect((await endCollectionRequest(db, scope, revoked.requestId, 'REVOKED')).ok).toBe(true);
    const summary = await summariseCollectionAnswers(db, await scopeOf(), [
      closed.requestId,
      revoked.requestId,
    ]);
    expect(summary.get(closed.requestId)?.answers).toBe(2);
    expect(summary.has(revoked.requestId)).toBe(false);
  });

  describe('who may read it', () => {
    it('gives a member with May Request Documents an empty map, even for their own request', async () => {
      const changed = await setMemberMayRequestDocuments(db, await scopeOf(), {
        membershipId: workerMembershipId,
        allowed: true,
      });
      if (!changed.ok) throw new Error(changed.error.message);
      const own = await issuedRequest(workerId);
      await guestAnswer(own, 'guest@example.test');
      const worker = await scopeOf(workerId);
      expect(worker.authority).toBe('REQUESTER');
      expect((await summariseCollectionAnswers(db, worker, [own.requestId])).size).toBe(0);
      // The same answer is there for an owner or admin.
      expect((await summaryOf(own))?.answers).toBe(1);
    });

    it('gives nothing for another agency, however the ids are passed', async () => {
      const other = await activeAgency('admin@agency-two.example.test', 'Synthetic Agency Two');
      const foreign = await issuedRequest(other.admin, other.organizationId);
      await guestAnswer(foreign, 'guest@example.test', 1, other.organizationId);
      await accountAnswer(foreign, other.organizationId);
      const mine = await issuedRequest();
      await guestAnswer(mine, 'guest@example.test');
      const summary = await summariseCollectionAnswers(db, await scopeOf(), [
        foreign.requestId,
        foreign.requestId.toUpperCase(),
        mine.requestId,
      ]);
      expect([...summary.keys()]).toEqual([mine.requestId]);
      // And the other agency's own admin does read theirs.
      const theirs = await summariseCollectionAnswers(
        db,
        await scopeOf(other.admin, other.organizationId),
        [foreign.requestId],
      );
      expect(theirs.get(foreign.requestId)?.answers).toBe(2);
    });

    it('gives nothing while the agency is not reviewed', async () => {
      const request = await issuedRequest();
      await guestAnswer(request, 'guest@example.test');
      const scope = await scopeOf();
      await db
        .update(schema.organizations)
        .set({ status: 'PENDING_VERIFICATION' })
        .where(eq(schema.organizations.id, orgId));
      expect((await summariseCollectionAnswers(db, scope, [request.requestId])).size).toBe(0);
    });

    it('gives nothing when the switch is off', async () => {
      const request = await issuedRequest();
      await guestAnswer(request, 'guest@example.test');
      const scope = await scopeOf();
      vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, '');
      expect((await summariseCollectionAnswers(db, scope, [request.requestId])).size).toBe(0);
    });

    it('refuses a copy of a scope', async () => {
      const request = await issuedRequest();
      await guestAnswer(request, 'guest@example.test');
      const copy = { ...(await scopeOf()) } as unknown as AgencyCollectionScope;
      expect((await summariseCollectionAnswers(db, copy, [request.requestId])).size).toBe(0);
    });
  });

  describe('the ids it is given', () => {
    it('ignores ids that are malformed, repeated or not requests at all', async () => {
      const request = await issuedRequest();
      await accountAnswer(request);
      const summary = await summariseCollectionAnswers(db, await scopeOf(), [
        'not-an-id',
        '',
        "'; drop table agency_collection_requests; --",
        randomUUID(),
        request.requestId,
        request.requestId,
        request.requestId.toUpperCase(),
      ]);
      expect([...summary.keys()]).toEqual([request.requestId]);
      expect(summary.get(request.requestId)?.answers).toBe(1);
      expect((await summariseCollectionAnswers(db, await scopeOf(), [])).size).toBe(0);
    });

    it('reads no more than the list limit, so a long list cannot widen the query', async () => {
      const request = await issuedRequest();
      await guestAnswer(request, 'guest@example.test');
      const filler = Array.from({ length: COLLECTION_LIST_LIMIT }, () => randomUUID());
      const scope = await scopeOf();
      // Inside the limit it is read; beyond it, it is ignored.
      expect(
        (await summariseCollectionAnswers(db, scope, [request.requestId, ...filler])).size,
      ).toBe(1);
      expect(
        (await summariseCollectionAnswers(db, scope, [...filler, request.requestId])).size,
      ).toBe(0);
    });
  });

  describe('before the migrations have run', () => {
    it('counts only guest answers when the signed-in answer tables are missing', async () => {
      const request = await issuedRequest();
      await accountAnswer(request);
      await guestAnswer(request, 'guest@example.test');
      await client.exec('drop table agency_collection_response_withdrawals');
      expect(await summaryOf(request)).toEqual({
        answers: 1,
        waiting: 1,
        needsCorrection: 0,
        accepted: 0,
      });
    });

    it('counts only signed-in answers, all waiting, when the review and guest tables are missing', async () => {
      const request = await issuedRequest();
      await accountAnswer(request);
      await guestAnswer(request, 'guest@example.test');
      await client.exec('drop table agency_collection_reviews');
      expect(await summaryOf(request)).toEqual({
        answers: 1,
        waiting: 1,
        needsCorrection: 0,
        accepted: 0,
      });
    });

    it('returns an empty map, without throwing, when every answer table is missing', async () => {
      const request = await issuedRequest();
      await client.exec('drop table agency_collection_response_withdrawals');
      await client.exec('drop table agency_collection_reviews');
      const summary = await summariseCollectionAnswers(db, await scopeOf(), [request.requestId]);
      expect(summary.size).toBe(0);
    });
  });
});
