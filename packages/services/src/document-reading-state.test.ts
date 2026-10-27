import { isErr, isOk } from '@visastack/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import {
  LETTER_TEXT,
  PASSPORT_TEXT,
  countingPorts,
  extractorFor,
  freshDb,
  noTextExtractor,
  proposalsOf,
  runIntake,
  scope,
  seedReader,
  switchAiOff,
} from './ai-reading.test-support';
import type { Db } from './db';
import { deriveReadingState, listDocumentReadingStates } from './document-reading-state';
import { runAiReadingWorker } from './jobs';

/**
 * S6 (ADR 0019): the five states a file's reading can be in, and where each suggestion came from,
 * decided from records only.
 */

const facts = (over: Partial<Parameters<typeof deriveReadingState>[0]> = {}) => ({
  safetyStatus: 'CLEAN',
  processingStatus: 'AWAITING_REVIEW',
  pendingSuggestions: 0,
  decidedSuggestions: 0,
  ...over,
});

describe('deriveReadingState', () => {
  it('says Checking the File until the checks are done', () => {
    for (const processingStatus of ['UPLOADING', 'QUARANTINED', 'SCANNING', 'NORMALIZING']) {
      expect(deriveReadingState(facts({ processingStatus, safetyStatus: 'PENDING' })).stage).toBe(
        'checking',
      );
    }
  });

  it('says Reading the File while text is taken out or an automatic reading is queued or running', () => {
    expect(deriveReadingState(facts({ processingStatus: 'EXTRACTING' })).stage).toBe('reading');
    for (const status of ['PENDING', 'CLAIMED'] as const) {
      expect(
        deriveReadingState(facts({ readingJob: { status, errorCode: null } })).stage,
        status,
      ).toBe('reading');
    }
    // A queued reading outranks suggestions already there: more are coming.
    expect(
      deriveReadingState(
        facts({ pendingSuggestions: 3, readingJob: { status: 'PENDING', errorCode: null } }),
      ).stage,
    ).toBe('reading');
  });

  it('says We Found These Details while suggestions wait, and nothing once all are decided', () => {
    expect(deriveReadingState(facts({ pendingSuggestions: 2 })).stage).toBe('found');
    expect(deriveReadingState(facts({ decidedSuggestions: 2 })).stage).toBe('done');
    expect(
      deriveReadingState(facts({ processingStatus: 'APPROVED', pendingSuggestions: 1 })).stage,
    ).toBe('found');
  });

  it('says We Could Not Read This One when nothing was found, with the reason when there is one', () => {
    // Never tried (uploaded while reading was off) is not the same as tried and found nothing.
    expect(deriveReadingState(facts())).toEqual({ stage: 'could_not_read', reason: 'NOT_TRIED' });
    expect(deriveReadingState(facts({ readingJob: { status: 'DONE', errorCode: null } }))).toEqual({
      stage: 'could_not_read',
      reason: 'NOTHING_FOUND',
    });
    expect(
      deriveReadingState(facts({ readingJob: { status: 'DONE', errorCode: 'LIMIT_REACHED' } })),
    ).toEqual({ stage: 'could_not_read', reason: 'LIMIT_REACHED' });
    expect(
      deriveReadingState(facts({ readingJob: { status: 'FAILED', errorCode: 'READING_FAILED' } })),
    ).toEqual({ stage: 'could_not_read', reason: 'COULD_NOT_READ' });
    // A reason that is not one of the closed list is never passed on.
    expect(
      deriveReadingState(facts({ readingJob: { status: 'DONE', errorCode: 'surprise' } })),
    ).toEqual({ stage: 'could_not_read', reason: 'NOTHING_FOUND' });
  });

  it('says Needs Attention for a held, refused or failed file, whatever else is true', () => {
    for (const processingStatus of ['NEEDS_ATTENTION', 'FAILED', 'REJECTED']) {
      expect(deriveReadingState(facts({ processingStatus, pendingSuggestions: 1 })).stage).toBe(
        'needs_attention',
      );
    }
    expect(deriveReadingState(facts({ safetyStatus: 'QUARANTINED' })).stage).toBe(
      'needs_attention',
    );
  });
});

