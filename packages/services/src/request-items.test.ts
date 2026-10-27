import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { createMission } from './missions';
import { assignReferenceCode, referenceCodesFor } from './reference-codes';
import {
  REQUEST_QUESTION_LIMIT,
  REQUEST_QUESTION_MAX_LENGTH,
  askAboutRequestItem,
  listRequestItemExtras,
  requestQuestionPrefix,
  requestQuestionText,
} from './request-items';
import { acceptGrant, createGrant } from './sharing';

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
});

async function account(email: string): Promise<string> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error(`provision ${email}`);
  return provisioned.value.id;
}

async function person(email: string) {
  const ownerId = await account(email);
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: ownerId,
    ownerAccountId: ownerId,
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const mission = await createMission(db, {
    actorAccountId: ownerId,
    applicantId: applicant.value.id,
    title: 'Visitor visa',
  });
  if (!isOk(mission)) throw new Error('mission');
  return { ownerId, applicantId: applicant.value.id, missionId: mission.value.id };
}

async function organization(): Promise<string> {
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Harbor Visas' })
    .returning({ id: schema.organizations.id });
  if (!org) throw new Error('org');
  return org.id;
}

async function request(
  organizationId: string,
  applicantId: string,
  values: {
    readonly missionId?: string;
    readonly status?: (typeof schema.evidenceRequestStatus.enumValues)[number];
    readonly packRequirementId?: string;
  } = {},
) {
  const [row] = await db
    .insert(schema.evidenceRequests)
    .values({
      organizationId,
      applicantId,
      missionId: values.missionId ?? null,
      packRequirementId: values.packRequirementId ?? null,
      kind: 'DOCUMENT',
      docType: 'BANK_STATEMENT',
      status: values.status ?? 'OPEN',
    })
    .returning({ id: schema.evidenceRequests.id });
  if (!row) throw new Error('request');
  const code = await assignReferenceCode(db, 'R', row.id);
  if (!code) throw new Error('code');
  return { id: row.id, code: `R-${code}` };
}

async function commentProof(accountId: string, missionId: string) {
  return requireAccess(
    db,
    accountPrincipal(accountId),
    'COMMENT',
    { missionId },
    { purpose: 'request_question' },
  );
}

async function viewProof(accountId: string, applicantId: string) {
  return requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'self' },
  );
}

async function ask(ownerId: string, missionId: string, requestId: string, question: string) {
  const proof = await commentProof(ownerId, missionId);
  if (!isOk(proof)) throw new Error('comment proof');
  return askAboutRequestItem(proof.value, { requestId, question });
}

describe('the words of a question', () => {
  it('builds and reads back the same prefix', () => {
    const prefix = requestQuestionPrefix('R-7K2Q9M');
    expect(prefix).toBe('Question about R-7K2Q9M: ');
    expect(requestQuestionText(`${prefix}Is a photo of the page enough?`, 'R-7K2Q9M')).toBe(
      'Is a photo of the page enough?',
    );
    expect(requestQuestionText(`${prefix}Hello`, 'R-ZZZZZZ')).toBeNull();
    expect(requestQuestionText('Just a note', 'R-7K2Q9M')).toBeNull();
  });
});

