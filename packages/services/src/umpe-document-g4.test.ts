import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import type { AiClassifyPort } from './ai';
import { processAiReading } from './ai-reading';
import { aiReadingIdempotencyKey } from './ai-reading-job';
import { LIMITS, countingPorts } from './ai-reading.test-support';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { executeAccountDeletion, requestAccountDeletion } from './deletion';
import { renameDocument } from './document-naming';
import { decideDocumentSuggestion } from './document-suggestion';
import { registerDocumentWithVersion } from './documents';
import type { DocumentConverterPort, ExtractionOutcome } from './extraction';
import { type ContentLimitsPort, type MalwareScannerPort, processIntake } from './intake';
import { runNotificationWorker } from './notifications';
import type { EmailPort } from './ports';
import { editFact, registerFieldDefinitions } from './profile';
import type { BlobStore, PutObjectInput, StorageBucket, StoredBytes } from './storage';
import { listDocumentExceptions } from './umpe-document-exceptions';
import {
  HELD_FILE_REMINDER_EVENT,
  countHeldFiles,
  fileHeldFile,
  holdFamilyFile,
  returnAutoFiledHold,
  sweepHeldFiles,
} from './umpe-document-holds';
import {
  AUTO_PLACE_MIN_CONFIDENCE,
  RECOGNITION_EXCERPT_MAX_CHARS,
  buildRecognitionExcerpt,
  changeRecognisedKind,
  listAutoPlacements,
} from './umpe-document-recognition';
import { reserveUpload } from './uploads';

/**
 * UMPE G4 end to end on a real (in-memory) database: every file recognised from a redacted excerpt,
 * confident kinds placed with a one-step Change, detailed reading still protected (the same-pass
 * defect), a fresh reading after a kind decision, family files filed automatically on an exact
 * match, the 7-day reminder and erasure on account deletion. Synthetic fixtures only; time is
 * passed in, never waited for.
 */

const UNCLEAR = 'Some notes about a trip with no recognisable document wording at all.';
// Synthetic identity values, built so no real number appears anywhere.
const PASSPORT_NO = ['A', '1234', '5678'].join('');
const NATIONAL_ID = ['1990', '1234', '5678', '9'].join('');
const IBAN = 'GB82 WEST 1234 5698 7654 32';
const MRZ_2 = ['L898902C36UTO7408122F1204159ZE184226B', '<<<<<10'].join('');
const PERSONAL_PAGE = [
  'REPUBLIC OF UTOPIA',
  'Passport',
  `Passport No: ${PASSPORT_NO}`,
  `National ID ${NATIONAL_ID}`,
  'Date of issue 12/03/2020',
  'Account Number: 1234 5678 9012',
  `IBAN ${IBAN}`,
  'Contact anna.eriksson@example.invalid',
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  MRZ_2,
].join('\n');

const cleanScanner: MalwareScannerPort = {
  name: 'test-scanner',
  version: '0.0.0',
  async scan() {
    return { safe: true };
  },
};
const withinLimits: ContentLimitsPort = {
  name: 'test-content-limits',
  version: '0.0.0',
  async check() {
    return { withinLimits: true };
  },
};
function extractorFor(text: string): DocumentConverterPort {
  return {
    async extract(): Promise<ExtractionOutcome> {
      return {
        ok: true,
        result: {
          text,
          truncated: false,
          pageCount: 1,
          warnings: [],
          parserName: 'test-fixture',
          parserVersion: '1.0.0',
        },
      };
    },
  };
}

class MemoryStore implements BlobStore {
  readonly objects = new Map<string, StoredBytes>();
  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
  async listObjectKeys() {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function account(
  db: Db,
  email: string,
  consents: readonly ('AI_EXTRACTION' | 'AI_OCR')[] = [],
): Promise<string> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', ...consents] as const) {
    await setConsent(db, { actorAccountId: accountId, accountId, type, granted: true });
  }
  return accountId;
}

async function personOf(db: Db, accountId: string, displayName: string): Promise<string> {
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName,
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return applicant.value.id;
}

