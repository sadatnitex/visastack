import { isErr, isOk } from '@visastack/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { decideEvidenceResponse } from './agency';
import type { Db } from './db';
import {
  REQUEST_HISTORY_MAX_REQUESTS,
  REQUEST_HISTORY_SENDS_SHOWN,
  listRequestHistoriesForOwner,
} from './evidence-request-histories';
import { listEvidenceSubmissions } from './evidence-submissions';
import {
  type Agency,
  type Traveller,
  agency,
  agencyProof,
  cleanDocument,
  freshDb,
  openRequest,
  ownerProof,
  send,
  share,
  traveller,
} from './evidence-submissions.test-support';

/**
 * The batched reader behind the traveller's conversations: the same facts as the single reader,
 * for many requests in a fixed number of queries, for the owner only. Synthetic data only.
 */

const TIMEOUT = 180_000;

interface World {
  db: Db;
  alice: Traveller;
  bob: Traveller;
  harbor: Agency;
}

async function world(): Promise<World> {
  const db = await freshDb();
  const alice = await traveller(db, 'alice-h@example.com');
  const bob = await traveller(db, 'bob-h@example.com');
  const harbor = await agency(db, 'harbor-h@example.com', 'Harbor Visas');
  await share(db, alice, harbor);
  await share(db, bob, harbor);
  return { db, alice, bob, harbor };
}

const sendBack = (w: World, requestId: string, reason = 'does not stand') =>
  decideEvidenceResponse(w.db, {
    actorAccountId: w.harbor.accountId,
    requestId,
    outcome: 'NEEDS_REPLACEMENT',
    reason,
  });

describe('listing what was said on many requests at once', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, TIMEOUT);

  it('gives each request the same sends the single reader gives, and its decisions', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const first = await openRequest(w.db, w.harbor, w.alice);
    const second = await openRequest(w.db, w.harbor, w.alice, 'passport');
    expect(isOk(await send(w.db, w.alice, first, doc.documentId))).toBe(true);
    expect(isOk(await sendBack(w, first, 'the last page is cut off'))).toBe(true);
    expect(isOk(await send(w.db, w.alice, first, doc.documentId))).toBe(true);

    const proof = await ownerProof(w.db, w.alice);
    const batch = await listRequestHistoriesForOwner(proof, { requestIds: [first, second] });
    expect(isOk(batch)).toBe(true);
    if (!isOk(batch)) return;
    for (const requestId of [first, second]) {
      const single = await listEvidenceSubmissions(proof, { requestId });
      expect(isOk(single)).toBe(true);
      if (!isOk(single)) return;
      // The single reader also reads each file's live scan status; the traveller's batch does not.
      expect(batch.value.get(requestId)?.sends).toEqual({
        ...single.value,
        submissions: single.value.submissions.map((s) => ({ ...s, safetyStatus: null })),
      });
    }
    const history = batch.value.get(first);
    expect(history?.sends.submissions.map((s) => s.state)).toEqual([
      'NEEDS_REPLACEMENT',
      'AWAITING_DECISION',
    ]);
    expect(history?.decisions.map((d) => [d.outcome, d.reason])).toEqual([
      ['NEEDS_REPLACEMENT', 'the last page is cut off'],
    ]);
    expect(history?.olderSends).toBe(0);
    // A request nobody has answered has nothing, and is still described, not dropped.
    expect(batch.value.get(second)?.sends.submissions).toEqual([]);
  });

  it("leaves out a request that is not the traveller's, a missing one and a malformed one", async () => {
    const aliceDoc = await cleanDocument(w.db, w.alice);
    const bobDoc = await cleanDocument(w.db, w.bob);
    const mine = await openRequest(w.db, w.harbor, w.alice);
    const bobs = await openRequest(w.db, w.harbor, w.bob);
    expect(isOk(await send(w.db, w.alice, mine, aliceDoc.documentId))).toBe(true);
    expect(isOk(await send(w.db, w.bob, bobs, bobDoc.documentId))).toBe(true);

    const batch = await listRequestHistoriesForOwner(await ownerProof(w.db, w.alice), {
      requestIds: [mine, bobs, '00000000-0000-4000-8000-000000000000', 'not-an-id'],
    });
    expect(isOk(batch)).toBe(true);
    if (!isOk(batch)) return;
    expect([...batch.value.keys()]).toEqual([mine]);
    // Nothing of Bob's leaks into Alice's answer.
    expect(JSON.stringify([...batch.value.values()])).not.toContain(bobDoc.documentId);
  });

  it('answers anyone but the owner as it answers a request that does not exist', async () => {
    const doc = await cleanDocument(w.db, w.alice);
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
    const asAgency = await listRequestHistoriesForOwner(
      await agencyProof(w.db, w.harbor, w.alice.applicantId),
      { requestIds: [requestId] },
    );
    expect(isErr(asAgency) && asAgency.error.code).toBe('not_found');
  });

  it('shows no file, storage key or scan status to the traveller', async () => {
    const doc = await cleanDocument(w.db, w.alice, 'bank_statement', 'march.pdf', 'f'.repeat(64));
    const requestId = await openRequest(w.db, w.harbor, w.alice);
    expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
    const batch = await listRequestHistoriesForOwner(await ownerProof(w.db, w.alice), {
      requestIds: [requestId],
    });
    if (!isOk(batch)) throw new Error('read');
    const sent = batch.value.get(requestId)?.sends.submissions[0];
    expect(sent).toMatchObject({ fileAvailable: false, safetyStatus: null, title: 'march.pdf' });
    const text = JSON.stringify([...batch.value.values()]);
    expect(text).not.toContain(doc.objectKey);
    expect(text).not.toContain(doc.storageObjectId);
    expect(text).not.toContain('f'.repeat(64));
  });

  it('keeps a call to a fixed number of ids', async () => {
    const ids = Array.from({ length: REQUEST_HISTORY_MAX_REQUESTS + 1 }, () => crypto.randomUUID());
    const refused = await listRequestHistoriesForOwner(await ownerProof(w.db, w.alice), {
      requestIds: ids,
    });
    expect(isErr(refused) && refused.error.code).toBe('invalid');
    const none = await listRequestHistoriesForOwner(await ownerProof(w.db, w.alice), {
      requestIds: [],
    });
    expect(isOk(none) && none.value.size).toBe(0);
  });

  it(
    'lists the newest sends only, and counts the older ones it leaves out',
    async () => {
      const doc = await cleanDocument(w.db, w.alice);
      const requestId = await openRequest(w.db, w.harbor, w.alice);
      const rounds = REQUEST_HISTORY_SENDS_SHOWN + 2;
      for (let round = 1; round <= rounds; round++) {
        expect(isOk(await send(w.db, w.alice, requestId, doc.documentId))).toBe(true);
        if (round < rounds) expect(isOk(await sendBack(w, requestId, `round ${round}`))).toBe(true);
      }
      const batch = await listRequestHistoriesForOwner(await ownerProof(w.db, w.alice), {
        requestIds: [requestId],
      });
      if (!isOk(batch)) throw new Error('read');
      const history = batch.value.get(requestId);
      expect(history?.sends.submissions).toHaveLength(REQUEST_HISTORY_SENDS_SHOWN);
      expect(history?.olderSends).toBe(2);
      // The newest are kept: the last round is the one still waiting.
      expect(history?.sends.submissions.at(-1)).toMatchObject({
        roundNo: rounds,
        state: 'AWAITING_DECISION',
      });
      expect(history?.decisions.length).toBeLessThanOrEqual(REQUEST_HISTORY_SENDS_SHOWN);
    },
    TIMEOUT,
  );
});
