import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  type AiExtractionPort,
  approveClearProposals,
  approveProposal,
  isClearReading,
  listPendingProposals,
  rejectProposal,
  runExtraction,
} from './ai';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import {
  editFact,
  getCurrentFactVersion,
  listApplicantProfile,
  registerFieldDefinition,
} from './profile';

/** The document text the stub "reads"; a quote counts as found only when it is in here word for word. */
const TEXT =
  'Name: Ayesha Rahman. Occupation: Engineer. City: Dhaka. Passport A1234567. Employer: Acme Ltd. Address City: Sylhet. Born 1990-01-05.';

const stubAi: AiExtractionPort = {
  async extract() {
    return {
      ok: true,
      result: {
        proposals: [
          {
            type: 'NEW',
            fieldKey: 'given_name',
            value: 'Ayesha',
            confidence: 0.95,
            evidenceSnippet: 'Ayesha',
          },
          // The quote is not in the text, so it is not clear however confident.
          {
            type: 'NEW',
            fieldKey: 'family_name',
            value: 'Rahman',
            confidence: 0.95,
            evidenceSnippet: 'Rahmaan',
          },
          {
            type: 'NEW',
            fieldKey: 'occupation',
            value: 'Engineer',
            confidence: 0.6,
            evidenceSnippet: 'Engineer',
          },
          {
            type: 'NEW',
            fieldKey: 'passport_number',
            value: 'A1234567',
            confidence: 0.97,
            evidenceSnippet: 'A1234567',
          },
          {
            type: 'NEW',
            fieldKey: 'city',
            value: 'Dhaka',
            confidence: 0.96,
            evidenceSnippet: 'Dhaka',
          },
          // The quote is real, but the value is not in it.
          {
            type: 'NEW',
            fieldKey: 'employer',
            value: 'Globex',
            confidence: 0.95,
            evidenceSnippet: 'Employer:',
          },
          // Part of a repeating record (an address): saved per record, never in bulk.
          {
            type: 'NEW',
            fieldKey: 'address_city',
            value: 'Sylhet',
            confidence: 0.95,
            evidenceSnippet: 'Sylhet',
          },
          {
            type: 'NEW',
            fieldKey: 'date_of_birth',
            value: '1990-01-05',
            confidence: 0.95,
            evidenceSnippet: '1990-01-05',
          },
        ],
        usage: {
          costUnits: 1,
          inputUnits: 1,
          outputUnits: 1,
          cachedUnits: 0,
          modelVersion: 'test-model',
          promptVersion: 'p1',
          schemaVersion: 's1',
          provider: 'test',
          latencyMs: 1,
        },
      },
    };
  },
  cacheKeyComponents() {
    return { model: 'test-model', promptVersion: 'p1', schemaVersion: 's1' };
  },
};

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
});

async function seed(email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const account = provisioned.value;
  for (const type of ['CORE_PROCESSING', 'AI_EXTRACTION'] as const) {
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type,
      granted: true,
    });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const doc = await registerDocument(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    originalName: 'statement.pdf',
  });
  if (!isOk(doc)) throw new Error('doc');
  const version = await addDocumentVersion(db, {
    actorAccountId: account.id,
    documentId: doc.value.id,
    bucket: 'QUARANTINE',
    objectKey: `obj-${email}`,
  });
  if (!isOk(version)) throw new Error('version');
  for (const key of [
    'given_name',
    'family_name',
    'occupation',
    'city',
    'employer',
    'address_city',
  ]) {
    await registerFieldDefinition(db, { key, dataType: 'string', sensitivity: 'STANDARD' });
  }
  await registerFieldDefinition(db, {
    key: 'passport_number',
    dataType: 'string',
    sensitivity: 'RESTRICTED',
  });
  await registerFieldDefinition(db, {
    key: 'date_of_birth',
    dataType: 'date',
    sensitivity: 'STANDARD',
  });
  const applicantId = applicant.value.id;
  const run = await runExtraction(db, stubAi, {
    actorAccountId: account.id,
    applicantId,
    documentVersionId: version.value.version.id,
    text: TEXT,
    budgetLimitUnits: 10,
  });
  if (!isOk(run)) throw new Error('run');
  const idOf = (fieldKey: string) =>
    run.value.proposals.find((proposal) => proposal.fieldKey === fieldKey)?.id as string;
  return { accountId: account.id, applicantId, idOf, documentId: doc.value.id };
}

