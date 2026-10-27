import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { systemScopeForTest } from './access/system-scope.test-support';
import {
  approveClearProposals,
  countAiExtractionAttempts,
  documentAiCostUnits,
  totalAiCostUnits,
} from './ai';
import { processAiReading } from './ai-reading';
import { aiReadingIdempotencyKey } from './ai-reading-job';
import {
  L1,
  LETTER_TEXT,
  PASSPORT_TEXT,
  SCAN_TEXT,
  cleanScanner,
  countingPorts,
  extractorFor,
  freshDb,
  jobsOf,
  noTextExtractor,
  proposalsOf,
  runIntake,
  scope,
  seedReader,
  switchAiOff,
  withinLimits,
} from './ai-reading.test-support';
import { MRZ_TD3_MODEL_VERSION } from './ai-run-kinds';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion } from './documents';
import { getLatestExtractedText, getLatestReadableText } from './intake';
import { runAiReadingWorker, runIntakeWorker } from './jobs';
import { collectOperationalSignals } from './operational-signals';

/**
 * S5 (ADR 0019): reading happens after upload without a button, cheapest reader first. These tests
 * run the real intake pipeline and the real queue against an in-memory database, with providers
 * that count every call, so "no AI call" is a fact the test can see.
 */

describe('passport machine-readable lines become suggestions with no AI', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('stores one pending suggestion per field, from a zero-cost rule-based run, and calls no AI', async () => {
    const reader = await seedReader(db, 'mrz@example.com', { consents: ['CORE_PROCESSING'] });
    await runIntake(db, reader.versionId, extractorFor(PASSPORT_TEXT));

    const runs = await db
      .select()
      .from(schema.aiExtractionRuns)
      .where(eq(schema.aiExtractionRuns.documentVersionId, reader.versionId));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      modelVersion: MRZ_TD3_MODEL_VERSION,
      status: 'SUCCEEDED',
      costUnits: 0,
      applicantId: reader.applicantId,
    });

    const proposals = await proposalsOf(db, reader.versionId);
    const byKey = new Map(proposals.map((p) => [p.fieldKey, p] as const));
    expect([...byKey.keys()].sort()).toEqual(
      [
        'date_of_birth',
        'family_name',
        'given_name',
        'nationality',
        'passport_expiry',
        'passport_issuing_country',
        'passport_number',
        'sex',
      ].sort(),
    );
    expect(proposals.every((p) => p.status === 'PENDING' && p.type === 'NEW')).toBe(true);
    expect(byKey.get('family_name')?.value).toBe('ERIKSSON');
    expect(byKey.get('given_name')?.value).toBe('ANNA MARIA');
    expect(byKey.get('passport_number')?.value).toBe('L898902C3');
    expect(byKey.get('date_of_birth')?.value).toBe('1974-08-12');
    expect(byKey.get('passport_expiry')?.value).toBe('2012-04-15');
    expect(byKey.get('sex')?.value).toBe('Female');
    expect(byKey.get('nationality')?.value).toBe('UTO');

    // Every reading cites a machine-readable line that is really in the text.
    const evidence = await db.select().from(schema.evidenceLocations);
    expect(evidence).toHaveLength(8);
    expect(evidence.every((e) => e.verified === true && PASSPORT_TEXT.includes(e.snippet))).toBe(
      true,
    );

    // Nothing was queued for an AI provider, and nothing was written to the profile.
    expect(await jobsOf(db, reader.versionId)).toHaveLength(0);
    expect(await db.select().from(schema.facts)).toHaveLength(0);
    const { ports, calls } = countingPorts();
    expect(await runAiReadingWorker(db, scope(), ports)).toEqual({
      processed: 0,
      stopped: 0,
      failed: 0,
    });
    expect(calls).toMatchObject({ extract: 0, ocr: 0, render: 0, prepare: 0 });
  });

  it('lets only the clear details be accepted together, and country codes are left to look at', async () => {
    const reader = await seedReader(db, 'clear@example.com', { consents: ['CORE_PROCESSING'] });
    await runIntake(db, reader.versionId, extractorFor(PASSPORT_TEXT));
    const proposals = await proposalsOf(db, reader.versionId);
    const accepted = await approveClearProposals(db, {
      actorAccountId: reader.accountId,
      applicantId: reader.applicantId,
      proposalIds: proposals.map((p) => p.id),
    });
    expect(isOk(accepted)).toBe(true);
    if (!isOk(accepted)) return;
    // Both names appear word for word in the line. Sensitive details, dates, the sex word and the
    // two country codes (lower confidence) stay for one-at-a-time review.
    expect(accepted.value.approved).toBe(2);
    expect(accepted.value.leftForReview).toBe(6);
    const left = await db
      .select()
      .from(schema.fieldProposals)
      .where(
        and(
          eq(schema.fieldProposals.documentVersionId, reader.versionId),
          eq(schema.fieldProposals.status, 'PENDING'),
        ),
      );
    expect(left.map((p) => p.fieldKey).sort()).toEqual(
      [
        'date_of_birth',
        'nationality',
        'passport_expiry',
        'passport_issuing_country',
        'passport_number',
        'sex',
      ].sort(),
    );
  });

  it('does not list the same details twice when the file is read again', async () => {
    const reader = await seedReader(db, 'again@example.com', { consents: ['CORE_PROCESSING'] });
    await runIntake(db, reader.versionId, extractorFor(PASSPORT_TEXT));
    await db
      .update(schema.documentVersions)
      .set({ processingStatus: 'EXTRACTING' })
      .where(eq(schema.documentVersions.id, reader.versionId));
    await runIntake(db, reader.versionId, extractorFor(PASSPORT_TEXT));
    expect(await proposalsOf(db, reader.versionId)).toHaveLength(8);
  });

  it('puts a birth year such as 38 in the last century, never in the future', async () => {
    const reader = await seedReader(db, 'old@example.com', { consents: ['CORE_PROCESSING'] });
    // Same specimen with a birth date of 12 August 1938 and its own check digits.
    const { checkDigit } = await import('./mrz');
    const dob = '380812';
    const body = `L898902C3${checkDigit('L898902C3')}UTO${dob}${checkDigit(dob)}F1204159ZE184226B<<<<<1`;
    const composite = body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43);
    const line2 = `${body.slice(0, 43)}${checkDigit(composite)}`;
    await runIntake(db, reader.versionId, extractorFor(`${L1}\n${line2}\n`));
    const dobProposal = (await proposalsOf(db, reader.versionId)).find(
      (p) => p.fieldKey === 'date_of_birth',
    );
    expect(dobProposal?.value).toBe('1938-08-12');
  });
});

