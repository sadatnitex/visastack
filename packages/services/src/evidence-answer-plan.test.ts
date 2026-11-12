import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { decideEvidenceResponse, requestEvidence } from './agency';
import type { Db } from './db';
import {
  type AnswerItem,
  type EvidenceAnswerPlan,
  confirmEvidenceAnswers,
  listWaitingAgencies,
  planEvidenceAnswers,
  readEvidenceAnswerReceipt,
} from './evidence-answer-plan';
import {
  type Agency,
  type StoredDocument,
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
  traveller,
} from './evidence-submissions.test-support';
import { revokeGrant } from './sharing';
import { supersedeDocument } from './wallet';

/**
 * Answer From Your Records, against the real services on a migrated in-memory database. The
 * persona is synthetic: one traveller, a first agency that already accepted copies, and a second,
 * unrelated agency that asks afterwards.
 */

const TIMEOUT = 60_000;
const DAY = 24 * 60 * 60 * 1000;

/** 24 characters of the URL-safe base64 alphabet, as the page makes them. */
let keyCounter = 0;
function confirmationKey(): string {
  keyCounter += 1;
  return `key-${String(keyCounter).padStart(4, '0')}-abcdefghijklmno`.slice(0, 24);
}

interface World {
  readonly db: Db;
  readonly rahim: Traveller;
  readonly north: Agency;
  readonly unrelated: Agency;
  readonly northGrant: string;
  readonly unrelatedGrant: string;
}

async function world(): Promise<World> {
  const db = await freshDb();
  const rahim = await traveller(db, 'test-rahim-synthetic@example.test');
  const north = await agency(db, 'north-admin@example.test', 'TEST Agency North');
  const unrelated = await agency(db, 'unrelated-admin@example.test', 'TEST Agency Unrelated');
  const northGrant = await share(db, rahim, north);
  const unrelatedGrant = await share(db, rahim, unrelated);
  return { db, rahim, north, unrelated, northGrant, unrelatedGrant };
}

async function plan(w: World, now?: Date): Promise<EvidenceAnswerPlan> {
  const result = await planEvidenceAnswers(await ownerProof(w.db, w.rahim), now ? { now } : {});
  if (!isOk(result)) throw new Error('plan');
  return result.value;
}

function itemOf(p: EvidenceAnswerPlan, a: Agency, requestId: string): AnswerItem {
  const item = p.agencies
    .find((group) => group.organizationId === a.organizationId)
    ?.items.find((candidate) => candidate.requestId === requestId);
  if (!item) throw new Error('item not in plan');
  return item;
}

async function confirm(
  w: World,
  a: Agency,
  key: string,
  answers: readonly { requestId: string; doc: Pick<StoredDocument, 'documentId' | 'versionId'> }[],
) {
  return confirmEvidenceAnswers(await ownerProof(w.db, w.rahim), {
    organizationId: a.organizationId,
    confirmationKey: key,
    answers: answers.map((answer) => ({
      requestId: answer.requestId,
      documentId: answer.doc.documentId,
      documentVersionId: answer.doc.versionId,
    })),
  });
}

async function submissionCount(db: Db): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.evidenceRequestSubmissions);
  return Number(rows[0]?.n ?? 0);
}

async function setExpiry(db: Db, documentId: string, date: Date | null): Promise<void> {
  await db
    .update(schema.documents)
    .set({ expiresAt: date })
    .where(eq(schema.documents.id, documentId));
}

async function accept(w: World, a: Agency, requestId: string) {
  const decided = await decideEvidenceResponse(w.db, {
    actorAccountId: a.accountId,
    requestId,
    outcome: 'ACCEPTED',
  });
  if (!isOk(decided)) throw new Error(`accept: ${decided.error.message}`);
}

async function sendBack(w: World, a: Agency, requestId: string) {
  const decided = await decideEvidenceResponse(w.db, {
    actorAccountId: a.accountId,
    requestId,
    outcome: 'NEEDS_REPLACEMENT',
    reason: 'too blurry',
  });
  if (!isOk(decided)) throw new Error(`send back: ${decided.error.message}`);
}

