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
import { LIMITS, countingPorts } from './ai-reading.test-support';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { listNameVersions, renameDocument } from './document-naming';
import { registerDocumentWithVersion } from './documents';
import type { DocumentConverterPort, ExtractionOutcome } from './extraction';
import { type ContentLimitsPort, type MalwareScannerPort, processIntake } from './intake';
import { editFact, registerFieldDefinitions } from './profile';
import type { BlobStore, PutObjectInput, StorageBucket, StoredBytes } from './storage';
import { expiredOnArrival, hasReadableText, statementPeriodLabel } from './umpe-document-arrival';
import { dismissIntakeException, listDocumentExceptions } from './umpe-document-exceptions';
import {
  type PersonIdentity,
  discardHeldFile,
  fileHeldFile,
  holdFamilyFile,
  listHeldFiles,
  proposePerson,
  sweepHeldFiles,
} from './umpe-document-holds';
import { reserveUpload } from './uploads';

/**
 * UMPE G1 end to end on a real (in-memory) database: findings raised when a file is read (I14),
 * statement periods in names and manual titles kept (I08), the background kind suggestion (I07),
 * and the family batch with its Which Person? decision (I09). Synthetic fixtures only; time is
 * passed in, never waited for.
 */

// The ICAO TD3 specimen: check digits valid, expired 15 April 2012.
const EXPIRED_PASSPORT =
  'PASSPORT\nP<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10\n';
const MARCH =
  'Statement of Account\nOpening Balance: 100\nClosing Balance: 200\nAccount Number: XXXX1234\nStatement Period: 01/03/2026 to 31/03/2026';
const UNCLEAR = 'Some notes about a trip with no recognisable document wording at all.';

const cleanScanner: MalwareScannerPort = {
  name: 'test-scanner',
  version: '0.0.0',
  async scan() {
    return { safe: true };
  },
};
const unsafeScanner: MalwareScannerPort = {
  name: 'test-scanner',
  version: '0.0.0',
  async scan() {
    return { safe: false };
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
const failingExtractor: DocumentConverterPort = {
  async extract(): Promise<ExtractionOutcome> {
    return { ok: false, code: 'empty_content', message: 'nothing in it' };
  },
};

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
    return { keys: [...this.objects.keys()], nextCursor: null };
  }
}

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function account(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
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

/** Name and date of birth on a profile (kept unprotected here: the test registers the fields first). */
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
  applicantId: string,
  action: 'MANAGE' | 'VIEW_METADATA' = 'MANAGE',
) {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    action,
    { applicantId },
    { purpose: 'test' },
  );
  if (!access.ok) throw new Error('access');
  return access.value as never;
}

let keyCounter = 0;
async function upload(db: Db, accountId: string, applicantId: string, uploadedAt?: Date) {
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
    sha256: `g1-hash-${keyCounter}`,
  });
  if (!created.ok) throw new Error(created.error.message);
  if (uploadedAt) {
    await db
      .update(schema.documentVersions)
      .set({ createdAt: uploadedAt })
      .where(eq(schema.documentVersions.id, created.value.version.id));
  }
  return created.value;
}

async function read(db: Db, versionId: string, extractor: DocumentConverterPort) {
  const result = await processIntake(db, cleanScanner, extractor, withinLimits, {
    documentVersionId: versionId,
  });
  if (!result.ok) throw new Error(result.error.message);
}