describe('askAboutRequestItem', () => {
  it('writes one shared case note that names the request by its code, and audits it', async () => {
    const { ownerId, applicantId, missionId } = await person('asker@example.test');
    const orgId = await organization();
    const req = await request(orgId, applicantId, { missionId });

    const asked = await ask(ownerId, missionId, req.id, '  Is a photo\nof the page   enough?  ');
    expect(isOk(asked)).toBe(true);
    if (!isOk(asked)) return;
    expect(asked.value.body).toBe(`Question about ${req.code}: Is a photo of the page enough?`);
    expect(asked.value.visibility).toBe('TRAVELLER_SHARED');
    expect(asked.value.authorAccountId).toBe(ownerId);
    expect(asked.value.authorOrganizationId).toBeNull();

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'MISSION_NOTE_ADDED'));
    expect(events.length).toBe(1);
    // The audit entry never holds the words of the question.
    expect(JSON.stringify(events)).not.toContain('photo');
  });

  it('refuses an empty or over-long question with a plain reason', async () => {
    const { ownerId, applicantId, missionId } = await person('bounds@example.test');
    const req = await request(await organization(), applicantId, { missionId });

    const empty = await ask(ownerId, missionId, req.id, '   \n ');
    expect(isErr(empty) && empty.error.message).toBe('Write your question first.');
    const long = await ask(ownerId, missionId, req.id, 'x'.repeat(REQUEST_QUESTION_MAX_LENGTH + 1));
    expect(isErr(long) && long.error.message).toContain('Keep your question under 500');
    const exact = await ask(ownerId, missionId, req.id, 'x'.repeat(REQUEST_QUESTION_MAX_LENGTH));
    expect(isOk(exact)).toBe(true);
  });

  it('stops after the limit for one request, and the limit is per request', async () => {
    const { ownerId, applicantId, missionId } = await person('limit@example.test');
    const orgId = await organization();
    const first = await request(orgId, applicantId, { missionId });
    const second = await request(orgId, applicantId, { missionId });

    for (let i = 0; i < REQUEST_QUESTION_LIMIT; i += 1) {
      expect(isOk(await ask(ownerId, missionId, first.id, `Question ${i}`))).toBe(true);
    }
    const over = await ask(ownerId, missionId, first.id, 'One more');
    expect(isErr(over) && over.error.message).toContain('asked several questions');
    expect(isOk(await ask(ownerId, missionId, second.id, 'A different item'))).toBe(true);
  });

  it('answers a request on another case, a cancelled one and a request with no case like an unknown one', async () => {
    const { ownerId, applicantId, missionId } = await person('scope@example.test');
    const otherCase = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Second case',
    });
    if (!isOk(otherCase)) throw new Error('other case');
    const orgId = await organization();
    const onOther = await request(orgId, applicantId, { missionId: otherCase.value.id });
    const noCase = await request(orgId, applicantId);
    const closed = await Promise.all(
      (['CANCELLED', 'FULFILLED', 'DECLINED'] as const).map((status) =>
        request(orgId, applicantId, { missionId, status }),
      ),
    );

    for (const target of [onOther, noCase, ...closed]) {
      const refused = await ask(ownerId, missionId, target.id, 'Hello?');
      expect(isErr(refused) && refused.error.code).toBe('not_found');
    }
    const missing = await ask(ownerId, missionId, '00000000-0000-4000-8000-000000000000', 'Hi');
    expect(isErr(missing) && missing.error.code).toBe('not_found');
  });

  it("never reaches another person's request", async () => {
    const mine = await person('mine@example.test');
    const theirs = await person('theirs@example.test');
    const req = await request(await organization(), theirs.applicantId, {
      missionId: theirs.missionId,
    });
    // The proof is on the asker's own case; the request belongs to someone else's.
    const refused = await ask(mine.ownerId, mine.missionId, req.id, 'Hello?');
    expect(isErr(refused) && refused.error.code).toBe('not_found');
    // And the asker has no proof on the other person's case at all.
    expect(isOk(await commentProof(mine.ownerId, theirs.missionId))).toBe(false);
  });

  it('cannot take a question before the request has a visible code', async () => {
    const { ownerId, applicantId, missionId } = await person('nocode@example.test');
    const [row] = await db
      .insert(schema.evidenceRequests)
      .values({
        organizationId: await organization(),
        applicantId,
        missionId,
        kind: 'DOCUMENT',
        docType: 'PASSPORT',
      })
      .returning({ id: schema.evidenceRequests.id });
    if (!row) throw new Error('request');
    expect((await referenceCodesFor(db, 'R', [row.id])).size).toBe(0);
    const refused = await ask(ownerId, missionId, row.id, 'Hello?');
    expect(isErr(refused) && refused.error.message).toBe(
      'This request cannot take a question yet.',
    );
  });

  it('refuses a person the owner shared the case with, even when they may comment', async () => {
    const { ownerId, applicantId, missionId } = await person('shared@example.test');
    const req = await request(await organization(), applicantId, { missionId });
    const friendId = await account('friend@example.test');
    const grant = await createGrant(db, {
      actorAccountId: ownerId,
      applicantId,
      recipientAccountId: friendId,
      actions: ['VIEW_METADATA', 'COMMENT'],
      purpose: 'family-help',
    });
    if (!isOk(grant)) throw new Error('grant');
    const accepted = await acceptGrant(db, { actorAccountId: friendId, grantId: grant.value.id });
    if (!isOk(accepted)) throw new Error('accept');

    const comment = await requireAccess(
      db,
      accountPrincipal(friendId),
      'COMMENT',
      { missionId },
      { purpose: 'family-help' },
    );
    expect(isOk(comment)).toBe(true);
    if (!isOk(comment)) return;
    const refused = await askAboutRequestItem(comment.value, { requestId: req.id, question: 'Hi' });
    expect(isErr(refused) && refused.error.code).toBe('forbidden');

    const view = await requireAccess(
      db,
      accountPrincipal(friendId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'family-help' },
    );
    if (!isOk(view)) throw new Error('view proof');
    const listed = await listRequestItemExtras(view.value, new Map([[req.id, req.code]]));
    expect(isErr(listed) && listed.error.code).toBe('forbidden');
    const notes = await db.select().from(schema.missionNotes);
    expect(notes).toHaveLength(0);
  });

  it('refuses a proof that was not issued to the owner', async () => {
    const { ownerId, applicantId, missionId } = await person('owner@example.test');
    const req = await request(await organization(), applicantId, { missionId });
    const stranger = await account('stranger@example.test');
    expect(isOk(await commentProof(stranger, missionId))).toBe(false);
    // A copy of a genuine proof is not a proof.
    const proof = await commentProof(ownerId, missionId);
    if (!isOk(proof)) throw new Error('proof');
    const copy = { ...proof.value } as unknown as Parameters<typeof askAboutRequestItem>[0];
    const refused = await askAboutRequestItem(copy, { requestId: req.id, question: 'Hi' });
    expect(isErr(refused) && refused.error.code).toBe('forbidden');
  });
});