describe('queueing the automatic reading', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('queues one job per file version when the owner allows AI reading, in the same step that opens it for review', async () => {
    const reader = await seedReader(db, 'queue@example.com', { docType: 'HOTEL_BOOKING' });
    const version = await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    expect(version.processingStatus).toBe('AWAITING_REVIEW');
    const jobs = await jobsOf(db, reader.versionId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      status: 'PENDING',
      idempotencyKey: aiReadingIdempotencyKey(reader.versionId),
    });
  });

  it('queues nothing when the owner has not allowed AI reading, so the person is only offered it', async () => {
    const reader = await seedReader(db, 'noconsent@example.com', {
      consents: ['CORE_PROCESSING'],
      docType: 'HOTEL_BOOKING',
    });
    const { ports, calls } = countingPorts();
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    expect(await jobsOf(db, reader.versionId)).toHaveLength(0);
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result).toEqual({ processed: 0, stopped: 0, failed: 0 });
    expect(calls).toMatchObject({ extract: 0, ocr: 0 });
  });

  it('queues nothing while the platform has AI switched off', async () => {
    const reader = await seedReader(db, 'off@example.com', { docType: 'HOTEL_BOOKING' });
    await switchAiOff(db);
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    expect(await jobsOf(db, reader.versionId)).toHaveLength(0);
  });

  it('is one job however many times intake finishes the same version', async () => {
    const reader = await seedReader(db, 'dup@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports, calls } = countingPorts();
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    await db
      .update(schema.documentVersions)
      .set({ processingStatus: 'EXTRACTING' })
      .where(eq(schema.documentVersions.id, reader.versionId));
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    expect(await jobsOf(db, reader.versionId)).toHaveLength(1);

    // Two workers at once, and then a third pass: the file is read once.
    await Promise.all([
      runAiReadingWorker(db, scope(), ports),
      runAiReadingWorker(db, scope(), ports),
    ]);
    expect(calls.extract).toBe(1);
    await db
      .update(schema.processingJobs)
      .set({ status: 'PENDING', availableAt: new Date() })
      .where(eq(schema.processingJobs.documentVersionId, reader.versionId));
    await runAiReadingWorker(db, scope(), ports);
    expect(calls.extract).toBe(1);
    expect(await proposalsOf(db, reader.versionId)).toHaveLength(1);
  });

  it('keeps the two kinds of queue work apart: intake never claims a reading, and reading never claims an intake pass', async () => {
    const read = await seedReader(db, 'kinds-a@example.com', { docType: 'HOTEL_BOOKING' });
    const fresh = await seedReader(db, 'kinds-b@example.com', { docType: 'HOTEL_BOOKING' });
    const later = await seedReader(db, 'kinds-c@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports, calls } = countingPorts();
    // "read" finishes intake, which queues its reading.
    await runIntake(db, read.versionId, extractorFor(LETTER_TEXT));
    const intakeJob = (versionId: string) => ({
      documentVersionId: versionId,
      jobType: 'INTAKE' as const,
      processingVersion: 1,
      idempotencyKey: `${versionId}:INTAKE:1`,
    });
    await db.insert(schema.processingJobs).values(intakeJob(fresh.versionId));

    const intake = await runIntakeWorker(
      db,
      cleanScanner,
      extractorFor(LETTER_TEXT),
      withinLimits,
      {},
    );
    expect(intake.processed).toBe(1);
    const statusOf = async (versionId: string, key: string) =>
      (await jobsOf(db, versionId)).find((job) => job.idempotencyKey === key)?.status;
    expect(await statusOf(fresh.versionId, `${fresh.versionId}:INTAKE:1`)).toBe('DONE');
    expect(await statusOf(read.versionId, aiReadingIdempotencyKey(read.versionId))).toBe('PENDING');

    // The reading worker reads the two queued readings and leaves a waiting intake pass alone.
    await db.insert(schema.processingJobs).values(intakeJob(later.versionId));
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result.processed).toBe(2);
    expect(calls.extract).toBe(2);
    expect(await statusOf(later.versionId, `${later.versionId}:INTAKE:1`)).toBe('PENDING');
  });
});