async function identity(
  db: Db,
  accountId: string,
  applicantId: string,
  given: string,
  family: string,
  birth: string,
) {
  await registerFieldDefinitions(db, [
    { key: 'given_name', dataType: 'text', sensitivity: 'STANDARD' },
    { key: 'family_name', dataType: 'text', sensitivity: 'STANDARD' },
    { key: 'date_of_birth', dataType: 'date', sensitivity: 'STANDARD' },
  ]);
  for (const [fieldKey, value] of [
    ['given_name', given],
    ['family_name', family],
    ['date_of_birth', birth],
  ] as const) {
    const saved = await editFact(db, { actorAccountId: accountId, applicantId, fieldKey, value });
    if (!saved.ok) throw new Error(`fact ${fieldKey}: ${saved.error.message}`);
  }
}

async function proofFor(
  db: Db,
  accountId: string,
  ref: { applicantId: string } | { documentId: string },
  action: 'MANAGE' | 'VIEW_METADATA' = 'MANAGE',
) {
  const access = await requireAccess(db, accountPrincipal(accountId), action, ref, {
    purpose: 'test',
  });
  if (!access.ok) throw new Error(`access: ${access.error.message}`);
  return access.value as never;
}

let keyCounter = 0;
async function upload(db: Db, accountId: string, applicantId: string) {
  const reservation = await reserveUpload(db, { accountId, applicantId, sizeBytes: 10 });
  if (!reservation.ok) throw new Error('reserve');
  keyCounter++;
  const created = await registerDocumentWithVersion(db, {
    actorAccountId: accountId,
    applicantId,
    originalName: 'document.pdf',
    automaticTitle: true,
    source: 'UPLOAD',
    bucket: 'QUARANTINE',
    objectKey: reservation.value.objectKey,
    sizeBytes: 10,
    sha256: `g4-hash-${keyCounter}`,
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

async function read(db: Db, versionId: string, text: string) {
  const result = await processIntake(db, cleanScanner, extractorFor(text), withinLimits, {
    documentVersionId: versionId,
  });
  if (!result.ok) throw new Error(result.error.message);
}

/** A classifier that answers one kind and remembers every text it was sent. */
function classifier(suggestedType: string, confidence: number) {
  const sent: string[] = [];
  const ai: AiClassifyPort = {
    async classify(input) {
      sent.push(input.text);
      return {
        ok: true,
        result: {
          suggestedType,
          confidence,
          rationale: 'the model explained itself',
          usage: {
            costUnits: 1,
            inputUnits: 1,
            outputUnits: 1,
            cachedUnits: 0,
            modelVersion: 'm',
            promptVersion: 'p1',
            schemaVersion: 's1',
            provider: 'openai',
            latencyMs: 1,
          },
        },
      };
    },
    classifyCacheKeyComponents: () => ({ model: 'm', promptVersion: 'c1', schemaVersion: 'cs1' }),
  };
  return { ai, sent };
}

async function readNow(db: Db, versionId: string, kind: ReturnType<typeof classifier>) {
  const { ports, calls } = countingPorts();
  const result = await processAiReading(
    db,
    systemScopeForTest('process-ai-reading'),
    { ...ports, classify: async () => ({ ai: kind.ai, limits: LIMITS }) },
    { documentVersionId: versionId },
  );
  return { result, calls };
}

async function unprotectUnknownKinds(db: Db) {
  await db
    .insert(schema.documentProtectionSettings)
    .values({ scope: 'UNKNOWN_TYPE', key: 'unknown', restricted: false });
}

const documentRow = async (db: Db, documentId: string) =>
  (await db.select().from(schema.documents).where(eq(schema.documents.id, documentId)))[0];

describe('the recognition excerpt', () => {
  it('removes identity, passport, account and machine-readable numbers and keeps the wording', () => {
    const excerpt = buildRecognitionExcerpt(PERSONAL_PAGE);
    expect(excerpt).toContain('Passport');
    expect(excerpt).toContain('REPUBLIC OF UTOPIA');
    expect(excerpt).toContain('12/03/2020');
    for (const secret of [
      PASSPORT_NO,
      NATIONAL_ID,
      '1234 5678 9012',
      '123456789012',
      'GB82',
      '9876',
      'anna.eriksson',
      'ERIKSSON<<ANNA',
      MRZ_2,
      'L898902C3',
    ]) {
      expect(excerpt).not.toContain(secret);
    }
    // No run of 4 or more digits survives except the date.
    const runs = excerpt.replace('12/03/2020', '').match(/\d{4,}/g);
    expect(runs).toBeNull();
  });

  it('removes every identifier on a line that names an account or holds an IBAN', () => {
    const mail = ['anna.eriksson', 'example.invalid'].join('@');
    const excerpt = buildRecognitionExcerpt(
      [
        `Account number: 1234 5678 9012 Email: ${mail}`,
        `IBAN ${IBAN} holder ${mail}`,
        `Card 4111 1111 1111 1111 ref ${'X'.repeat(42)}`,
      ].join('\n'),
    );
    expect(excerpt).not.toContain('eriksson');
    expect(excerpt).not.toContain('example.invalid');
    expect(excerpt).not.toContain('GB82');
    expect(excerpt).not.toContain('XXXXXXXXXX');
    expect(excerpt.match(/\d/g)).toBeNull();
    expect(excerpt).toContain('Account number');
    expect(excerpt).toContain('IBAN');
  });

  it('is bounded, whatever the length of the file', () => {
    const long = Array.from({ length: 5000 }, (_, i) => `Line ${i % 3} of a long letter`).join(
      '\n',
    );
    expect(buildRecognitionExcerpt(long).length).toBeLessThanOrEqual(RECOGNITION_EXCERPT_MAX_CHARS);
    expect(buildRecognitionExcerpt(null)).toBe('');
  });
});

describe('recognition and placement', () => {
  let db: Db;
  let owner: string;
  let anna: string;

  beforeEach(async () => {
    db = await freshDb();
    owner = await account(db, `g4-${keyCounter}@example.invalid`, ['AI_EXTRACTION', 'AI_OCR']);
    anna = await personOf(db, owner, 'Anna Eriksson');
  });

  it('places a passport recognised by the AI but never reads it in detail', async () => {
    const doc = await upload(db, owner, anna);
    await read(db, doc.version.id, `Passport\nPassport No: ${PASSPORT_NO}\nHolder: Anna`);
    const kind = classifier('PASSPORT', 0.97);
    const { result, calls } = await readNow(db, doc.version.id, kind);
    expect(kind.sent).toHaveLength(1);
    expect(kind.sent[0]).not.toContain(PASSPORT_NO);
    expect(result.stopReason).toBe('PROTECTED');
    expect(calls.extract).toBe(0);
    expect(calls.ocr).toBe(0);
    const stored = await documentRow(db, doc.version.documentId);
    expect(stored?.docType).toBe('PASSPORT');
    // Only the kind and its confidence are kept: never the model's explanation.
    const [proposal] = await db
      .select()
      .from(schema.documentTypeProposals)
      .where(eq(schema.documentTypeProposals.documentVersionId, doc.version.id));
    expect(proposal?.rationale).toBeNull();
    expect(proposal?.status).toBe('APPROVED');
  });

  it('never reads a file suggested as a protected kind in the same pass (the defect)', async () => {
    await unprotectUnknownKinds(db);
    const doc = await upload(db, owner, anna);
    await read(db, doc.version.id, UNCLEAR);
    // Not sure enough to place: the kind stays unknown, the suggestion waits.
    const kind = classifier('PASSPORT', 0.6);
    const { result, calls } = await readNow(db, doc.version.id, kind);
    expect(kind.sent).toHaveLength(1);
    expect(result.stopReason).toBe('PROTECTED');
    expect(calls.extract).toBe(0);
    expect((await documentRow(db, doc.version.documentId))?.docType).toBeNull();
  });

  it('makes no AI call without consent and keeps the file in the exceptions list', async () => {
    const other = await account(db, 'g4-no-consent@example.invalid');
    const person = await personOf(db, other, 'Erik Eriksson');
    const doc = await upload(db, other, person);
    await read(db, doc.version.id, UNCLEAR);
    const kind = classifier('HOTEL_BOOKING', 0.99);
    const { result, calls } = await readNow(db, doc.version.id, kind);
    expect(kind.sent).toHaveLength(0);
    expect(calls.extract).toBe(0);
    expect(result.stopReason).toBe('NO_CONSENT');
    const listed = await listDocumentExceptions(
      await proofFor(db, other, { applicantId: person }, 'VIEW_METADATA'),
    );
    expect(listed.exceptions.map((item) => item.kind)).toEqual(['unknown_type']);
  });

  it('keeps a low-confidence recognition as a proposal in Needs One Decision', async () => {
    const doc = await upload(db, owner, anna);
    await read(db, doc.version.id, UNCLEAR);
    const kind = classifier('HOTEL_BOOKING', (AUTO_PLACE_MIN_CONFIDENCE - 1) / 100);
    const { result, calls } = await readNow(db, doc.version.id, kind);
    expect(result.stopReason).toBe('PROTECTED');
    expect(calls.extract).toBe(0);
    expect((await documentRow(db, doc.version.documentId))?.docType).toBeNull();
    const listed = await listDocumentExceptions(
      await proofFor(db, owner, { applicantId: anna }, 'VIEW_METADATA'),
    );
    expect(listed.exceptions).toEqual([
      expect.objectContaining({ kind: 'suggested_kind', suggestedLabel: 'Hotel or Stay Booking' }),
    ]);
  });

  it('places a confident kind, reads an unprotected one, and Change restores kind and name', async () => {
    const doc = await upload(db, owner, anna);
    await read(db, doc.version.id, UNCLEAR);
    const before = await documentRow(db, doc.version.documentId);
    const kind = classifier('HOTEL_BOOKING', 0.95);
    const { result, calls } = await readNow(db, doc.version.id, kind);
    expect(result.outcome).toBe('READ');
    expect(calls.extract).toBe(1);
    const placed = await documentRow(db, doc.version.documentId);
    expect(placed?.docType).toBe('HOTEL_BOOKING');
    expect(placed?.approvedName).not.toBe(before?.approvedName);

    const shown = await listAutoPlacements(
      await proofFor(db, owner, { applicantId: anna }, 'VIEW_METADATA'),
    );
    expect(shown).toEqual([
      expect.objectContaining({
        documentId: doc.version.documentId,
        placement: 'KIND',
        kindLabel: 'Hotel or Stay Booking',
      }),
    ]);
    const placementId = shown[0]?.placementId ?? '';
    const changed = await changeRecognisedKind(
      await proofFor(db, owner, { documentId: doc.version.documentId }),
      { placementId },
    );
    expect(changed.ok).toBe(true);
    const restored = await documentRow(db, doc.version.documentId);
    expect(restored?.docType).toBeNull();
    expect(restored?.approvedName).toBe(before?.approvedName);
    const listed = await listDocumentExceptions(
      await proofFor(db, owner, { applicantId: anna }, 'VIEW_METADATA'),
    );
    expect(listed.exceptions.map((item) => item.kind)).toEqual(['suggested_kind']);
    // Never placed a second time.
    await readNow(db, doc.version.id, kind);
    expect((await documentRow(db, doc.version.documentId))?.docType).toBeNull();
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'DOCUMENT_AUTOMATIC_PLACEMENT_CHANGED'));
    expect(audit).toHaveLength(1);
  });

  it('never overwrites a name the person chose', async () => {
    const doc = await upload(db, owner, anna);
    await read(db, doc.version.id, UNCLEAR);
    const renamed = await renameDocument(
      await proofFor(db, owner, { documentId: doc.version.documentId }),
      { name: 'My Own Name' },
    );
    expect(renamed.ok).toBe(true);
    await readNow(db, doc.version.id, classifier('HOTEL_BOOKING', 0.95));
    const stored = await documentRow(db, doc.version.documentId);
    expect(stored?.docType).toBe('HOTEL_BOOKING');
    expect(stored?.approvedName).toBe('My Own Name');
  });

  it('queues a fresh reading when a person accepts a suggested kind', async () => {
    const doc = await upload(db, owner, anna);
    await read(db, doc.version.id, UNCLEAR);
    await readNow(db, doc.version.id, classifier('HOTEL_BOOKING', 0.5));
    const key = aiReadingIdempotencyKey(doc.version.id);
    await db
      .update(schema.processingJobs)
      .set({ status: 'DONE', completedAt: new Date() })
      .where(eq(schema.processingJobs.idempotencyKey, key));
    const [proposal] = await db
      .select()
      .from(schema.documentTypeProposals)
      .where(eq(schema.documentTypeProposals.documentVersionId, doc.version.id));
    const accepted = await decideDocumentSuggestion(
      await proofFor(db, owner, { documentId: doc.version.documentId }),
      {
        decision: 'accept',
        nameVersionId: null,
        typeProposalId: proposal?.id ?? null,
        docType: 'HOTEL_BOOKING',
        name: 'Hotel Booking, Anna',
      },
    );
    expect(accepted.ok).toBe(true);
    const [job] = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.idempotencyKey, key));
    expect(job?.status).toBe('PENDING');
  });
});