describe('listRequestItemExtras', () => {
  it("returns the checklist rule of a request made from a checklist item, and the owner's questions", async () => {
    const { ownerId, applicantId, missionId } = await person('extras@example.test');
    const orgId = await organization();
    const [pack] = await db
      .insert(schema.packs)
      .values({ key: 'test.visitor', name: 'Visitor pack', purpose: 'tourism' })
      .returning({ id: schema.packs.id });
    if (!pack) throw new Error('pack');
    const [version] = await db
      .insert(schema.packVersions)
      .values({ packId: pack.id, version: 1, status: 'PUBLISHED' })
      .returning({ id: schema.packVersions.id });
    if (!version) throw new Error('version');
    const [requirement] = await db
      .insert(schema.packRequirements)
      .values({
        packVersionId: version.id,
        kind: 'DOCUMENT',
        docType: 'BANK_STATEMENT',
        citation: 'Test citation',
        optional: true,
        maxAgeDays: 90,
      })
      .returning({ id: schema.packRequirements.id });
    if (!requirement) throw new Error('requirement');

    const withRule = await request(orgId, applicantId, {
      missionId,
      packRequirementId: requirement.id,
    });
    const plain = await request(orgId, applicantId, { missionId });
    expect(isOk(await ask(ownerId, missionId, withRule.id, 'Which month?'))).toBe(true);
    expect(isOk(await ask(ownerId, missionId, withRule.id, 'And the stamp?'))).toBe(true);

    const proof = await viewProof(ownerId, applicantId);
    if (!isOk(proof)) throw new Error('proof');
    const codes = new Map([
      [withRule.id, withRule.code],
      [plain.id, plain.code],
    ]);
    const extras = await listRequestItemExtras(proof.value, codes);
    if (!isOk(extras)) throw new Error('extras');

    expect(extras.value.rules.get(withRule.id)).toEqual({ maxAgeDays: 90, optional: true });
    expect(extras.value.rules.has(plain.id)).toBe(false);
    expect(extras.value.questions.get(withRule.id)?.map((q) => q.text)).toEqual([
      'And the stamp?',
      'Which month?',
    ]);
    expect(extras.value.questions.has(plain.id)).toBe(false);
  });

  it("does not show an agency member's note, an internal note or another request's question", async () => {
    const { ownerId, applicantId, missionId } = await person('mix@example.test');
    const orgId = await organization();
    const a = await request(orgId, applicantId, { missionId });
    const b = await request(orgId, applicantId, { missionId });
    const agencyAccount = await account('agency@example.test');
    // Another author's note carrying A's words, and an internal note: neither is the traveller's question.
    await db.insert(schema.missionNotes).values([
      {
        missionId,
        authorAccountId: agencyAccount,
        visibility: 'TRAVELLER_SHARED',
        body: `${requestQuestionPrefix(a.code)}Pretend question`,
      },
      {
        missionId,
        authorAccountId: ownerId,
        visibility: 'AGENCY_INTERNAL',
        body: `${requestQuestionPrefix(a.code)}Internal`,
      },
    ]);
    expect(isOk(await ask(ownerId, missionId, b.id, 'About B'))).toBe(true);

    const proof = await viewProof(ownerId, applicantId);
    if (!isOk(proof)) throw new Error('proof');
    const extras = await listRequestItemExtras(
      proof.value,
      new Map([
        [a.id, a.code],
        [b.id, b.code],
      ]),
    );
    if (!isOk(extras)) throw new Error('extras');
    expect(extras.value.questions.has(a.id)).toBe(false);
    expect(extras.value.questions.get(b.id)?.map((q) => q.text)).toEqual(['About B']);
  });

  it('refuses a proof that is not the owner and a copied proof', async () => {
    const { ownerId, applicantId } = await person('gate@example.test');
    const proof = await viewProof(ownerId, applicantId);
    if (!isOk(proof)) throw new Error('proof');
    const copy = { ...proof.value } as unknown as Parameters<typeof listRequestItemExtras>[0];
    const refused = await listRequestItemExtras(copy, new Map());
    expect(isErr(refused) && refused.error.code).toBe('forbidden');
  });
});