describe('the automatic reading job', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('reads a scanned image with AI OCR first, then reads details from that text', async () => {
    const reader = await seedReader(db, 'scan@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports, calls } = countingPorts();
    await runIntake(db, reader.versionId, noTextExtractor);

    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result).toEqual({ processed: 1, stopped: 0, failed: 0 });
    expect(calls).toMatchObject({ render: 1, ocr: 1, extract: 1, prepare: 1 });
    // The extraction was handed the text the OCR produced, not nothing.
    expect(calls.texts).toEqual([SCAN_TEXT]);

    const ocrRuns = await db.select().from(schema.ocrRuns);
    expect(ocrRuns).toHaveLength(1);
    expect(ocrRuns[0]).toMatchObject({ status: 'SUCCEEDED', applicantId: reader.applicantId });
    const proposals = await proposalsOf(db, reader.versionId);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe('PENDING');
    // Suggestions only: nothing reached the profile.
    expect(await db.select().from(schema.facts)).toHaveLength(0);
    expect((await jobsOf(db, reader.versionId))[0]).toMatchObject({
      status: 'DONE',
      errorCode: null,
    });
  });

  it('skips AI OCR when the file already has text, and reads that text', async () => {
    const reader = await seedReader(db, 'text@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports, calls } = countingPorts();
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    await runAiReadingWorker(db, scope(), ports);
    expect(calls).toMatchObject({ render: 0, ocr: 0, extract: 1 });
    expect(calls.texts).toEqual([LETTER_TEXT]);
  });

  it('records no document text in the audit trail or on the job row', async () => {
    const reader = await seedReader(db, 'quiet@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports } = countingPorts();
    await runIntake(db, reader.versionId, noTextExtractor);
    await runAiReadingWorker(db, scope(), ports);
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_READING_JOB'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      method: 'SYSTEM',
      applicantId: reader.applicantId,
      resourceId: reader.versionId,
    });
    const everything = JSON.stringify([
      events,
      await jobsOf(db, reader.versionId),
      await db.select().from(schema.auditEvents),
    ]);
    expect(everything).not.toContain(SCAN_TEXT);
    expect(everything).not.toContain('Eriksson');
  });

  it('stops a queued job when the owner withdraws consent before it runs', async () => {
    const reader = await seedReader(db, 'revoke@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports, calls } = countingPorts();
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    for (const type of ['AI_EXTRACTION', 'AI_OCR'] as const) {
      await setConsent(db, {
        actorAccountId: reader.accountId,
        accountId: reader.accountId,
        type,
        granted: false,
      });
    }
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result).toEqual({ processed: 0, stopped: 1, failed: 0 });
    expect(calls).toMatchObject({ extract: 0, ocr: 0 });
    expect((await jobsOf(db, reader.versionId))[0]).toMatchObject({
      status: 'DONE',
      errorCode: 'NO_CONSENT',
    });
    expect(await proposalsOf(db, reader.versionId)).toHaveLength(0);
  });

  it('reads text but not pictures when only the details switch is on, and says which is missing', async () => {
    const reader = await seedReader(db, 'detailsonly@example.com', {
      consents: ['CORE_PROCESSING', 'AI_EXTRACTION'],
      docType: 'HOTEL_BOOKING',
    });
    const { ports, calls } = countingPorts();
    await runIntake(db, reader.versionId, noTextExtractor);
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result.stopped).toBe(1);
    expect(calls).toMatchObject({ ocr: 0, extract: 0 });
    expect((await jobsOf(db, reader.versionId))[0]?.errorCode).toBe('NO_CONSENT');
  });

  it('stops at the platform kill switch, even for a job queued before it was thrown', async () => {
    const reader = await seedReader(db, 'kill@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports, calls } = countingPorts();
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    expect(await jobsOf(db, reader.versionId)).toHaveLength(1);
    await switchAiOff(db);
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result).toEqual({ processed: 0, stopped: 1, failed: 0 });
    // Nothing is even prepared for a provider: the job stops before it gets that far.
    expect(calls).toMatchObject({ extract: 0, ocr: 0, render: 0, prepare: 0 });
    expect((await jobsOf(db, reader.versionId))[0]?.errorCode).toBe('SWITCHED_OFF');
  });

  it('gives a clear "could not read" state when the spend limit is used up', async () => {
    const reader = await seedReader(db, 'budget@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports, calls } = countingPorts({ budgetLimitUnits: 0 });
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result).toEqual({ processed: 0, stopped: 1, failed: 0 });
    expect(calls.extract).toBe(0);
    expect((await jobsOf(db, reader.versionId))[0]).toMatchObject({
      status: 'DONE',
      errorCode: 'LIMIT_REACHED',
    });
  });

  it('tries again later when the provider is busy, instead of calling it a failure to read', async () => {
    const reader = await seedReader(db, 'busy@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports, calls } = countingPorts({ maxConcurrentCalls: 0 });
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result).toEqual({ processed: 0, stopped: 0, failed: 1 });
    expect(calls.extract).toBe(0);
    const job = (await jobsOf(db, reader.versionId))[0];
    expect(job).toMatchObject({ status: 'PENDING', errorCode: 'READING_FAILED' });
    expect(job?.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('leaves a protected kind of document to be read only on request, while its machine-readable lines still become suggestions', async () => {
    const reader = await seedReader(db, 'protected@example.com');
    const { ports, calls } = countingPorts();
    await runIntake(db, reader.versionId, extractorFor(PASSPORT_TEXT));
    expect(await jobsOf(db, reader.versionId)).toHaveLength(1);
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result.stopped).toBe(1);
    expect(calls).toMatchObject({ extract: 0, ocr: 0, render: 0 });
    expect((await jobsOf(db, reader.versionId))[0]?.errorCode).toBe('PROTECTED');
    expect(await proposalsOf(db, reader.versionId)).toHaveLength(8);
  });

  it('treats a kind nobody has named yet as protected, because it could be a passport', async () => {
    const reader = await seedReader(db, 'unknown@example.com');
    const { ports, calls } = countingPorts();
    await runIntake(db, reader.versionId, noTextExtractor);
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result.stopped).toBe(1);
    expect(calls).toMatchObject({ ocr: 0, render: 0, extract: 0 });
  });

  it('reads only the newest copy of a document', async () => {
    const reader = await seedReader(db, 'newest@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports, calls } = countingPorts();
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    await addDocumentVersion(db, {
      actorAccountId: reader.accountId,
      documentId: reader.documentId,
      bucket: 'QUARANTINE',
      objectKey: 'obj-newest-2',
    });
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result.processed).toBe(1);
    expect(calls.extract).toBe(0);
  });

  it('waits and tries again while the file is still being checked', async () => {
    const reader = await seedReader(db, 'early@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports, calls } = countingPorts();
    await db
      .update(schema.documentVersions)
      .set({ safetyStatus: 'CLEAN', processingStatus: 'EXTRACTING' })
      .where(eq(schema.documentVersions.id, reader.versionId));
    await db.insert(schema.processingJobs).values({
      documentVersionId: reader.versionId,
      jobType: 'INTAKE',
      processingVersion: 1,
      idempotencyKey: aiReadingIdempotencyKey(reader.versionId),
    });
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result).toEqual({ processed: 0, stopped: 0, failed: 1 });
    expect(calls.extract).toBe(0);
    expect((await jobsOf(db, reader.versionId))[0]?.status).toBe('PENDING');
  });

  it('acts only as the owner of the version, with that owner’s consent, whoever else has consent', async () => {
    const generous = await seedReader(db, 'generous@example.com', { docType: 'HOTEL_BOOKING' });
    const guarded = await seedReader(db, 'guarded@example.com', {
      consents: ['CORE_PROCESSING'],
      docType: 'HOTEL_BOOKING',
    });
    const { ports, calls } = countingPorts();
    await runIntake(db, generous.versionId, extractorFor(LETTER_TEXT));
    await runIntake(db, guarded.versionId, extractorFor(LETTER_TEXT));
    // A job for the guarded person's file is forced into the queue anyway.
    await db.insert(schema.processingJobs).values({
      documentVersionId: guarded.versionId,
      jobType: 'INTAKE',
      processingVersion: 1,
      idempotencyKey: aiReadingIdempotencyKey(guarded.versionId),
    });
    const result = await runAiReadingWorker(db, scope(), ports);
    expect(result).toEqual({ processed: 1, stopped: 1, failed: 0 });
    expect(calls.extract).toBe(1);

    expect(await proposalsOf(db, guarded.versionId)).toHaveLength(0);
    const mine = await proposalsOf(db, generous.versionId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.applicantId).toBe(generous.applicantId);
    const runs = await db.select().from(schema.aiExtractionRuns);
    expect(runs.map((r) => r.applicantId)).toEqual([generous.applicantId]);
    const aiEvents = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_EXTRACTION_RUN'));
    expect(aiEvents.map((e) => e.actorAccountId)).toEqual([generous.accountId]);
  });

  it('refuses a scope that was copied or invented rather than minted for this job', async () => {
    const reader = await seedReader(db, 'forged@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports, calls } = countingPorts();
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    const forged = { kind: 'system', job: 'process-ai-reading' } as never;
    await expect(runAiReadingWorker(db, forged, ports)).rejects.toThrow(/own job/);
    await expect(
      processAiReading(db, forged, ports, { documentVersionId: reader.versionId }),
    ).rejects.toThrow(/own job/);
    await expect(
      runAiReadingWorker(db, systemScopeForTest('process-erasure') as never, ports),
    ).rejects.toThrow(/own job/);
    expect(calls.extract).toBe(0);
    expect((await jobsOf(db, reader.versionId))[0]?.status).toBe('PENDING');
  });
});