describe('pure rules', () => {
  it('reads periods, readable text and expiry on arrival', () => {
    expect(statementPeriodLabel({ start: '2026-03-01', end: '2026-03-31' })).toBe('March 2026');
    expect(statementPeriodLabel({ start: '2026-03-05', end: '2026-04-04' })).toBe(
      '5 Mar 2026 to 4 Apr 2026',
    );
    expect(hasReadableText('   \n ..  ')).toBe(false);
    expect(hasReadableText(MARCH)).toBe(true);
    const added = new Date('2026-11-03T02:00:00Z');
    expect(expiredOnArrival('2026-11-02', added, 'Asia/Dhaka')).toBe(true);
    expect(expiredOnArrival('2026-11-03', added, 'Asia/Dhaka')).toBe(false);
    expect(expiredOnArrival(null, added, 'Asia/Dhaka')).toBe(false);
  });

  it('proposes a person only on a full, unrivalled match', () => {
    const anna: PersonIdentity = {
      applicantId: 'a',
      nameTokens: ['ANNA', 'ERIKSSON'],
      dateOfBirth: '1974-08-12',
    };
    const erik: PersonIdentity = {
      applicantId: 'e',
      nameTokens: ['ERIK', 'ERIKSSON'],
      dateOfBirth: '2015-03-04',
    };
    expect(proposePerson(EXPIRED_PASSPORT, [anna, erik])).toEqual({
      basis: 'NAME_AND_BIRTH_DATE',
      applicantId: 'a',
    });
    expect(
      proposePerson('Birth certificate. Name: Erik Eriksson. Date of birth: 04/03/2015', [
        anna,
        erik,
      ]),
    ).toEqual({
      basis: 'NAME_AND_BIRTH_DATE',
      applicantId: 'e',
    });
    // Twins: the same day and family name, so neither is guessed.
    const twin: PersonIdentity = {
      applicantId: 't',
      nameTokens: ['EMIL', 'ERIKSSON'],
      dateOfBirth: '2015-03-04',
    };
    expect(proposePerson('Name: Erik Eriksson. Born 04/03/2015', [anna, erik, twin])).toEqual({
      basis: 'CLOSE_MATCHES',
    });
    expect(proposePerson('A hotel booking with no person in it at all.', [anna, erik])).toEqual({
      basis: 'NO_MATCH',
    });
    expect(proposePerson(null, [anna, erik])).toEqual({ basis: 'NOT_READ' });
  });
});

describe('findings raised when a file is read (I14)', () => {
  let db: Db;
  let owner: string;
  let applicantId: string;
  beforeEach(async () => {
    db = await freshDb();
    owner = await account(db, 'g1-findings@example.invalid');
    applicantId = await personOf(db, owner, 'Anna Eriksson');
  });

  it('raises Expired on Arrival once for an expired passport, and Keep As It Is clears it', async () => {
    const doc = await upload(db, owner, applicantId);
    await read(db, doc.version.id, extractorFor(EXPIRED_PASSPORT));
    await read(db, doc.version.id, extractorFor(EXPIRED_PASSPORT));
    const rows = await db
      .select()
      .from(schema.documentIntakeExceptions)
      .where(eq(schema.documentIntakeExceptions.documentVersionId, doc.version.id));
    expect(rows.map((row) => row.kind)).toEqual(['EXPIRED_ON_ARRIVAL']);
    const listed = await listDocumentExceptions(
      await proofFor(db, owner, applicantId, 'VIEW_METADATA'),
    );
    const expired = listed.exceptions.filter((item) => item.kind === 'expired_on_arrival');
    expect(expired).toHaveLength(1);
    const first = expired[0];
    if (!first || first.kind !== 'expired_on_arrival') throw new Error('missing');
    const kept = await dismissIntakeException(await proofFor(db, owner, applicantId), {
      exceptionId: first.exceptionId,
    });
    expect(kept.ok).toBe(true);
    const again = await dismissIntakeException(await proofFor(db, owner, applicantId), {
      exceptionId: first.exceptionId,
    });
    expect(again.ok).toBe(false);
    const after = await listDocumentExceptions(
      await proofFor(db, owner, applicantId, 'VIEW_METADATA'),
    );
    expect(after.exceptions.some((item) => item.kind === 'expired_on_arrival')).toBe(false);
  });

  it('raises No Readable Text for a failed reading and lists it instead of Unknown Type', async () => {
    const doc = await upload(db, owner, applicantId);
    await read(db, doc.version.id, failingExtractor);
    const listed = await listDocumentExceptions(
      await proofFor(db, owner, applicantId, 'VIEW_METADATA'),
    );
    const kinds = listed.exceptions
      .filter((item) => item.documentId === doc.version.documentId)
      .map((item) => item.kind);
    expect(kinds).toEqual(['no_readable_text']);
  });

  it('never lets another person dismiss a finding', async () => {
    const doc = await upload(db, owner, applicantId);
    await read(db, doc.version.id, failingExtractor);
    const [row] = await db.select().from(schema.documentIntakeExceptions);
    const stranger = await account(db, 'g1-stranger@example.invalid');
    const strangersOwn = await personOf(db, stranger, 'Someone Else');
    const refused = await dismissIntakeException(await proofFor(db, stranger, strangersOwn), {
      exceptionId: row?.id ?? '',
    });
    expect(refused.ok).toBe(false);
  });
});