describe('accepting all clear details at once', () => {
  it('saves only clear, everyday details and leaves every other one for a careful look', async () => {
    const { accountId, applicantId, idOf } = await seed('clear@example.com');
    // A confirmed city already differs from the document's, so it needs a decision.
    const city = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'city',
      value: 'Chittagong',
      status: 'APPLICANT_CONFIRMED',
      method: 'MANUAL',
    });
    expect(isOk(city)).toBe(true);

    const pending = await listPendingProposals(db, applicantId);
    const all = pending.map(({ proposal }) => proposal.id);
    const result = await approveClearProposals(db, {
      actorAccountId: accountId,
      applicantId,
      proposalIds: all,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // Only the given name: the others are an unfound quote, low confidence, a restricted field and
    // a difference with a confirmed value.
    expect(result.value).toEqual({ approved: 2, leftForReview: 6, alreadyDecided: 0 });
    const left = (await listPendingProposals(db, applicantId)).map(
      ({ proposal }) => proposal.fieldKey,
    );
    expect(left.sort()).toEqual([
      'address_city',
      'city',
      'employer',
      'family_name',
      'occupation',
      'passport_number',
    ]);
    expect(left).not.toContain('given_name');
    expect(
      isClearReading(pending.find((p) => p.proposal.id === idOf('given_name'))?.proposal as never, [
        { verified: true, snippet: 'Name: Ayesha' },
      ]),
    ).toBe(true);
  }, 60_000);

  it('refuses someone who does not own the person, and ignores ids from another person', async () => {
    const owner = await seed('owner@example.com');
    const other = await seed('other@example.com');
    const refused = await approveClearProposals(db, {
      actorAccountId: other.accountId,
      applicantId: owner.applicantId,
      proposalIds: [owner.idOf('given_name')],
    });
    expect(isErr(refused) && refused.error.code).toBe('forbidden');
    const mixed = await approveClearProposals(db, {
      actorAccountId: other.accountId,
      applicantId: other.applicantId,
      proposalIds: [owner.idOf('given_name')],
    });
    expect(isOk(mixed) && mixed.value).toEqual({
      approved: 0,
      leftForReview: 1,
      alreadyDecided: 0,
    });
    expect(
      (await listPendingProposals(db, owner.applicantId)).some(
        ({ proposal }) => proposal.fieldKey === 'given_name',
      ),
    ).toBe(true);
  }, 60_000);
});