describe('where the text for a reading came from', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('names the file’s own text, the private reader and the AI reading of the picture', async () => {
    const own = await seedReader(db, 'src-own@example.com', { docType: 'HOTEL_BOOKING' });
    await runIntake(db, own.versionId, extractorFor(LETTER_TEXT));
    expect(await getLatestReadableText(db, scope(), own.versionId, own.applicantId)).toEqual({
      text: LETTER_TEXT,
      source: 'embedded',
    });

    const priv = await seedReader(db, 'src-private@example.com', { docType: 'HOTEL_BOOKING' });
    await runIntake(db, priv.versionId, extractorFor(LETTER_TEXT, 'tesseract-private'));
    expect(
      (await getLatestReadableText(db, scope(), priv.versionId, priv.applicantId))?.source,
    ).toBe('private_ocr');

    const pic = await seedReader(db, 'src-ai@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports } = countingPorts();
    await runIntake(db, pic.versionId, noTextExtractor);
    expect(await getLatestReadableText(db, scope(), pic.versionId, pic.applicantId)).toBe(
      undefined,
    );
    await runAiReadingWorker(db, scope(), ports);
    expect(await getLatestReadableText(db, scope(), pic.versionId, pic.applicantId)).toEqual({
      text: SCAN_TEXT,
      source: 'ai_ocr',
    });
    // The buttons' own reader now sees the OCR text too (it used to stop at "no text yet").
    expect(await getLatestExtractedText(db, pic.versionId, pic.applicantId)).toBe(SCAN_TEXT);
  });

  it('answers nothing for a version that belongs to someone else', async () => {
    const a = await seedReader(db, 'bind-a@example.com', { docType: 'HOTEL_BOOKING' });
    const b = await seedReader(db, 'bind-b@example.com', { docType: 'HOTEL_BOOKING' });
    await runIntake(db, a.versionId, extractorFor(LETTER_TEXT));
    expect(await getLatestReadableText(db, scope(), a.versionId, b.applicantId)).toBe(undefined);
    expect(await getLatestExtractedText(db, a.versionId, b.applicantId)).toBe(undefined);
  });
});