describe('planEvidenceAnswers: what is held for each waiting request', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, TIMEOUT);

  it(
    'names the asking agency and sorts each request into ready, choose, outdated, missing and own step',
    async () => {
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      await setExpiry(w.db, passport.documentId, new Date(Date.now() + 900 * DAY));
      await cleanDocument(w.db, w.rahim, 'photo', 'TEST photo A.jpg', 'b'.repeat(64));
      await cleanDocument(w.db, w.rahim, 'photo', 'TEST photo B.jpg', 'c'.repeat(64));
      const card = await cleanDocument(w.db, w.rahim, 'national_id', 'TEST national id.pdf');
      await setExpiry(w.db, card.documentId, new Date(Date.now() - 400 * DAY));

      const forPassport = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      const forPhoto = await openRequest(w.db, w.unrelated, w.rahim, 'photo');
      const forCard = await openRequest(w.db, w.unrelated, w.rahim, 'national_id');
      const forLetter = await openRequest(w.db, w.unrelated, w.rahim, 'employment_letter');
      const detail = await requestEvidence(w.db, {
        actorAccountId: w.unrelated.accountId,
        organizationId: w.unrelated.organizationId,
        applicantId: w.rahim.applicantId,
        kind: 'FIELD',
        fieldKey: 'passport.number',
      });
      if (!isOk(detail)) throw new Error('detail request');

      const p = await plan(w);
      expect(p.available).toBe(true);
      expect(p.agencies).toHaveLength(1);
      const group = p.agencies[0];
      expect(group?.organizationName).toBe('TEST Agency Unrelated');
      expect(group?.canReceive).toBe(true);

      const ready = itemOf(p, w.unrelated, forPassport);
      expect(ready.readiness).toBe('READY');
      expect(ready.copies).toHaveLength(1);
      expect(ready.copies[0]).toMatchObject({
        documentId: passport.documentId,
        versionId: passport.versionId,
        versionNumber: 1,
        name: 'TEST passport.pdf',
        state: 'OK',
        sendable: true,
        acceptedBefore: null,
      });
      expect(itemOf(p, w.unrelated, forPhoto).readiness).toBe('CHOOSE');
      expect(itemOf(p, w.unrelated, forPhoto).copies.map((copy) => copy.name)).toEqual([
        'TEST photo B.jpg',
        'TEST photo A.jpg',
      ]);
      const outdated = itemOf(p, w.unrelated, forCard);
      expect(outdated.readiness).toBe('OUTDATED');
      expect(outdated.copies[0]).toMatchObject({ state: 'EXPIRED', sendable: false });
      expect(itemOf(p, w.unrelated, forLetter)).toMatchObject({ readiness: 'MISSING', copies: [] });
      expect(itemOf(p, w.unrelated, detail.value.id)).toMatchObject({
        readiness: 'OWN_STEP',
        kind: 'FIELD',
        copies: [],
      });
      // Reading the plan shares nothing.
      expect(await submissionCount(w.db)).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'shows the traveller that an exact copy was accepted before, by which agency',
    async () => {
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const first = await openRequest(w.db, w.north, w.rahim, 'passport');
      expect(isOk(await send(w.db, w.rahim, first, passport.documentId))).toBe(true);
      await accept(w, w.north, first);

      const second = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      const copy = itemOf(await plan(w), w.unrelated, second).copies[0];
      expect(copy?.acceptedBefore).toMatchObject({ times: 1, lastByAgency: 'TEST Agency North' });

      // A newer upload is a different exact copy: nobody accepted that one.
      await addVersion(w.db, w.rahim, passport.documentId, { sha256: 'd'.repeat(64) });
      const after = itemOf(await plan(w), w.unrelated, second).copies[0];
      expect(after?.versionNumber).toBe(2);
      expect(after?.acceptedBefore).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'uses the checklist item rule only: too old is outdated, an unknown date is never ready',
    async () => {
      const statement = await cleanDocument(w.db, w.rahim, 'bank_statement', 'TEST statement.pdf');
      const requestId = await openRequest(w.db, w.unrelated, w.rahim, 'bank_statement');
      // No checklist item: no age rule is invented.
      expect(itemOf(await plan(w), w.unrelated, requestId)).toMatchObject({
        readiness: 'READY',
        rule: null,
      });

      const [pack] = await w.db
        .insert(schema.packs)
        .values({ key: 'test.answer-plan', name: 'TEST pack', purpose: 'tourism' })
        .returning({ id: schema.packs.id });
      const [version] = await w.db
        .insert(schema.packVersions)
        .values({ packId: pack?.id ?? '', version: 1, status: 'PUBLISHED' })
        .returning({ id: schema.packVersions.id });
      const [requirement] = await w.db
        .insert(schema.packRequirements)
        .values({
          packVersionId: version?.id ?? '',
          kind: 'DOCUMENT',
          docType: 'bank_statement',
          citation: 'TEST citation',
          maxAgeDays: 90,
        })
        .returning({ id: schema.packRequirements.id });
      await w.db
        .update(schema.evidenceRequests)
        .set({ packRequirementId: requirement?.id ?? null })
        .where(eq(schema.evidenceRequests.id, requestId));

      // A rule and no date on the document: sendable only after the person checks it.
      const unknown = itemOf(await plan(w), w.unrelated, requestId);
      expect(unknown.rule).toEqual({ maxAgeDays: 90, optional: false });
      expect(unknown.readiness).toBe('CHECK_DATE');
      expect(unknown.copies[0]).toMatchObject({ state: 'DATE_UNCERTAIN', sendable: true });

      const day = (offset: number) =>
        new Date(Date.now() - offset * DAY).toISOString().slice(0, 10);
      await w.db
        .update(schema.documents)
        .set({ documentDate: day(20) })
        .where(eq(schema.documents.id, statement.documentId));
      expect(itemOf(await plan(w), w.unrelated, requestId)).toMatchObject({ readiness: 'READY' });

      await w.db
        .update(schema.documents)
        .set({ documentDate: day(200) })
        .where(eq(schema.documents.id, statement.documentId));
      const old = itemOf(await plan(w), w.unrelated, requestId);
      expect(old.readiness).toBe('OUTDATED');
      expect(old.copies[0]).toMatchObject({ state: 'TOO_OLD', sendable: false });
      // Counted in whole days from the document's own date, rounded up as the readiness rule does.
      expect(old.copies[0]?.ageDays).toBeGreaterThanOrEqual(200);
    },
    TIMEOUT,
  );

  it(
    'never ticks in advance a copy whose saved dates disagree, and a newly agreed date clears it',
    async () => {
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const readDay = new Date(Date.now() + 700 * DAY);
      await setExpiry(w.db, passport.documentId, readDay);
      const requestId = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      expect(itemOf(await plan(w), w.unrelated, requestId).readiness).toBe('READY');

      // The person typed a different day from the one read off the passport: both are kept, and
      // the record now disagrees with itself.
      const typedDay = new Date(Date.now() + 300 * DAY).toISOString().slice(0, 10);
      await w.db.insert(schema.documentExpiryEntries).values({
        documentId: passport.documentId,
        expiresOn: typedDay,
        source: 'TYPED',
        mirrored: false,
        enteredByAccountId: w.rahim.accountId,
      });
      const unsure = itemOf(await plan(w), w.unrelated, requestId);
      expect(unsure.readiness).toBe('CHECK_DATE');
      expect(unsure.copies[0]).toMatchObject({ state: 'DATE_UNCERTAIN', sendable: true });

      // Typing the day that was read settles it.
      await w.db.insert(schema.documentExpiryEntries).values({
        documentId: passport.documentId,
        expiresOn: readDay.toISOString().slice(0, 10),
        source: 'TYPED',
        mirrored: false,
        enteredByAccountId: w.rahim.accountId,
      });
      expect(itemOf(await plan(w), w.unrelated, requestId).readiness).toBe('READY');
    },
    TIMEOUT,
  );

  it(
    'leaves out replaced documents, holds back unchecked files and the copy that was sent back',
    async () => {
      const old = await cleanDocument(w.db, w.rahim, 'passport', 'TEST old passport.pdf');
      const current = await cleanDocument(w.db, w.rahim, 'passport', 'TEST new passport.pdf');
      const replaced = await supersedeDocument(w.db, {
        actorAccountId: w.rahim.accountId,
        oldDocumentId: old.documentId,
        newDocumentId: current.documentId,
      });
      expect(isOk(replaced)).toBe(true);
      const requestId = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      const item = itemOf(await plan(w), w.unrelated, requestId);
      expect(item.readiness).toBe('READY');
      expect(item.copies.map((copy) => copy.documentId)).toEqual([current.documentId]);

      // A newer version that is still in quarantine is not a copy that can go.
      await addVersion(w.db, w.rahim, current.documentId, { safetyStatus: 'QUARANTINED' });
      expect(itemOf(await plan(w), w.unrelated, requestId)).toMatchObject({
        readiness: 'NOT_CHECKED',
      });

      // The copy an agency sent back is held back; a clearer upload is a new copy.
      const letter = await cleanDocument(w.db, w.rahim, 'employment_letter', 'TEST letter.pdf');
      const forLetter = await openRequest(w.db, w.unrelated, w.rahim, 'employment_letter');
      expect(isOk(await send(w.db, w.rahim, forLetter, letter.documentId))).toBe(true);
      await sendBack(w, w.unrelated, forLetter);
      const back = itemOf(await plan(w), w.unrelated, forLetter);
      expect(back.readiness).toBe('NEEDS_NEW_COPY');
      expect(back.copies[0]).toMatchObject({ state: 'SENT_BACK', sendable: false });
      const clearer = await addVersion(w.db, w.rahim, letter.documentId, {
        sha256: 'e'.repeat(64),
      });
      const again = itemOf(await plan(w), w.unrelated, forLetter);
      expect(again.readiness).toBe('READY');
      expect(again.copies[0]?.versionId).toBe(clearer.versionId);
    },
    TIMEOUT,
  );

  it(
    'says an agency whose access ended can receive nothing, and counts who is waiting',
    async () => {
      await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const requestId = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      await openRequest(w.db, w.north, w.rahim, 'passport');
      const proof = await ownerProof(w.db, w.rahim);
      const waiting = await listWaitingAgencies(proof);
      if (!isOk(waiting)) throw new Error('waiting');
      expect(
        [...waiting.value].sort((a, b) => a.organizationName.localeCompare(b.organizationName)),
      ).toEqual([
        {
          organizationId: w.north.organizationId,
          organizationName: 'TEST Agency North',
          waiting: 1,
          documents: 1,
        },
        {
          organizationId: w.unrelated.organizationId,
          organizationName: 'TEST Agency Unrelated',
          waiting: 1,
          documents: 1,
        },
      ]);

      const revoked = await revokeGrant(w.db, {
        actorAccountId: w.rahim.accountId,
        grantId: w.unrelatedGrant,
      });
      expect(isOk(revoked)).toBe(true);
      const p = await plan(w);
      const group = p.agencies.find((g) => g.organizationId === w.unrelated.organizationId);
      expect(group?.canReceive).toBe(false);
      expect(itemOf(p, w.unrelated, requestId)).toMatchObject({
        readiness: 'NO_ACCESS',
        copies: [],
      });
    },
    TIMEOUT,
  );
});

