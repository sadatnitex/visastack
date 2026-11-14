import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  type AiExtractionPort,
  approveProposal,
  listPendingProposals,
  rejectProposal,
  runExtraction,
} from './ai';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { editFact, getCurrentFactVersion, registerFieldDefinition } from './profile';

/** One reading with the given details, as the stub reader returns them. */
function readerOf(
  details: Readonly<Record<string, string>>[],
  promptVersion = 'p1',
): AiExtractionPort {
  return {
    async extract() {
      return {
        ok: true,
        result: {
          proposals: details.flatMap((detail) =>
            Object.entries(detail).map(([fieldKey, value]) => ({
              type: 'NEW' as const,
              fieldKey,
              value,
              confidence: 0.95,
              evidenceSnippet: value,
            })),
          ),
          usage: {
            costUnits: 1,
            inputUnits: 1,
            outputUnits: 1,
            cachedUnits: 0,
            modelVersion: 'test-model',
            promptVersion,
            schemaVersion: 's1',
            provider: 'test',
            latencyMs: 1,
          },
        },
      };
    },
    cacheKeyComponents() {
      return { model: 'test-model', promptVersion, schemaVersion: 's1' };
    },
  };
}

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
});

/** A day relative to now, written year-month-day (never a fixed date: fixtures must not expire). */
function dayFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function seed() {
  const provisioned = await provisionAccount(db, { email: 'issue-date@example.com' });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'AI_EXTRACTION'] as const) {
    await setConsent(db, { actorAccountId: accountId, accountId, type, granted: true });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const applicantId = applicant.value.id;
  for (const key of ['passport_number', 'occupation', 'given_name', 'family_name']) {
    await registerFieldDefinition(db, { key, dataType: 'string', sensitivity: 'STANDARD' });
  }
  await registerFieldDefinition(db, {
    key: 'passport_issue_date',
    dataType: 'date',
    sensitivity: 'STANDARD',
  });
  let counter = 0;
  const addFile = async (docType: string | undefined = 'PASSPORT') => {
    counter += 1;
    const doc = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: `file-${counter}.pdf`,
      ...(docType ? { docType } : {}),
    });
    if (!isOk(doc)) throw new Error('doc');
    const version = await addDocumentVersion(db, {
      actorAccountId: accountId,
      documentId: doc.value.id,
      bucket: 'QUARANTINE',
      objectKey: `obj-${counter}`,
    });
    if (!isOk(version)) throw new Error('version');
    return version.value.version.id;
  };
  const read = async (
    versionId: string,
    details: Readonly<Record<string, string>>[],
    promptVersion = 'p1',
  ) => {
    const run = await runExtraction(db, readerOf(details, promptVersion), {
      feature: 'ai_document_reading',
      actorAccountId: accountId,
      applicantId,
      documentVersionId: versionId,
      text: details.flatMap((d) => Object.values(d)).join(' ') + promptVersion,
      budgetLimitUnits: 10,
    });
    if (!isOk(run)) throw new Error('run');
    return run.value.proposals;
  };
  const pendingOf = async (fieldKey: string, versionId: string) => {
    const pending = await listPendingProposals(db, applicantId);
    return pending.find(
      (reading) =>
        reading.proposal.fieldKey === fieldKey && reading.proposal.documentVersionId === versionId,
    );
  };
  return { accountId, applicantId, addFile, read, pendingOf };
}