describe('names (I08)', () => {
  let db: Db;
  let owner: string;
  let applicantId: string;
  beforeEach(async () => {
    db = await freshDb();
    owner = await account(db, 'g1-names@example.invalid');
    applicantId = await personOf(db, owner, 'Anna Eriksson');
  });

  it('puts the statement period in the proposed name', async () => {
    const doc = await upload(db, owner, applicantId);
    await read(db, doc.version.id, extractorFor(MARCH));
    const names = await listNameVersions(db, doc.version.documentId);
    expect(
      names.some((name) => name.decision === 'PENDING' && name.proposedName.includes('March 2026')),
    ).toBe(true);
  });

  it('keeps a name the person gave and offers nothing over it', async () => {
    const doc = await upload(db, owner, applicantId);
    const access = await requireAccess(
      db,
      accountPrincipal(owner),
      'MANAGE',
      { documentId: doc.version.documentId },
      { purpose: 'test' },
    );
    if (!access.ok) throw new Error('access');
    const renamed = await renameDocument(access.value, { name: 'My March Bank Papers' });
    expect(renamed.ok).toBe(true);
    await read(db, doc.version.id, extractorFor(MARCH));
    const [stored] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, doc.version.documentId));
    expect(stored?.approvedName).toBe('My March Bank Papers');
    const names = await listNameVersions(db, doc.version.documentId);
    expect(names.filter((name) => name.decision === 'PENDING')).toHaveLength(0);
  });
});

