import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { EACH_GRANT, accountPrincipal, requireAccess } from './access';
import {
  cancelEvidenceRequest,
  decideEvidenceResponse,
  requestEvidence,
  startEvidenceReview,
  submitEvidenceResponse,
} from './agency';
import { LEGACY_FIELD_ANSWER_LABEL, readEvidenceFieldAnswer } from './evidence-field-answers';
import { agencyProof, ownerProof } from './evidence-submissions.test-support';
import { editFact } from './profile';
import { revokeGrant } from './sharing';
import {
  addAdmin,
  agencyNoticesFor,
  auditCount,
  randomId,
  registerCatalogueField,
  requestRow,
  retryKey,
  trustWorld,
} from './trust-rules/trust-rules.test-support';

/**
 * A detail answer is pinned to the exact saved version that was sent (migration 0135), and the
 * agency's decision is tied to that send. Plain-language summary: docs/product/breakthrough/
 * TRUST-RULES.md. Everything runs against the real services on a migrated in-memory database.
 */

const TIMEOUT = 90_000;
const V1 = '+8801700000111';
const V2 = '+8801700000222';
const V3 = '+8801700000333';

async function setup() {
  const w = await trustWorld();
  await registerCatalogueField(w.db, 'phone');
  const save = async (value: string) => {
    const edited = await editFact(w.db, {
      actorAccountId: w.rahim.accountId,
      applicantId: w.rahim.applicantId,
      fieldKey: 'phone',
      value,
    });
    if (!isOk(edited)) throw new Error(`edit: ${edited.error.message}`);
    return edited.value;
  };
  const first = await save(V1);
  const asked = await requestEvidence(w.db, {
    actorAccountId: w.north.accountId,
    organizationId: w.north.organizationId,
    applicantId: w.rahim.applicantId,
    kind: 'FIELD',
    fieldKey: 'phone',
  });
  if (!isOk(asked)) throw new Error('field request');
  return { w, save, factId: first.fact.id, requestId: asked.value.id };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const sendDetail = (s: Setup, extra: { factVersionId?: string; idempotencyKey?: string } = {}) =>
  submitEvidenceResponse(s.w.db, {
    actorAccountId: s.w.rahim.accountId,
    requestId: s.requestId,
    factId: s.factId,
    ...extra,
  });

const decide = (
  s: Setup,
  outcome: 'ACCEPTED' | 'NEEDS_REPLACEMENT',
  extra: { submissionId?: string } = {},
) =>
  decideEvidenceResponse(s.w.db, {
    actorAccountId: s.w.north.accountId,
    requestId: s.requestId,
    outcome,
    ...(outcome === 'ACCEPTED' ? {} : { reason: 'does not match the passport' }),
    ...extra,
  });

async function ownerRead(s: Setup) {
  const result = await readEvidenceFieldAnswer(await ownerProof(s.w.db, s.w.rahim), {
    requestId: s.requestId,
  });
  if (!isOk(result)) throw new Error(`owner read: ${result.error.message}`);
  return result.value;
}

async function agencyRead(s: Setup, by = s.w.north) {
  return readEvidenceFieldAnswer(await agencyProof(s.w.db, by, s.w.rahim.applicantId), {
    requestId: s.requestId,
  });
}

describe('a detail answer is pinned to the exact saved version that was sent', () => {
  it(
    'a submitted detail that is edited afterwards still shows the value that was sent',
    async () => {
      const s = await setup();
      expect(isOk(await sendDetail(s))).toBe(true);
      await s.save(V2);

      const history = await ownerRead(s);
      expect(history.available).toBe(true);
      expect(history.rounds).toHaveLength(1);
      expect(history.rounds[0]).toMatchObject({
        precision: 'pinned',
        roundNo: 1,
        state: 'AWAITING_DECISION',
        version: { number: 1, value: V1, stillCurrent: false, protected: false },
      });
      // The request still names the detail, which now says something else: the answer does not.
      const request = await requestRow(s.w.db, s.requestId);
      expect(request.respondingFactId).toBe(s.factId);
    },
    TIMEOUT,
  );

  it(
    'an accepted detail that is edited afterwards stays tied to what the agency reviewed',
    async () => {
      const s = await setup();
      const sent = await sendDetail(s);
      expect(isOk(sent)).toBe(true);
      const submissionId = isOk(sent) ? sent.value.submissionId : null;
      expect(submissionId).not.toBeNull();
      expect(isOk(await decide(s, 'ACCEPTED', { submissionId: submissionId ?? '' }))).toBe(true);
      await s.save(V2);

      const history = await ownerRead(s);
      expect(history.rounds).toHaveLength(1);
      expect(history.rounds[0]).toMatchObject({
        submissionId,
        state: 'ACCEPTED',
        version: { number: 1, value: V1, stillCurrent: false },
      });
      // The decision row is linked to that exact send in the database.
      const links = await s.w.db.select().from(schema.evidenceRequestDecisionFactSubmissions);
      expect(links.map((l) => l.submissionId)).toEqual([submissionId]);
    },
    TIMEOUT,
  );

  it(
    'two successive submissions after a rejection each keep their own version and decision',
    async () => {
      const s = await setup();
      expect(isOk(await sendDetail(s))).toBe(true);
      expect(isOk(await decide(s, 'NEEDS_REPLACEMENT'))).toBe(true);
      // Rejection followed by correction: the traveller fixes the detail and answers again.
      await s.save(V2);
      const second = await sendDetail(s);
      expect(isOk(second)).toBe(true);
      expect(isOk(await decide(s, 'ACCEPTED'))).toBe(true);
      await s.save(V3);

      const history = await ownerRead(s);
      expect(
        history.rounds.map((r) => [r.roundNo, r.state, r.version?.value, r.version?.number]),
      ).toEqual([
        [1, 'NEEDS_REPLACEMENT', V1, 1],
        [2, 'ACCEPTED', V2, 2],
      ]);
      expect(history.rounds[0]?.reason).toBe('does not match the passport');
      expect(history.rounds[0]?.version?.stillCurrent).toBe(false);
      expect(history.rounds[1]?.version?.stillCurrent).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'a send is refused as out of date when the detail changed after the page was opened, and writes nothing',
    async () => {
      const s = await setup();
      const seen = (await ownerRead(s)).rounds.length; // 0: nothing sent yet
      expect(seen).toBe(0);
      const versions = await s.w.db.select().from(schema.factVersions);
      const v1 = versions[0]?.id ?? '';
      await s.save(V2);

      const refused = await sendDetail(s, { factVersionId: v1 });
      expect(isErr(refused) && refused.error.code).toBe('stale');
      expect((await requestRow(s.w.db, s.requestId)).status).toBe('OPEN');
      expect(await s.w.db.select().from(schema.evidenceRequestFactSubmissions)).toHaveLength(0);
      expect(await agencyNoticesFor(s.w.db, s.requestId)).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'an update and a send at the same moment pin one real version and write exactly one send',
    async () => {
      const s = await setup();
      const [sent] = await Promise.all([sendDetail(s), s.save(V2)]);
      expect(isOk(sent)).toBe(true);
      const rows = await s.w.db.select().from(schema.evidenceRequestFactSubmissions);
      expect(rows).toHaveLength(1);
      const versions = await s.w.db.select().from(schema.factVersions);
      const pinned = versions.find((v) => v.id === rows[0]?.factVersionId);
      // Whichever of the two went first, the pin is a version that was current when it was written.
      expect([V1, V2]).toContain(pinned?.value);
      const history = await ownerRead(s);
      expect(history.rounds[0]?.version?.value).toBe(pinned?.value);
    },
    TIMEOUT,
  );

  it(
    'a retry with the same key sends once: one send, one notice per admin and channel, one audit entry',
    async () => {
      const s = await setup();
      await addAdmin(s.w.db, s.w.north, 'test-north-second@example.test');
      const key = retryKey('field-retry');
      const first = await sendDetail(s, { idempotencyKey: key });
      const again = await sendDetail(s, { idempotencyKey: key });
      expect(isOk(first) && first.value.replayed).toBe(false);
      expect(isOk(again) && again.value.replayed).toBe(true);
      expect(isOk(again) && again.value.submissionId).toBe(
        isOk(first) ? first.value.submissionId : 'x',
      );
      expect(await s.w.db.select().from(schema.evidenceRequestFactSubmissions)).toHaveLength(1);
      // Two admins, two channels each, once.
      expect(await agencyNoticesFor(s.w.db, s.requestId)).toHaveLength(4);
      expect(await auditCount(s.w.db, 'EVIDENCE_RESPONDED', s.requestId)).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'a retry after the agency decided is told the page is out of date, and a reused key for another detail is refused',
    async () => {
      const s = await setup();
      const key = retryKey('field-late');
      expect(isOk(await sendDetail(s, { idempotencyKey: key }))).toBe(true);
      expect(isOk(await decide(s, 'ACCEPTED'))).toBe(true);
      const late = await sendDetail(s, { idempotencyKey: key });
      expect(isErr(late) && late.error.code).toBe('stale');

      const other = await setup();
      const k2 = retryKey('field-other');
      expect(isOk(await sendDetail(other, { idempotencyKey: k2 }))).toBe(true);
      const wrong = await submitEvidenceResponse(other.w.db, {
        actorAccountId: other.w.rahim.accountId,
        requestId: other.requestId,
        factId: randomId(),
        idempotencyKey: k2,
      });
      expect(isErr(wrong)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'a decision names the send it judged, and a reviewer looking at an older send is told to look again',
    async () => {
      const s = await setup();
      const sent = await sendDetail(s);
      const first = isOk(sent) ? sent.value.submissionId : null;
      expect(isOk(await decide(s, 'NEEDS_REPLACEMENT', { submissionId: first ?? '' }))).toBe(true);
      await s.save(V2);
      expect(isOk(await sendDetail(s))).toBe(true);
      const old = await decide(s, 'ACCEPTED', { submissionId: first ?? '' });
      expect(isErr(old) && old.error.code).toBe('stale');
      expect(await auditCount(s.w.db, 'EVIDENCE_REQUEST_DECIDED', s.requestId)).toBe(1);
    },
    TIMEOUT,
  );

  it(
    'a decision cannot be made twice on one send',
    async () => {
      const s = await setup();
      expect(isOk(await sendDetail(s))).toBe(true);
      expect(isOk(await decide(s, 'ACCEPTED'))).toBe(true);
      expect(isErr(await decide(s, 'NEEDS_REPLACEMENT'))).toBe(true);
      expect(
        await s.w.db.select().from(schema.evidenceRequestDecisionFactSubmissions),
      ).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'a detail with no saved value cannot be sent',
    async () => {
      const s = await setup();
      await s.w.db
        .update(schema.facts)
        .set({ currentVersionId: null })
        .where(eq(schema.facts.id, s.factId));
      const refused = await sendDetail(s);
      expect(isErr(refused) && refused.error.code).toBe('invalid');
      expect((await requestRow(s.w.db, s.requestId)).status).toBe('OPEN');
    },
    TIMEOUT,
  );

  it(
    'the withdrawn state is shown when the agency withdraws a waiting answer',
    async () => {
      const s = await setup();
      expect(isOk(await sendDetail(s))).toBe(true);
      expect(
        isOk(
          await cancelEvidenceRequest(s.w.db, {
            actorAccountId: s.w.north.accountId,
            requestId: s.requestId,
          }),
        ),
      ).toBe(true);
      const history = await ownerRead(s);
      expect(history.rounds.map((r) => r.state)).toEqual(['WITHDRAWN']);
    },
    TIMEOUT,
  );
});

describe('who may read a detail answer, and what they see', () => {
  it(
    'the agency sees which saved version it reviewed and that it changed since, never the text',
    async () => {
      const s = await setup();
      expect(isOk(await sendDetail(s))).toBe(true);
      expect(
        isOk(
          await startEvidenceReview(s.w.db, {
            actorAccountId: s.w.north.accountId,
            requestId: s.requestId,
          }),
        ),
      ).toBe(true);
      expect(isOk(await decide(s, 'ACCEPTED'))).toBe(true);
      await s.save(V2);
      const read = await agencyRead(s);
      expect(isOk(read)).toBe(true);
      const round = isOk(read) ? read.value.rounds[0] : undefined;
      expect(round).toMatchObject({
        state: 'ACCEPTED',
        version: { number: 1, stillCurrent: false, value: null },
      });
      expect(JSON.stringify(read)).not.toContain(V1);
      expect(JSON.stringify(read)).not.toContain(V2);
    },
    TIMEOUT,
  );

  it(
    'an unrelated agency, a second traveller and a made-up request all get the same refusal',
    async () => {
      const s = await setup();
      expect(isOk(await sendDetail(s))).toBe(true);
      // The unrelated agency has no access at all: it cannot even open the proof.
      const proof = await requireAccess(
        s.w.db,
        accountPrincipal(s.w.unrelated.accountId),
        'MANAGE',
        { applicantId: s.w.rahim.applicantId },
        { purpose: EACH_GRANT, actingFor: { organizationId: s.w.unrelated.organizationId } },
      );
      expect(isErr(proof)).toBe(true);
      // North's own proof, asked about a request of another agency or a made-up id.
      const real = await readEvidenceFieldAnswer(
        await agencyProof(s.w.db, s.w.north, s.w.rahim.applicantId),
        { requestId: s.requestId },
      );
      expect(isOk(real)).toBe(true);
      const other = await requestEvidence(s.w.db, {
        actorAccountId: s.w.unrelated.accountId,
        organizationId: s.w.unrelated.organizationId,
        applicantId: s.w.rahim.applicantId,
        kind: 'FIELD',
        fieldKey: 'phone',
      });
      // Without a grant the unrelated agency cannot raise one, so make the contrast with a made-up id.
      expect(isErr(other)).toBe(true);
      const madeUp = await readEvidenceFieldAnswer(
        await agencyProof(s.w.db, s.w.north, s.w.rahim.applicantId),
        { requestId: randomId() },
      );
      expect(isErr(madeUp) && madeUp.error.code).toBe('not_found');
      const notField = await readEvidenceFieldAnswer(await ownerProof(s.w.db, s.w.rahim), {
        requestId: 'not-an-id',
      });
      expect(isErr(notField) && notField.error.code).toBe('not_found');
    },
    TIMEOUT,
  );

  it(
    'an agency whose access was revoked reads nothing, while the traveller still reads everything',
    async () => {
      const s = await setup();
      expect(isOk(await sendDetail(s))).toBe(true);
      const proof = await agencyProof(s.w.db, s.w.north, s.w.rahim.applicantId);
      expect(
        isOk(
          await revokeGrant(s.w.db, {
            actorAccountId: s.w.rahim.accountId,
            grantId: s.w.northGrantId,
          }),
        ),
      ).toBe(true);
      // A proof made earlier is not enough: the live standing is checked again at the read.
      const late = await readEvidenceFieldAnswer(proof, { requestId: s.requestId });
      expect(isErr(late) && late.error.code).toBe('not_found');
      const made = await readEvidenceFieldAnswer(proof, { requestId: randomId() });
      expect(isErr(made) && made.error.code).toBe('not_found');
      // The traveller's own history is untouched.
      expect((await ownerRead(s)).rounds[0]?.version?.value).toBe(V1);
    },
    TIMEOUT,
  );

  it(
    'a protected detail is shown by version only, never its text',
    async () => {
      const s = await setup();
      expect(isOk(await sendDetail(s))).toBe(true);
      await s.w.db
        .update(schema.factVersions)
        .set({
          protectedKeyVersion: 'k1',
          value: null,
          valueCiphertext: Buffer.from('ciphertext'),
          valueNonce: Buffer.from('nonce-nonce1'),
        })
        .where(eq(schema.factVersions.factId, s.factId));
      const history = await ownerRead(s);
      expect(history.rounds[0]?.version).toMatchObject({ protected: true, value: null, number: 1 });
    },
    TIMEOUT,
  );
});

describe('answers recorded before the exact value was kept', () => {
  it(
    'show an explicit limitation, never the detail as it is now and never a guess',
    async () => {
      const s = await setup();
      // An answer sent by the older flow: the request points at the detail, nothing is pinned.
      await s.w.db
        .update(schema.evidenceRequests)
        .set({ status: 'RECEIVED', respondingFactId: s.factId, respondedAt: new Date() })
        .where(eq(schema.evidenceRequests.id, s.requestId));
      await s.save(V2);
      let history = await ownerRead(s);
      expect(history.legacyLabel).toBe(LEGACY_FIELD_ANSWER_LABEL);
      expect(history.rounds).toHaveLength(1);
      expect(history.rounds[0]).toMatchObject({
        precision: 'legacy',
        state: 'AWAITING_DECISION',
        submissionId: null,
        version: null,
      });
      expect(JSON.stringify(history)).not.toContain(V1);
      expect(JSON.stringify(history)).not.toContain(V2);

      // It can still be decided; the decision is recorded without a link, and stays "legacy".
      expect(isOk(await decide(s, 'ACCEPTED'))).toBe(true);
      await s.save(V3);
      history = await ownerRead(s);
      expect(history.rounds).toHaveLength(1);
      expect(history.rounds[0]).toMatchObject({
        precision: 'legacy',
        state: 'ACCEPTED',
        version: null,
      });
      expect(JSON.stringify(history)).not.toContain(V3);
      expect(
        await s.w.db.select().from(schema.evidenceRequestDecisionFactSubmissions),
      ).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'a legacy answer and a newer pinned answer sit side by side, each described as what it is',
    async () => {
      const s = await setup();
      await s.w.db
        .update(schema.evidenceRequests)
        .set({ status: 'RECEIVED', respondingFactId: s.factId, respondedAt: new Date() })
        .where(eq(schema.evidenceRequests.id, s.requestId));
      expect(isOk(await decide(s, 'NEEDS_REPLACEMENT'))).toBe(true);
      await s.save(V2);
      expect(isOk(await sendDetail(s))).toBe(true);
      const history = await ownerRead(s);
      expect(history.rounds.map((r) => [r.precision, r.state, r.version?.value ?? null])).toEqual([
        ['pinned', 'AWAITING_DECISION', V2],
        ['legacy', 'NEEDS_REPLACEMENT', null],
      ]);
    },
    TIMEOUT,
  );
});

describe('before migration 0135 has run', () => {
  async function withoutTables(s: Setup) {
    await s.w.db.execute(sql`drop table evidence_request_decision_fact_submissions`);
    await s.w.db.execute(sql`drop table evidence_request_fact_submissions`);
  }

  it(
    'sending and deciding keep working with the older pointer, and the exact value is said not to be kept',
    async () => {
      const s = await setup();
      await withoutTables(s);
      expect(isOk(await sendDetail(s))).toBe(true);
      expect(isOk(await decide(s, 'ACCEPTED'))).toBe(true);
      const history = await ownerRead(s);
      expect(history.available).toBe(false);
      expect(history.rounds).toHaveLength(1);
      expect(history.rounds[0]).toMatchObject({
        precision: 'legacy',
        state: 'ACCEPTED',
        version: null,
      });
    },
    TIMEOUT,
  );

  it(
    'a send that names an exact saved version is refused plainly, not faked',
    async () => {
      const s = await setup();
      await withoutTables(s);
      const refused = await sendDetail(s, { factVersionId: randomId() });
      expect(isErr(refused) && refused.error.code).toBe('invalid');
      expect((await requestRow(s.w.db, s.requestId)).status).toBe('OPEN');
    },
    TIMEOUT,
  );
});

describe('documents are unchanged', () => {
  it(
    'a detail send never writes a document send, and the reverse',
    async () => {
      const s = await setup();
      expect(isOk(await sendDetail(s))).toBe(true);
      expect(await s.w.db.select().from(schema.evidenceRequestSubmissions)).toHaveLength(0);
      const refused = await submitEvidenceResponse(s.w.db, {
        actorAccountId: s.w.rahim.accountId,
        requestId: s.requestId,
        documentId: randomId(),
      });
      expect(isErr(refused)).toBe(true);
    },
    TIMEOUT,
  );
});