describe('who may read or confirm: the owner only, and denied looks like missing', () => {
  it(
    'refuses an agency member holding a genuine proof exactly as it refuses a stranger',
    async () => {
      const w = await world();
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const requestId = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      // TEST Agency North holds a live grant: its proof is genuine, and it is still not the owner.
      const northProof = await agencyProof(w.db, w.north, w.rahim.applicantId);
      const expected = { code: 'not_found', message: 'evidence requests not found' };

      const planned = await planEvidenceAnswers(northProof);
      expect(planned.ok ? null : planned.error).toMatchObject(expected);
      const waiting = await listWaitingAgencies(northProof);
      expect(waiting.ok ? null : waiting.error).toMatchObject(expected);
      const confirmed = await confirmEvidenceAnswers(northProof, {
        organizationId: w.unrelated.organizationId,
        confirmationKey: confirmationKey(),
        answers: [
          { requestId, documentId: passport.documentId, documentVersionId: passport.versionId },
        ],
      });
      expect(confirmed.ok ? null : confirmed.error).toMatchObject(expected);
      const receipt = await readEvidenceAnswerReceipt(northProof, {
        organizationId: w.unrelated.organizationId,
        confirmationKey: confirmationKey(),
      });
      expect(receipt.ok ? null : receipt.error).toMatchObject(expected);
      expect(await submissionCount(w.db)).toBe(0);
    },
    TIMEOUT,
  );
});