describe('family files', () => {
  let db: Db;
  let owner: string;
  let anna: string;
  let erik: string;
  let store: MemoryStore;
  const checks = { scanner: cleanScanner, contentLimits: withinLimits, virusScanner: false };
  const PDF = new Uint8Array([37, 80, 68, 70, 45, 49]);
  // ICAO specimen: Anna Maria Eriksson, born 12 August 1974.
  const ANNA_PASSPORT =
    'PASSPORT\nP<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10\n';

  beforeEach(async () => {
    db = await freshDb();
    owner = await account(db, `g4-family-${keyCounter++}@example.invalid`);
    anna = await personOf(db, owner, 'Anna Eriksson');
    erik = await personOf(db, owner, 'Erik Eriksson');
    await identity(db, owner, anna, 'Anna', 'Eriksson', '1974-08-12');
    await identity(db, owner, erik, 'Erik', 'Eriksson', '2015-03-04');
    store = new MemoryStore();
  });

  const hold = async (uploadId: string, text: string, now?: Date) =>
    holdFamilyFile(
      await proofFor(db, owner, { applicantId: anna }),
      { storage: store, checks, converter: extractorFor(text), ...(now ? { now } : {}) },
      {
        uploadId,
        originalFileName: 'family scan.pdf',
        bytes: new Uint8Array([...PDF, uploadId.charCodeAt(0)]),
        contentType: 'application/pdf',
        storedFileName: 'document.pdf',
      },
    );

  it('files an exact unique match automatically, and Change puts it back to Which Person?', async () => {
    const held = await hold('2c9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f', ANNA_PASSPORT);
    if (held.kind !== 'held') throw new Error('not held');
    expect(held.basis).toBe('NAME_AND_BIRTH_DATE');
    // Proposed for Anna: filing it automatically under Erik is refused.
    const wrong = await fileHeldFile(await proofFor(db, owner, { applicantId: erik }), {
      holdId: held.holdId,
      automatic: true,
    });
    expect(wrong.ok).toBe(false);
    const filed = await fileHeldFile(await proofFor(db, owner, { applicantId: anna }), {
      holdId: held.holdId,
      automatic: true,
    });
    if (!filed.ok) throw new Error(filed.error.message);
    const shown = await listAutoPlacements(
      await proofFor(db, owner, { applicantId: anna }, 'VIEW_METADATA'),
    );
    expect(shown).toEqual([
      expect.objectContaining({ placement: 'PERSON', documentId: filed.value.documentId }),
    ]);
    expect(
      await countHeldFiles(await proofFor(db, owner, { applicantId: anna }, 'VIEW_METADATA')),
    ).toBe(0);

    const back = await returnAutoFiledHold(await proofFor(db, owner, { applicantId: anna }), {
      placementId: shown[0]?.placementId ?? '',
    });
    expect(back.ok).toBe(true);
    expect(await documentRow(db, filed.value.documentId)).toBeUndefined();
    const [row] = await db
      .select()
      .from(schema.documentPersonHolds)
      .where(eq(schema.documentPersonHolds.id, held.holdId));
    expect(row?.status).toBe('HELD');
    expect(row?.proposedApplicantId).toBeNull();
    expect(row?.originalFileName).toBe('family scan.pdf');
    expect(store.objects.has(row?.objectKey ?? '')).toBe(true);
    expect(
      await countHeldFiles(await proofFor(db, owner, { applicantId: erik }, 'VIEW_METADATA')),
    ).toBe(1);
  });

  it('refuses Change once the filed document was used, and keeps it filed', async () => {
    const held = await hold('6c9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f', ANNA_PASSPORT);
    if (held.kind !== 'held') throw new Error('not held');
    const filed = await fileHeldFile(await proofFor(db, owner, { applicantId: anna }), {
      holdId: held.holdId,
      automatic: true,
    });
    if (!filed.ok) throw new Error(filed.error.message);
    // Any record outside the document that points at it counts as use (here, a review).
    await db.insert(schema.documentReviews).values({
      documentId: filed.value.documentId,
      outcome: 'ACCEPTED',
      reviewedByAccountId: owner,
    });
    const [placement] = await listAutoPlacements(
      await proofFor(db, owner, { applicantId: anna }, 'VIEW_METADATA'),
    );
    const back = await returnAutoFiledHold(await proofFor(db, owner, { applicantId: anna }), {
      placementId: placement?.placementId ?? '',
    });
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.error.code).toBe('stale');
    expect(await documentRow(db, filed.value.documentId)).toBeDefined();
  });

  it('never files automatically for another account, and keeps two close matches held', async () => {
    const twin = await personOf(db, owner, 'Anna Eriksson Twin');
    await identity(db, owner, twin, 'Anna', 'Eriksson', '1974-08-12');
    const held = await hold('3c9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f', ANNA_PASSPORT);
    if (held.kind !== 'held') throw new Error('not held');
    expect(held.basis).toBe('CLOSE_MATCHES');
    const tried = await fileHeldFile(await proofFor(db, owner, { applicantId: anna }), {
      holdId: held.holdId,
      automatic: true,
    });
    expect(tried.ok).toBe(false);

    const stranger = await account(db, 'g4-stranger@example.invalid');
    const theirs = await personOf(db, stranger, 'Anna Eriksson');
    const foreign = await fileHeldFile(await proofFor(db, stranger, { applicantId: theirs }), {
      holdId: held.holdId,
      automatic: true,
    });
    expect(foreign.ok).toBe(false);
    const [row] = await db
      .select()
      .from(schema.documentPersonHolds)
      .where(eq(schema.documentPersonHolds.id, held.holdId));
    expect(row?.status).toBe('HELD');
  });

  it('reminds once after 7 days, and sends nothing once the file is filed', async () => {
    // Relative to the real clock: the reminders the worker finds are created with the database
    // clock, so a fixed date in the past makes "8 days later" fall behind them once it is old
    // enough (this test began to fail on 9 Nov 2026 for that reason alone).
    const start = new Date(Date.now() - 60 * 1000);
    const held = await hold('4c9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f', 'nothing useful', start);
    if (held.kind !== 'held') throw new Error('not held');
    const later = new Date(start.getTime() + 8 * 24 * 60 * 60 * 1000);
    const scope = systemScopeForTest('process-abandoned-uploads');
    expect((await sweepHeldFiles(db, scope, store, { now: later })).reminded).toBe(2);
    expect((await sweepHeldFiles(db, scope, store, { now: later })).reminded).toBe(0);
    const filed = await fileHeldFile(await proofFor(db, owner, { applicantId: erik }), {
      holdId: held.holdId,
    });
    expect(filed.ok).toBe(true);
    let sent = 0;
    const email: EmailPort = {
      async send() {
        sent += 1;
        return { providerMessageId: `m-${sent}` };
      },
    };
    await runNotificationWorker(db, email, 'https://app.example.invalid', { now: later });
    const notes = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.eventType, HELD_FILE_REMINDER_EVENT),
          eq(schema.notifications.resourceId, held.holdId),
        ),
      );
    expect(notes).toHaveLength(2);
    expect(notes.every((note) => note.status === 'CANCELLED')).toBe(true);
    expect(sent).toBe(0);
  });

  it('queues verified erasure of held files when the account is deleted', async () => {
    const held = await hold('5c9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f', 'nothing useful');
    if (held.kind !== 'held') throw new Error('not held');
    const [row] = await db
      .select()
      .from(schema.documentPersonHolds)
      .where(eq(schema.documentPersonHolds.id, held.holdId));
    const now = new Date();
    const requested = await requestAccountDeletion(db, {
      actorAccountId: owner,
      accountId: owner,
      gracePeriodMs: 0,
      now,
    });
    expect(requested.ok).toBe(true);
    const executed = await executeAccountDeletion(db, {
      accountId: owner,
      now: new Date(now.getTime() + 1000),
    });
    expect(executed.ok).toBe(true);
    const jobs = await db
      .select()
      .from(schema.erasureJobs)
      .where(eq(schema.erasureJobs.objectKey, row?.objectKey ?? ''));
    expect(jobs).toEqual([expect.objectContaining({ reason: 'ACCOUNT_DELETION' })]);
    expect(
      await db
        .select()
        .from(schema.documentPersonHolds)
        .where(eq(schema.documentPersonHolds.id, held.holdId)),
    ).toHaveLength(0);
  });
});