describe('listDocumentReadingStates', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function ownerAccess(reader: { accountId: string; applicantId: string }) {
    const access = await requireAccess(
      db,
      accountPrincipal(reader.accountId),
      'VIEW_METADATA',
      { applicantId: reader.applicantId },
      { purpose: 'self' },
    );
    if (!isOk(access)) throw new Error('access');
    return access.value;
  }

  it('reports each state from the real pipeline and says where each suggestion came from', async () => {
    const passport = await seedReader(db, 'state-passport@example.com', {
      consents: ['CORE_PROCESSING'],
    });
    await runIntake(db, passport.versionId, extractorFor(PASSPORT_TEXT));

    const typed = await seedReader(db, 'state-typed@example.com', { docType: 'HOTEL_BOOKING' });
    const scan = await seedReader(db, 'state-scan@example.com', { docType: 'HOTEL_BOOKING' });
    const { ports } = countingPorts();
    await runIntake(db, typed.versionId, extractorFor(LETTER_TEXT));
    await runIntake(db, scan.versionId, noTextExtractor);
    // Before the worker runs, both have a reading queued.
    const queued = await listDocumentReadingStates(await ownerAccess(typed), [typed.versionId]);
    expect(isOk(queued) && queued.value.states.get(typed.versionId)?.stage).toBe('reading');
    await runAiReadingWorker(db, scope(), ports);

    const passportStates = await listDocumentReadingStates(await ownerAccess(passport), [
      passport.versionId,
    ]);
    if (!isOk(passportStates)) throw new Error('states');
    expect(passportStates.value.states.get(passport.versionId)).toEqual({ stage: 'found' });
    const passportRun = (await proposalsOf(db, passport.versionId))[0]?.aiExtractionRunId ?? '';
    expect(passportStates.value.sourceOfRun.get(passportRun)).toBe('machine_readable');

    const typedStates = await listDocumentReadingStates(await ownerAccess(typed), [
      typed.versionId,
    ]);
    if (!isOk(typedStates)) throw new Error('states');
    expect(typedStates.value.states.get(typed.versionId)?.stage).toBe('found');
    const typedRun = (await proposalsOf(db, typed.versionId))[0]?.aiExtractionRunId ?? '';
    expect(typedStates.value.sourceOfRun.get(typedRun)).toBe('document_text');

    const scanStates = await listDocumentReadingStates(await ownerAccess(scan), [scan.versionId]);
    if (!isOk(scanStates)) throw new Error('states');
    const scanRun = (await proposalsOf(db, scan.versionId))[0]?.aiExtractionRunId ?? '';
    expect(scanStates.value.sourceOfRun.get(scanRun)).toBe('ai_image');
  });

  it('shows We Could Not Read This One with the reason when the reading was stopped', async () => {
    const reader = await seedReader(db, 'state-stopped@example.com', { docType: 'HOTEL_BOOKING' });
    await runIntake(db, reader.versionId, extractorFor(LETTER_TEXT));
    await switchAiOff(db);
    const { ports } = countingPorts();
    await runAiReadingWorker(db, scope(), ports);
    const result = await listDocumentReadingStates(await ownerAccess(reader), [reader.versionId]);
    if (!isOk(result)) throw new Error('states');
    expect(result.value.states.get(reader.versionId)).toEqual({
      stage: 'could_not_read',
      reason: 'SWITCHED_OFF',
    });
  });

  it('answers only for the traveller’s own file versions, and ignores anything that is not an id', async () => {
    const mine = await seedReader(db, 'state-mine@example.com', { docType: 'HOTEL_BOOKING' });
    const theirs = await seedReader(db, 'state-theirs@example.com', { docType: 'HOTEL_BOOKING' });
    await runIntake(db, mine.versionId, extractorFor(LETTER_TEXT));
    await runIntake(db, theirs.versionId, extractorFor(LETTER_TEXT));
    const result = await listDocumentReadingStates(await ownerAccess(mine), [
      mine.versionId,
      theirs.versionId,
      'not-an-id',
    ]);
    if (!isOk(result)) throw new Error('states');
    // A version of anyone else's is left out, as if it did not exist.
    expect([...result.value.states.keys()]).toEqual([mine.versionId]);
    expect([...result.value.sourceOfRun.keys()]).toEqual([]);
  });

  it('is refused to anyone who is not the owner', async () => {
    const reader = await seedReader(db, 'state-owner@example.com', { docType: 'HOTEL_BOOKING' });
    const stranger = await seedReader(db, 'state-stranger@example.com');
    const denied = await requireAccess(
      db,
      accountPrincipal(stranger.accountId),
      'VIEW_METADATA',
      { applicantId: reader.applicantId },
      { purpose: 'self' },
    );
    expect(isErr(denied)).toBe(true);
    // And a proof for one person never reads another's job rows.
    const own = await ownerAccess(stranger);
    const result = await listDocumentReadingStates(own, [reader.versionId]);
    if (!isOk(result)) throw new Error('states');
    expect(result.value.states.size).toBe(0);
  });
});