describe('confirmEvidenceAnswers: one explicit confirmation to one named agency', () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
  }, TIMEOUT);

  it(
    'sends exactly the reviewed copies, pins them, and a repeat sends nothing twice',
    async () => {
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const statement = await cleanDocument(w.db, w.rahim, 'bank_statement', 'TEST statement.pdf');
      const forPassport = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      const forStatement = await openRequest(w.db, w.unrelated, w.rahim, 'bank_statement');
      const key = confirmationKey();
      const answers = [
        { requestId: forPassport, doc: passport },
        { requestId: forStatement, doc: statement },
      ];

      const first = await confirm(w, w.unrelated, key, answers);
      if (!isOk(first)) throw new Error(first.error.message);
      expect(first.value).toMatchObject({
        organizationName: 'TEST Agency Unrelated',
        sent: 2,
        alreadySent: 0,
        changed: 0,
      });
      expect(first.value.outcomes.map((o) => o.outcome)).toEqual(['SENT', 'SENT']);
      expect(await submissionCount(w.db)).toBe(2);
      const rows = await w.db.select().from(schema.evidenceRequestSubmissions);
      expect(rows.map((row) => row.documentVersionId).sort()).toEqual(
        [passport.versionId, statement.versionId].sort(),
      );

      // The same confirmation again: nothing new, and it says so truthfully.
      const again = await confirm(w, w.unrelated, key, answers);
      if (!isOk(again)) throw new Error(again.error.message);
      expect(again.value).toMatchObject({ sent: 0, alreadySent: 2, changed: 0 });
      expect(await submissionCount(w.db)).toBe(2);

      // Even after the agency has decided, the repeat still says it was sent, never "not sent".
      await accept(w, w.unrelated, forPassport);
      const later = await confirm(w, w.unrelated, key, answers);
      if (!isOk(later)) throw new Error(later.error.message);
      expect(later.value.outcomes.map((o) => o.outcome)).toEqual(['ALREADY_SENT', 'ALREADY_SENT']);
      expect(await submissionCount(w.db)).toBe(2);

      // The receipt is read from the saved, unchanged rows.
      const receipt = await readEvidenceAnswerReceipt(await ownerProof(w.db, w.rahim), {
        organizationId: w.unrelated.organizationId,
        confirmationKey: key,
      });
      if (!isOk(receipt)) throw new Error('receipt');
      expect(receipt.value.organizationName).toBe('TEST Agency Unrelated');
      expect(
        receipt.value.lines.map((line) => [line.title, line.versionNumber, line.state]),
      ).toEqual([
        ['TEST passport.pdf', 1, 'ACCEPTED'],
        ['TEST statement.pdf', 1, 'WAITING_FOR_REVIEW'],
      ]);
      expect(receipt.value.lines[0]?.checksumFingerprint).toBe('a'.repeat(12));
    },
    TIMEOUT,
  );

  it(
    'two confirmations racing with the same key send each copy once',
    async () => {
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const requestId = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      const key = confirmationKey();
      const [one, two] = await Promise.all([
        confirm(w, w.unrelated, key, [{ requestId, doc: passport }]),
        confirm(w, w.unrelated, key, [{ requestId, doc: passport }]),
      ]);
      if (!isOk(one) || !isOk(two)) throw new Error('race');
      expect([one.value.outcomes[0]?.outcome, two.value.outcomes[0]?.outcome].sort()).toEqual([
        'ALREADY_SENT',
        'SENT',
      ]);
      expect(await submissionCount(w.db)).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'never sends a copy the person did not review: a newer upload after the review changes the answer',
    async () => {
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const requestId = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      const reviewed = itemOf(await plan(w), w.unrelated, requestId).copies[0];
      if (!reviewed) throw new Error('copy');
      // Between the review and the press, a newer version arrives.
      const newer = await addVersion(w.db, w.rahim, passport.documentId, {
        sha256: 'f'.repeat(64),
      });

      const stale = await confirm(w, w.unrelated, confirmationKey(), [
        { requestId, doc: { documentId: reviewed.documentId, versionId: reviewed.versionId } },
      ]);
      if (!isOk(stale)) throw new Error(stale.error.message);
      expect(stale.value).toMatchObject({ sent: 0, changed: 1 });
      expect(await submissionCount(w.db)).toBe(0);

      // Reviewed again, the newer copy goes, and it is the newer version that is pinned.
      const fresh = await confirm(w, w.unrelated, confirmationKey(), [
        { requestId, doc: { documentId: passport.documentId, versionId: newer.versionId } },
      ]);
      if (!isOk(fresh)) throw new Error(fresh.error.message);
      expect(fresh.value.sent).toBe(1);
      const rows = await w.db.select().from(schema.evidenceRequestSubmissions);
      expect(rows.map((row) => row.documentVersionId)).toEqual([newer.versionId]);
    },
    TIMEOUT,
  );

  it(
    'sends nothing that is expired, replaced, sent back, of another kind, or not safe',
    async () => {
      const card = await cleanDocument(w.db, w.rahim, 'national_id', 'TEST national id.pdf');
      await setExpiry(w.db, card.documentId, new Date(Date.now() - 2 * DAY));
      const forCard = await openRequest(w.db, w.unrelated, w.rahim, 'national_id');
      const statement = await cleanDocument(w.db, w.rahim, 'bank_statement', 'TEST statement.pdf');
      const old = await cleanDocument(w.db, w.rahim, 'passport', 'TEST old passport.pdf');
      const current = await cleanDocument(w.db, w.rahim, 'passport', 'TEST new passport.pdf');
      await supersedeDocument(w.db, {
        actorAccountId: w.rahim.accountId,
        oldDocumentId: old.documentId,
        newDocumentId: current.documentId,
      });
      const forPassport = await openRequest(w.db, w.unrelated, w.rahim, 'passport');

      const refused = await confirm(w, w.unrelated, confirmationKey(), [
        { requestId: forCard, doc: card },
        { requestId: forPassport, doc: old },
      ]);
      if (!isOk(refused)) throw new Error(refused.error.message);
      expect(refused.value.outcomes.map((o) => o.outcome)).toEqual(['CHANGED', 'CHANGED']);

      // A statement cannot answer a passport request.
      const wrongKind = await confirm(w, w.unrelated, confirmationKey(), [
        { requestId: forPassport, doc: statement },
      ]);
      if (!isOk(wrongKind)) throw new Error(wrongKind.error.message);
      expect(wrongKind.value.changed).toBe(1);
      expect(await submissionCount(w.db)).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'sends nothing to any agency but the one named, and tells every refusal the same way',
    async () => {
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const northRequest = await openRequest(w.db, w.north, w.rahim, 'passport');
      const other = await traveller(w.db, 'test-other-synthetic@example.test');
      await share(w.db, other, w.unrelated);
      const othersDocument = await cleanDocument(w.db, other, 'passport', 'TEST other.pdf');
      const othersRequest = await openRequest(w.db, w.unrelated, other, 'passport');
      const missing = '00000000-0000-4000-8000-000000000000';

      const result = await confirm(w, w.unrelated, confirmationKey(), [
        // North's request, confirmed under Unrelated's name.
        { requestId: northRequest, doc: passport },
        // Another traveller's request and document.
        { requestId: othersRequest, doc: othersDocument },
        // A request that does not exist.
        { requestId: missing, doc: passport },
      ]);
      if (!isOk(result)) throw new Error(result.error.message);
      expect(result.value.outcomes).toEqual([
        { requestId: northRequest, outcome: 'CHANGED' },
        { requestId: othersRequest, outcome: 'CHANGED' },
        { requestId: missing, outcome: 'CHANGED' },
      ]);
      expect(await submissionCount(w.db)).toBe(0);

      // An agency id that is not a real agency, and one that is malformed, change nothing either.
      for (const organizationId of [missing, 'not-an-id']) {
        const none = await confirmEvidenceAnswers(await ownerProof(w.db, w.rahim), {
          organizationId,
          confirmationKey: confirmationKey(),
          answers: [
            {
              requestId: northRequest,
              documentId: passport.documentId,
              documentVersionId: passport.versionId,
            },
          ],
        });
        if (!isOk(none)) throw new Error(none.error.message);
        expect(none.value).toMatchObject({ sent: 0, changed: 1, organizationName: '' });
      }
      expect(await submissionCount(w.db)).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'sends nothing once the share has ended, even for a copy reviewed while it was live',
    async () => {
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const requestId = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      expect(itemOf(await plan(w), w.unrelated, requestId).readiness).toBe('READY');
      await revokeGrant(w.db, { actorAccountId: w.rahim.accountId, grantId: w.unrelatedGrant });
      const result = await confirm(w, w.unrelated, confirmationKey(), [
        { requestId, doc: passport },
      ]);
      if (!isOk(result)) throw new Error(result.error.message);
      expect(result.value).toMatchObject({ sent: 0, changed: 1 });
      expect(await submissionCount(w.db)).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'a partial result is honest: what could go went, what changed did not',
    async () => {
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const statement = await cleanDocument(w.db, w.rahim, 'bank_statement', 'TEST statement.pdf');
      const forPassport = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      const forStatement = await openRequest(w.db, w.unrelated, w.rahim, 'bank_statement');
      // The statement request is answered from its own page first.
      expect(isOk(await send(w.db, w.rahim, forStatement, statement.documentId))).toBe(true);

      const key = confirmationKey();
      const result = await confirm(w, w.unrelated, key, [
        { requestId: forPassport, doc: passport },
        { requestId: forStatement, doc: statement },
      ]);
      if (!isOk(result)) throw new Error(result.error.message);
      expect(result.value.outcomes.map((o) => o.outcome)).toEqual(['SENT', 'CHANGED']);
      expect(await submissionCount(w.db)).toBe(2);
      const receipt = await readEvidenceAnswerReceipt(await ownerProof(w.db, w.rahim), {
        organizationId: w.unrelated.organizationId,
        confirmationKey: key,
      });
      if (!isOk(receipt)) throw new Error('receipt');
      // Only what this confirmation sent is on its receipt.
      expect(receipt.value.lines.map((line) => line.title)).toEqual(['TEST passport.pdf']);
    },
    TIMEOUT,
  );

  it(
    'refuses malformed input before reading anything',
    async () => {
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const requestId = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      const proof = await ownerProof(w.db, w.rahim);
      const answer = {
        requestId,
        documentId: passport.documentId,
        documentVersionId: passport.versionId,
      };
      const base = { organizationId: w.unrelated.organizationId, answers: [answer] };
      for (const badKey of ['short', `${'k'.repeat(24)}x`, `${'k'.repeat(23)}%`]) {
        const result = await confirmEvidenceAnswers(proof, { ...base, confirmationKey: badKey });
        expect(result.ok ? null : result.error.code).toBe('invalid');
      }
      const empty = await confirmEvidenceAnswers(proof, {
        ...base,
        confirmationKey: confirmationKey(),
        answers: [],
      });
      expect(empty.ok ? null : empty.error.code).toBe('invalid');
      const twice = await confirmEvidenceAnswers(proof, {
        ...base,
        confirmationKey: confirmationKey(),
        answers: [answer, answer],
      });
      expect(twice.ok ? null : twice.error.code).toBe('invalid');
      const tooMany = await confirmEvidenceAnswers(proof, {
        ...base,
        confirmationKey: confirmationKey(),
        answers: Array.from({ length: 26 }, (_, index) => ({
          ...answer,
          requestId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        })),
      });
      expect(tooMany.ok ? null : tooMany.error.code).toBe('invalid');
      expect(await submissionCount(w.db)).toBe(0);
    },
    TIMEOUT,
  );
});

describe('readEvidenceAnswerReceipt: nothing to guess', () => {
  it(
    'gives the same empty receipt for an unknown key, another agency and another traveller',
    async () => {
      const w = await world();
      const passport = await cleanDocument(w.db, w.rahim, 'passport', 'TEST passport.pdf');
      const requestId = await openRequest(w.db, w.unrelated, w.rahim, 'passport');
      const key = confirmationKey();
      const sent = await confirm(w, w.unrelated, key, [{ requestId, doc: passport }]);
      expect(isOk(sent) && sent.value.sent).toBe(1);

      const proof = await ownerProof(w.db, w.rahim);
      const read = async (organizationId: string, confirmation: string) => {
        const receipt = await readEvidenceAnswerReceipt(proof, {
          organizationId,
          confirmationKey: confirmation,
        });
        if (!isOk(receipt)) throw new Error('receipt');
        return receipt.value;
      };
      expect((await read(w.unrelated.organizationId, key)).lines).toHaveLength(1);
      // The right key under another agency's name, and a wrong key, both read as nothing.
      expect(await read(w.north.organizationId, key)).toEqual({
        organizationId: w.north.organizationId,
        organizationName: '',
        lines: [],
      });
      expect((await read(w.unrelated.organizationId, confirmationKey())).lines).toEqual([]);
      expect((await read(w.unrelated.organizationId, 'not a key')).lines).toEqual([]);

      // Another traveller holding the key reads nothing of it.
      const other = await traveller(w.db, 'test-other-synthetic@example.test');
      const theirs = await readEvidenceAnswerReceipt(await ownerProof(w.db, other), {
        organizationId: w.unrelated.organizationId,
        confirmationKey: key,
      });
      expect(isOk(theirs) && theirs.value.lines).toEqual([]);
    },
    TIMEOUT,
  );
});