describe('settling a difference with a value already on file', () => {
  async function withConfirmedCity(email: string) {
    const seeded = await seed(email);
    await editFact(db, {
      actorAccountId: seeded.accountId,
      applicantId: seeded.applicantId,
      fieldKey: 'city',
      value: 'Chittagong',
      status: 'APPLICANT_CONFIRMED',
      method: 'MANUAL',
    });
    return seeded;
  }

  it('without a choice it is still saved as a conflict to check, as before', async () => {
    const { accountId, idOf } = await withConfirmedCity('conflict@example.com');
    const approved = await approveProposal(db, {
      actorAccountId: accountId,
      proposalId: idOf('city'),
    });
    expect(isOk(approved) && approved.value.version.status).toBe('CONFLICTED');
    expect(await db.select().from(schema.conflicts)).toHaveLength(1);
  }, 60_000);

  it('"use the document" saves it as the current value with no conflict left', async () => {
    const { accountId, applicantId, idOf, documentId } = await withConfirmedCity('use@example.com');
    const approved = await approveProposal(db, {
      actorAccountId: accountId,
      proposalId: idOf('city'),
      resolution: 'use_document',
    });
    expect(isOk(approved)).toBe(true);
    if (!isOk(approved)) return;
    expect(approved.value.version.status).toBe('DOCUMENT_SUPPORTED');
    expect(await db.select().from(schema.conflicts)).toHaveLength(0);
    expect((await getCurrentFactVersion(db, approved.value.fact.id))?.value).toBe('Dhaka');
    // The profile can point back to the document the value was read from.
    const entry = (await listApplicantProfile(db, applicantId)).find((e) => e.fieldKey === 'city');
    expect(entry?.sourceDocumentId).toBe(documentId);
    expect(entry?.isProtected).toBe(false);
  }, 60_000);

  it('"both are right, it changed" keeps the history and records when it changed', async () => {
    const { accountId, idOf } = await withConfirmedCity('changed@example.com');
    const missingDate = await approveProposal(db, {
      actorAccountId: accountId,
      proposalId: idOf('city'),
      resolution: 'changed',
    });
    expect(isErr(missingDate) && missingDate.error.code).toBe('invalid');
    const changedOn = new Date('2025-03-01T00:00:00Z');
    const approved = await approveProposal(db, {
      actorAccountId: accountId,
      proposalId: idOf('city'),
      resolution: 'changed',
      effectiveFrom: changedOn,
    });
    expect(isOk(approved)).toBe(true);
    if (!isOk(approved)) return;
    expect(approved.value.version.effectiveFrom?.toISOString()).toBe(changedOn.toISOString());
    expect(await db.select().from(schema.conflicts)).toHaveLength(0);
    const versions = await db
      .select()
      .from(schema.factVersions)
      .where(eq(schema.factVersions.factId, approved.value.fact.id));
    expect(versions.map((version) => version.value).sort()).toEqual(['Chittagong', 'Dhaka']);
  }, 60_000);
});

describe('decisions that must not happen twice or go wrong', () => {
  it('a reading decided elsewhere first is not decided again', async () => {
    const { accountId, applicantId, idOf } = await seed('twice@example.com');
    const first = await approveProposal(db, {
      actorAccountId: accountId,
      proposalId: idOf('given_name'),
    });
    expect(isOk(first)).toBe(true);
    const again = await rejectProposal(db, {
      actorAccountId: accountId,
      proposalId: idOf('given_name'),
    });
    expect(isErr(again) && again.error.code).toBe('invalid');
    const bulk = await approveClearProposals(db, {
      actorAccountId: accountId,
      applicantId,
      proposalIds: [idOf('given_name')],
    });
    expect(isOk(bulk) && bulk.value).toEqual({ approved: 0, leftForReview: 0, alreadyDecided: 1 });
  }, 60_000);

  it('refuses "it changed" for a date of birth', async () => {
    const { accountId, idOf } = await seed('fixed@example.com');
    const refused = await approveProposal(db, {
      actorAccountId: accountId,
      proposalId: idOf('date_of_birth'),
      resolution: 'changed',
      effectiveFrom: new Date('2020-01-01T00:00:00Z'),
    });
    expect(isErr(refused) && refused.error.code).toBe('invalid');
  }, 60_000);

  it('says why nothing was saved when processing consent was withdrawn', async () => {
    const { accountId, applicantId, idOf } = await seed('withdrawn@example.com');
    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: 'CORE_PROCESSING',
      granted: false,
    });
    const bulk = await approveClearProposals(db, {
      actorAccountId: accountId,
      applicantId,
      proposalIds: [idOf('given_name')],
    });
    expect(isErr(bulk)).toBe(true);
    expect(
      (await listPendingProposals(db, applicantId)).some(
        ({ proposal }) => proposal.fieldKey === 'given_name',
      ),
    ).toBe(true);
  }, 60_000);
});