describe('background kind suggestion (I07)', () => {
  function classifier() {
    let calls = 0;
    const ai: AiClassifyPort = {
      async classify() {
        calls += 1;
        return {
          ok: true,
          result: {
            suggestedType: 'BANK_STATEMENT',
            confidence: 0.9,
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
    return { ai, calls: () => calls };
  }

  async function setup(email: string, consents: readonly ('AI_EXTRACTION' | 'AI_OCR')[]) {
    const db = await freshDb();
    const owner = await account(db, email);
    for (const type of consents)
      await setConsent(db, { actorAccountId: owner, accountId: owner, type, granted: true });
    const applicantId = await personOf(db, owner, 'Anna Eriksson');
    const doc = await upload(db, owner, applicantId);
    await read(db, doc.version.id, extractorFor(UNCLEAR));
    return { db, owner, applicantId, doc };
  }

  it('with AI off makes no AI call and leaves the file as Unknown Type', async () => {
    const { db, owner, applicantId, doc } = await setup('g1-ai-off@example.invalid', []);
    const kind = classifier();
    const { ports, calls } = countingPorts();
    const result = await processAiReading(
      db,
      systemScopeForTest('process-ai-reading'),
      { ...ports, classify: async () => ({ ai: kind.ai, limits: LIMITS }) },
      { documentVersionId: doc.version.id },
    );
    expect(result.stopReason).toBe('NO_CONSENT');
    expect(kind.calls()).toBe(0);
    expect(calls.extract).toBe(0);
    const listed = await listDocumentExceptions(
      await proofFor(db, owner, applicantId, 'VIEW_METADATA'),
    );
    expect(listed.exceptions.map((item) => item.kind)).toEqual(['unknown_type']);
  });

  it('keeps a file of unknown kind protected while the platform switch says so: no AI call', async () => {
    const { db, doc } = await setup('g1-ai-protected@example.invalid', ['AI_EXTRACTION', 'AI_OCR']);
    const kind = classifier();
    const { ports } = countingPorts();
    const result = await processAiReading(
      db,
      systemScopeForTest('process-ai-reading'),
      { ...ports, classify: async () => ({ ai: kind.ai, limits: LIMITS }) },
      { documentVersionId: doc.version.id },
    );
    expect(result.stopReason).toBe('PROTECTED');
    expect(kind.calls()).toBe(0);
  });

  it('with consent asks once and lists a waiting Suggested Kind, never saved', async () => {
    const { db, owner, applicantId, doc } = await setup('g1-ai-on@example.invalid', [
      'AI_EXTRACTION',
      'AI_OCR',
    ]);
    // The platform owner has taken unknown kinds off the protected list.
    await db
      .insert(schema.documentProtectionSettings)
      .values({ scope: 'UNKNOWN_TYPE', key: 'unknown', restricted: false });
    const kind = classifier();
    const { ports } = countingPorts();
    const withKind = { ...ports, classify: async () => ({ ai: kind.ai, limits: LIMITS }) };
    await processAiReading(db, systemScopeForTest('process-ai-reading'), withKind, {
      documentVersionId: doc.version.id,
    });
    await processAiReading(db, systemScopeForTest('process-ai-reading'), withKind, {
      documentVersionId: doc.version.id,
    });
    expect(kind.calls()).toBe(1);
    const [stored] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, doc.version.documentId));
    expect(stored?.docType).toBeNull();
    const listed = await listDocumentExceptions(
      await proofFor(db, owner, applicantId, 'VIEW_METADATA'),
    );
    expect(listed.exceptions).toEqual([
      expect.objectContaining({
        kind: 'suggested_kind',
        documentId: doc.version.documentId,
        suggestedLabel: 'Bank Statement',
      }),
    ]);
  });
});

describe('family batch and Which Person? (I09)', () => {
  let db: Db;
  let owner: string;
  let anna: string;
  let erik: string;
  let store: MemoryStore;
  const checks = { scanner: cleanScanner, contentLimits: withinLimits, virusScanner: false };
  const PDF = new Uint8Array([37, 80, 68, 70, 45, 49]);

  beforeEach(async () => {
    db = await freshDb();
    owner = await account(db, 'g1-family@example.invalid');
    anna = await personOf(db, owner, 'Anna Eriksson');
    erik = await personOf(db, owner, 'Erik Eriksson');
    await identity(db, owner, anna, 'Anna', 'Eriksson', '1974-08-12');
    await identity(db, owner, erik, 'Erik', 'Eriksson', '2015-03-04');
    store = new MemoryStore();
  });

  const hold = async (uploadId: string, text: string, bytes = PDF) =>
    holdFamilyFile(
      await proofFor(db, owner, anna),
      { storage: store, checks, converter: extractorFor(text) },
      {
        uploadId,
        originalFileName: 'family scan.pdf',
        bytes: new Uint8Array([...bytes, uploadId.charCodeAt(0)]),
        contentType: 'application/pdf',
      },
    );

  const documentsOf = (applicantId: string) =>
    db.select().from(schema.documents).where(eq(schema.documents.applicantId, applicantId));

  it('files each document of a two-person batch only after its decision, under the chosen person', async () => {
    const first = await hold('1b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f', EXPIRED_PASSPORT);
    const second = await hold(
      '2b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f',
      'Birth certificate. Name: Erik Eriksson. Date of birth: 04/03/2015',
    );
    expect(first).toEqual(expect.objectContaining({ kind: 'held', basis: 'NAME_AND_BIRTH_DATE' }));
    expect(second).toEqual(expect.objectContaining({ kind: 'held', basis: 'NAME_AND_BIRTH_DATE' }));
    // Nothing is filed under anyone yet.
    expect(await documentsOf(anna)).toHaveLength(0);
    expect(await documentsOf(erik)).toHaveLength(0);
    const waiting = await listHeldFiles(await proofFor(db, owner, erik, 'VIEW_METADATA'));
    expect(waiting.files).toHaveLength(2);
    const byProposal = new Map(
      waiting.files.map((file) => [file.proposedApplicantId, file.holdId]),
    );
    const forErik = byProposal.get(erik);
    const forAnna = byProposal.get(anna);
    if (!forErik || !forAnna) throw new Error('proposals');

    const filed = await fileHeldFile(await proofFor(db, owner, erik), { holdId: forErik });
    expect(filed.ok).toBe(true);
    expect(await documentsOf(erik)).toHaveLength(1);
    expect(await documentsOf(anna)).toHaveLength(0);
    // Filed once only.
    const twice = await fileHeldFile(await proofFor(db, owner, anna), { holdId: forErik });
    expect(twice.ok).toBe(false);

    const filedAnna = await fileHeldFile(await proofFor(db, owner, anna), { holdId: forAnna });
    expect(filedAnna.ok).toBe(true);
    expect(await documentsOf(anna)).toHaveLength(1);
    expect(
      (await listHeldFiles(await proofFor(db, owner, anna, 'VIEW_METADATA'))).files,
    ).toHaveLength(0);
    // The reading is queued for the filed file, as for any upload.
    const jobs = await db
      .select()
      .from(schema.processingJobs)
      .where(
        eq(schema.processingJobs.documentVersionId, filed.ok ? filed.value.documentVersionId : ''),
      );
    expect(jobs).toHaveLength(1);
  });

  it('never files under a person of another account, and never shows the batch to them', async () => {
    const held = await hold('3b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f', EXPIRED_PASSPORT);
    if (held.kind !== 'held') throw new Error('hold');
    const stranger = await account(db, 'g1-other@example.invalid');
    const theirs = await personOf(db, stranger, 'Other Person');
    expect(
      (await listHeldFiles(await proofFor(db, stranger, theirs, 'VIEW_METADATA'))).files,
    ).toHaveLength(0);
    const refused = await fileHeldFile(await proofFor(db, stranger, theirs), {
      holdId: held.holdId,
    });
    expect(refused.ok).toBe(false);
    expect(await documentsOf(theirs)).toHaveLength(0);
    // And the stranger cannot get a proof for the owner's people at all.
    const denied = await requireAccess(
      db,
      accountPrincipal(stranger),
      'MANAGE',
      { applicantId: erik },
      { purpose: 'test' },
    );
    expect(denied.ok).toBe(false);
  });

  it('keeps two close matches held with nobody proposed', async () => {
    const emil = await personOf(db, owner, 'Emil Eriksson');
    await identity(db, owner, emil, 'Emil', 'Eriksson', '2015-03-04');
    const held = await hold(
      '4b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f',
      'Name: Erik Eriksson and Emil Eriksson. Born 04/03/2015',
    );
    expect(held).toEqual(expect.objectContaining({ kind: 'held', basis: 'CLOSE_MATCHES' }));
    const waiting = await listHeldFiles(await proofFor(db, owner, anna, 'VIEW_METADATA'));
    expect(waiting.files[0]?.proposedApplicantId).toBeNull();
    expect(await documentsOf(erik)).toHaveLength(0);
    expect(await documentsOf(emil)).toHaveLength(0);
  });

  it('answers a repeat with the same hold, refuses an unsafe file, and discards with its bytes', async () => {
    const id = '5b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f';
    const held = await hold(id, UNCLEAR);
    const again = await hold(id, UNCLEAR);
    if (held.kind !== 'held' || again.kind !== 'held') throw new Error('hold');
    expect(again.holdId).toBe(held.holdId);
    expect(again.replay).toBe(true);
    expect(store.objects.size).toBe(1);

    const unsafe = await holdFamilyFile(
      await proofFor(db, owner, anna),
      {
        storage: store,
        checks: { ...checks, scanner: unsafeScanner },
        converter: extractorFor(UNCLEAR),
      },
      {
        uploadId: '6b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f',
        bytes: new Uint8Array([9, 9, 9]),
        contentType: 'application/pdf',
      },
    );
    expect(unsafe.kind).toBe('refused');
    expect(store.objects.size).toBe(1);

    const discarded = await discardHeldFile(
      await proofFor(db, owner, anna),
      { storage: store },
      { holdId: held.holdId },
    );
    expect(discarded.ok).toBe(true);
    expect(store.objects.size).toBe(0);
    expect(
      (await listHeldFiles(await proofFor(db, owner, anna, 'VIEW_METADATA'))).files,
    ).toHaveLength(0);
  });

  it('sweeps holds left too long, with their bytes', async () => {
    const held = await hold('7b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f', UNCLEAR);
    if (held.kind !== 'held') throw new Error('hold');
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const swept = await sweepHeldFiles(db, systemScopeForTest('process-abandoned-uploads'), store, {
      now: later,
    });
    expect(swept.removed).toBe(1);
    expect(store.objects.size).toBe(0);
    const left = await db
      .select()
      .from(schema.documentPersonHolds)
      .where(and(eq(schema.documentPersonHolds.id, held.holdId)));
    expect(left).toHaveLength(0);
  });
});