describe('reports leave out rule-based readings', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('counts no AI attempt, spend or failure share for a passport read by its machine-readable lines', async () => {
    const reader = await seedReader(db, 'reports@example.com', { consents: ['CORE_PROCESSING'] });
    await runIntake(db, reader.versionId, extractorFor(PASSPORT_TEXT));
    // Even a rule-based run that carried a cost would not be reported as AI spend.
    await db.insert(schema.aiExtractionRuns).values({
      documentVersionId: reader.versionId,
      applicantId: reader.applicantId,
      status: 'SUCCEEDED',
      modelVersion: MRZ_TD3_MODEL_VERSION,
      promptVersion: MRZ_TD3_MODEL_VERSION,
      costUnits: 500,
    });
    expect(await countAiExtractionAttempts(db, reader.versionId)).toBe(0);
    expect(await totalAiCostUnits(db)).toBe(0);
    expect(await documentAiCostUnits(db, reader.versionId)).toBe(0);

    // A real AI run is counted as before.
    await db.insert(schema.aiExtractionRuns).values({
      documentVersionId: reader.versionId,
      applicantId: reader.applicantId,
      status: 'SUCCEEDED',
      modelVersion: 'm',
      promptVersion: 'p',
      costUnits: 7,
    });
    expect(await countAiExtractionAttempts(db, reader.versionId)).toBe(1);
    expect(await totalAiCostUnits(db)).toBe(7);
    expect(await documentAiCostUnits(db, reader.versionId)).toBe(7);
  });

  it('keeps rule-based readings out of the AI failure rate', async () => {
    const reader = await seedReader(db, 'rate@example.com', { consents: ['CORE_PROCESSING'] });
    await runIntake(db, reader.versionId, extractorFor(PASSPORT_TEXT));
    for (let i = 0; i < 8; i++) {
      await db.insert(schema.aiClassificationRuns).values({
        documentVersionId: reader.versionId,
        applicantId: reader.applicantId,
        status: i < 2 ? 'FAILED' : 'SUCCEEDED',
        modelVersion: 'm',
        promptVersion: 'p',
      });
    }
    const signals = await collectOperationalSignals(db, { now: new Date() });
    const breaker = signals.find((signal) => signal.key === 'ai_circuit_breaker');
    expect(breaker?.reading).toBe('2 of 8 AI runs in the last hour failed (25%)');
  });
});