describe('the issue date a document supports for a changed detail', () => {
  it('is the one issue date read from the same document version', async () => {
    const { addFile, read, pendingOf } = await seed();
    const version = await addFile();
    await read(version, [{ passport_number: 'A1234567', passport_issue_date: '2024-03-12' }]);
    expect((await pendingOf('passport_number', version))?.issueDate).toEqual({
      status: 'found',
      date: '2024-03-12',
    });
  });

  it('still counts after the issue date itself was accepted, as the person corrected it', async () => {
    const { accountId, addFile, read, pendingOf } = await seed();
    const version = await addFile();
    const proposals = await read(version, [
      { passport_number: 'A1234567', passport_issue_date: '2024-03-12' },
    ]);
    const issue = proposals.find((p) => p.fieldKey === 'passport_issue_date');
    const approved = await approveProposal(db, {
      actorAccountId: accountId,
      proposalId: issue?.id as string,
      correctedValue: '2024-03-14',
    });
    expect(isOk(approved)).toBe(true);
    expect((await pendingOf('passport_number', version))?.issueDate).toEqual({
      status: 'found',
      date: '2024-03-14',
    });
  });

  it('is empty when the document has no issue date reading', async () => {
    const { addFile, read, pendingOf } = await seed();
    const version = await addFile();
    await read(version, [{ passport_number: 'A1234567' }]);
    expect((await pendingOf('passport_number', version))?.issueDate).toEqual({ status: 'none' });
  });

  it('ignores a reading the person skipped', async () => {
    const { accountId, addFile, read, pendingOf } = await seed();
    const version = await addFile();
    const proposals = await read(version, [
      { passport_number: 'A1234567', passport_issue_date: '2024-03-12' },
    ]);
    const issue = proposals.find((p) => p.fieldKey === 'passport_issue_date');
    const rejected = await rejectProposal(db, {
      actorAccountId: accountId,
      proposalId: issue?.id as string,
    });
    expect(isOk(rejected)).toBe(true);
    expect((await pendingOf('passport_number', version))?.issueDate).toEqual({ status: 'none' });
  });

  it('is never chosen when the document was read twice with two different issue dates', async () => {
    const { addFile, read, pendingOf } = await seed();
    const version = await addFile();
    await read(version, [{ passport_number: 'A1234567', passport_issue_date: '2024-03-12' }]);
    await read(version, [{ passport_number: 'A1234567', passport_issue_date: '2021-05-02' }], 'p2');
    expect((await pendingOf('passport_number', version))?.issueDate).toEqual({
      status: 'conflict',
    });
  });

  it('is the same day when a second reading agrees', async () => {
    const { addFile, read, pendingOf } = await seed();
    const version = await addFile();
    await read(version, [{ passport_number: 'A1234567', passport_issue_date: '2024-03-12' }]);
    await read(version, [{ passport_number: 'A1234567', passport_issue_date: '2024-03-12' }], 'p2');
    expect((await pendingOf('passport_number', version))?.issueDate).toEqual({
      status: 'found',
      date: '2024-03-12',
    });
  });

  it('is refused when it is in the future', async () => {
    const { addFile, read, pendingOf } = await seed();
    const version = await addFile();
    await read(version, [{ passport_number: 'A1234567', passport_issue_date: dayFromNow(30) }]);
    expect((await pendingOf('passport_number', version))?.issueDate).toEqual({
      status: 'future',
    });
  });

  it('is accepted when it is today', async () => {
    const { addFile, read, pendingOf } = await seed();
    const version = await addFile();
    const today = dayFromNow(0);
    await read(version, [{ passport_number: 'A1234567', passport_issue_date: today }]);
    expect((await pendingOf('passport_number', version))?.issueDate).toEqual({
      status: 'found',
      date: today,
    });
  });

  it('is never guessed from a date written in words', async () => {
    const { addFile, read, pendingOf } = await seed();
    const version = await addFile();
    await read(version, [{ passport_number: 'A1234567', passport_issue_date: '12 MAR 2024' }]);
    expect((await pendingOf('passport_number', version))?.issueDate).toEqual({
      status: 'unreadable',
    });
  });

  it('never borrows the issue date of a different document', async () => {
    const { addFile, read, pendingOf } = await seed();
    const first = await addFile();
    const second = await addFile();
    await read(first, [{ passport_issue_date: '2024-03-12' }]);
    await read(second, [{ passport_number: 'B7654321' }]);
    expect((await pendingOf('passport_number', second))?.issueDate).toEqual({ status: 'none' });
  });

  it('is not offered for a detail whose document type has no issue date', async () => {
    const { addFile, read, pendingOf } = await seed();
    const version = await addFile();
    await read(version, [{ occupation: 'Engineer', passport_issue_date: '2024-03-12' }]);
    expect((await pendingOf('occupation', version))?.issueDate).toBeUndefined();
  });

  it('feeds the same save as a typed date: the service still requires one for "it changed"', async () => {
    const { accountId, applicantId, addFile, read, pendingOf } = await seed();
    const version = await addFile();
    await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'passport_number',
      value: 'OLD000001',
      status: 'APPLICANT_CONFIRMED',
      method: 'MANUAL',
    });
    await read(version, [{ passport_number: 'A1234567', passport_issue_date: '2024-03-12' }]);
    const reading = await pendingOf('passport_number', version);
    expect(reading?.issueDate?.status).toBe('found');
    // A prefilled date makes no difference to the rule: without a date nothing is saved.
    const refused = await approveProposal(db, {
      actorAccountId: accountId,
      proposalId: reading?.proposal.id as string,
      resolution: 'changed',
    });
    expect(isErr(refused)).toBe(true);
    // The date the person confirmed is the date saved.
    const saved = await approveProposal(db, {
      actorAccountId: accountId,
      proposalId: reading?.proposal.id as string,
      resolution: 'changed',
      effectiveFrom: new Date('2024-03-12T00:00:00Z'),
    });
    expect(isOk(saved)).toBe(true);
    const factId = isOk(saved) ? saved.value.version.factId : '';
    const current = await getCurrentFactVersion(db, factId);
    expect(current?.effectiveFrom?.toISOString().slice(0, 10)).toBe('2024-03-12');
    expect(
      (
        await db
          .select()
          .from(schema.fieldProposals)
          .where(eq(schema.fieldProposals.id, reading?.proposal.id as string))
      )[0]?.status,
    ).toBe('APPROVED');
  });
  it('is not offered for a document type with no issue date, even for a detail a passport also carries', async () => {
    const { addFile, read, pendingOf } = await seed();
    const version = await addFile('NID');
    await read(version, [{ family_name: 'Rahman', passport_issue_date: '2024-03-12' }]);
    expect((await pendingOf('family_name', version))?.issueDate).toBeUndefined();
  });

  it('is not offered for a file whose kind is not known yet', async () => {
    const { addFile, read, pendingOf } = await seed();
    const version = await addFile('');
    await read(version, [{ passport_number: 'A1234567', passport_issue_date: '2024-03-12' }]);
    expect((await pendingOf('passport_number', version))?.issueDate).toBeUndefined();
  });

  it('never counts a date an AI app suggested for this document as the document’s own', async () => {
    const { applicantId, addFile, read, pendingOf } = await seed();
    const version = await addFile();
    await read(version, [{ passport_number: 'A1234567' }]);
    // An AI app names this passport and suggests an issue date: stored on the passport's version.
    const [run] = await db
      .insert(schema.aiExtractionRuns)
      .values({
        documentVersionId: version,
        applicantId,
        status: 'SUCCEEDED',
        modelVersion: 'connector:app.example.com',
        promptVersion: 'connection-1',
      })
      .returning();
    await db.insert(schema.fieldProposals).values({
      aiExtractionRunId: (run as { id: string }).id,
      documentVersionId: version,
      applicantId,
      type: 'NEW',
      fieldKey: 'passport_issue_date',
      value: '2025-01-01',
      confidence: 90,
    });
    expect((await pendingOf('passport_number', version))?.issueDate).toEqual({ status: 'none' });
  });
});
