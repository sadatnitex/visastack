/**
 * Journey J1 (individual intake), services layer, on a real migrated in-memory database.
 *
 * Covered: files arrive one per request under an upload receipt and are read on arrival; files
 * with a clear kind are associated (with a source-attributed profile proposal), deliberately
 * ambiguous ones stay unresolved in Needs One Decision; duplicates, a new-period statement, a
 * renewed passport and a corrected scan are each proposed as their own relation and nothing is
 * applied; proposals point back to the document and the exact line they came from and are never
 * approved silently; an accidental cross-person update is refused and an existing manual value
 * keeps its review (a difference becomes a conflict, never a silent overwrite); a protected kind
 * is recognised from a redacted excerpt only and never read in detail; an unknown kind is treated
 * as protected; an oversize or unreadable file is refused or flagged honestly.
 *
 * The 80-file queue (statuses per item, the 21st file, format limits in the browser) is in
 * apps/web/src/lib/umpe-journey-j1-import-queue.test.ts.
 *
 * Not exercisable below the browser (reported, not faked): real sign-in, the real upload route
 * and its virus scan, real AI provider calls (a counting stand-in answers here), and the live
 * deployment.
 *
 * Synthetic people and files only. Time is passed in, never waited for.
 */
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from '../access';
import { systemScopeForTest } from '../access/system-scope.test-support';
import { provisionAccount } from '../accounts';
import { type AiClassifyPort, approveProposal } from '../ai';
import { processAiReading } from '../ai-reading';
import { LIMITS, countingPorts } from '../ai-reading.test-support';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { registerDocumentWithVersion } from '../documents';
import type { DocumentConverterPort, ExtractionOutcome } from '../extraction';
import { type ContentLimitsPort, type MalwareScannerPort, processIntake } from '../intake';
import { editFact, registerFieldDefinitions } from '../profile';
import type { BlobStore, PutObjectInput, StorageBucket, StoredBytes } from '../storage';
import { listDocumentExceptions } from '../umpe-document-exceptions';
import { fileHeldFile, holdFamilyFile, listHeldFiles } from '../umpe-document-holds';
import {
  attachUploadIntent,
  claimUploadReceipt,
  completeUploadReceipt,
} from '../umpe-document-receipts';
import { reserveUpload } from '../uploads';

// The ICAO TD3 specimen (check digits valid) and a renewal for the same holder.
const OLD_PASSPORT =
  'PASSPORT\nP<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
const NEW_PASSPORT = `PASSPORT\nP<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\n${td3Line2('X12345678', '360101')}`;

function check(value: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charAt(i);
    const v = c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55;
    sum += v * (weights[i % 3] ?? 1);
  }
  return sum % 10;
}

function td3Line2(number: string, expiry: string): string {
  const num = number.padEnd(9, '<');
  const birth = '740812';
  const personal = 'ZE184226B<<<<<';
  const head = `${num}${check(num)}UTO${birth}${check(birth)}F${expiry}${check(expiry)}${personal}${check(personal)}`;
  const composite = `${num}${check(num)}${birth}${check(birth)}${expiry}${check(expiry)}${personal}${check(personal)}`;
  return `${head}${check(composite)}`;
}

const MARCH =
  'Statement of Account\nOpening Balance: 100\nClosing Balance: 200\nAccount Number: XXXX1234\nStatement Period: 01/03/2026 to 31/03/2026';
const APRIL =
  'Statement of Account\nOpening Balance: 200\nClosing Balance: 250\nAccount Number: XXXX1234\nStatement Period: 01/04/2026 to 30/04/2026';
const UNCLEAR = 'Some notes about a trip with no recognisable document wording at all.';
const WEAK = 'A letter that mentions an account number and an opening balance.';
const PASSPORT_NO = ['A', '1234', '5678'].join('');
const PROTECTED_PAGE = `Passport\nPassport No: ${PASSPORT_NO}\nHolder: Anna`;

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
const unreadable: DocumentConverterPort = {
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
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

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
          rationale: 'stand-in',
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

async function account(db: Db, email: string): Promise<string> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'AI_EXTRACTION', 'AI_OCR'] as const) {
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
  values: readonly (readonly [string, string])[],
) {
  for (const [fieldKey, value] of values) {
    const saved = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey,
      value,
      status: 'APPLICANT_CONFIRMED',
      method: 'MANUAL',
    });
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

describe('J1 individual intake', () => {
  let db: Db;
  let owner: string;
  let anna: string;
  let erik: string;
  let stranger: string;
  let strangersPerson: string;
  let factVersionsAfterSetup = 0;
  const docs = new Map<string, { documentId: string; versionId: string }>();
  let counter = 0;

  /** What the upload route does for one file: receipt, reservation, register, read. */
  async function arrive(
    label: string,
    text: string | DocumentConverterPort,
    options: { sha256?: string; fileName?: string } = {},
  ) {
    counter++;
    const proof = await proofFor(db, owner, { applicantId: anna });
    const claim = await claimUploadReceipt(proof, {
      uploadId: `${String(counter).padStart(8, '0')}-0000-4000-8000-0000000000a1`,
      originalFileName: options.fileName ?? `${label}.pdf`,
      now: new Date(Date.UTC(2026, 10, 3, 9, 0, counter)),
    });
    if (claim.kind !== 'claimed') throw new Error(`claim ${label}: ${claim.kind}`);
    const reservation = await reserveUpload(db, {
      accountId: owner,
      applicantId: anna,
      sizeBytes: 10,
    });
    if (!reservation.ok) throw new Error('reserve');
    await attachUploadIntent(proof, { ...claim, uploadIntentId: reservation.value.id });
    const created = await registerDocumentWithVersion(db, {
      actorAccountId: owner,
      applicantId: anna,
      originalName: 'document.pdf',
      automaticTitle: true,
      source: 'UPLOAD',
      bucket: 'QUARANTINE',
      objectKey: reservation.value.objectKey,
      sizeBytes: 10,
      sha256: options.sha256 ?? `j1-hash-${counter}`,
    });
    if (!created.ok) throw new Error(created.error.message);
    await completeUploadReceipt(proof, {
      ...claim,
      documentId: created.value.version.documentId,
      documentVersionId: created.value.version.id,
    });
    const converter = typeof text === 'string' ? extractorFor(text) : text;
    const read = await processIntake(db, cleanScanner, converter, withinLimits, {
      documentVersionId: created.value.version.id,
    });
    if (!read.ok) throw new Error(`intake ${label}`);
    const entry = {
      documentId: created.value.version.documentId,
      versionId: created.value.version.id,
    };
    docs.set(label, entry);
    return entry;
  }

  const doc = (label: string) => {
    const entry = docs.get(label);
    if (!entry) throw new Error(`no document ${label}`);
    return entry;
  };
  const relationOf = async (label: string) =>
    db
      .select()
      .from(schema.documentRelationProposals)
      .where(eq(schema.documentRelationProposals.documentId, doc(label).documentId));
  const factVersionCount = async () => (await db.select().from(schema.factVersions)).length;
  const documentRow = async (label: string) =>
    (
      await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, doc(label).documentId))
    )[0];
  async function aiRead(label: string, kind: ReturnType<typeof classifier>) {
    const { ports, calls } = countingPorts();
    const result = await processAiReading(
      db,
      systemScopeForTest('process-ai-reading'),
      { ...ports, classify: async () => ({ ai: kind.ai, limits: LIMITS }) },
      { documentVersionId: doc(label).versionId },
    );
    return { result, calls };
  }

  beforeAll(async () => {
    db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    await registerFieldDefinitions(db, [
      { key: 'given_name', dataType: 'text', sensitivity: 'STANDARD' },
      { key: 'family_name', dataType: 'text', sensitivity: 'STANDARD' },
      { key: 'date_of_birth', dataType: 'date', sensitivity: 'STANDARD' },
    ]);
    owner = await account(db, 'j1-owner@example.invalid');
    anna = await personOf(db, owner, 'Anna Eriksson');
    erik = await personOf(db, owner, 'Erik Eriksson');
    // Anna typed her own name by hand earlier: a manual value under her own review.
    await identity(db, owner, anna, [
      ['given_name', 'Anna'],
      ['family_name', 'Eriksson'],
      ['date_of_birth', '1974-08-12'],
    ]);
    await identity(db, owner, erik, [
      ['given_name', 'Erik'],
      ['family_name', 'Eriksson'],
      ['date_of_birth', '2015-03-04'],
    ]);
    stranger = await account(db, 'j1-stranger@example.invalid');
    strangersPerson = await personOf(db, stranger, 'Someone Else');
    factVersionsAfterSetup = await factVersionCount();
  }, 120_000);

  it('step 1: associates classifiable files and leaves deliberately ambiguous ones unresolved', async () => {
    await arrive('old-passport', OLD_PASSPORT);
    await arrive('march', MARCH);
    await arrive('unclear', UNCLEAR, { sha256: 'j1-same-bytes' });
    await arrive('weak', WEAK);
    const listed = await listDocumentExceptions(
      await proofFor(db, owner, { applicantId: anna }, 'VIEW_METADATA'),
    );
    const kindsFor = (label: string) =>
      listed.exceptions
        .filter((item) => item.documentId === doc(label).documentId)
        .map((item) => item.kind);
    // The confident statement is routine; the ambiguous files wait for one decision each.
    expect(kindsFor('march')).toEqual([]);
    expect(kindsFor('unclear')).toEqual(['unknown_type']);
    expect(kindsFor('weak')).toEqual(['low_confidence']);
    // An ambiguous file is never given a kind on its own.
    expect((await documentRow('unclear'))?.docType).toBeNull();
    expect((await documentRow('weak'))?.docType).toBeNull();
    // The passport is read from its machine-readable lines into proposals for Anna only.
    const proposals = await db
      .select()
      .from(schema.fieldProposals)
      .where(eq(schema.fieldProposals.documentVersionId, doc('old-passport').versionId));
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.applicantId === anna)).toBe(true);
  }, 120_000);

  it('step 2: splits a duplicate, a new period, a renewed passport and a corrected scan, applying none', async () => {
    await arrive('duplicate', UNCLEAR, { sha256: 'j1-same-bytes' });
    await arrive('april', APRIL);
    await arrive('new-passport', NEW_PASSPORT);
    await arrive('rescan', `${NEW_PASSPORT}\n`);
    const expected: readonly (readonly [string, string, string])[] = [
      ['duplicate', 'EXACT_DUPLICATE', 'unclear'],
      ['april', 'NEW_PERIOD', 'march'],
      ['new-passport', 'RENEWED', 'old-passport'],
      ['rescan', 'CORRECTED_SCAN', 'new-passport'],
    ];
    for (const [label, relation, related] of expected) {
      const rows = await relationOf(label);
      expect(rows, label).toHaveLength(1);
      expect(rows[0], label).toMatchObject({
        relation,
        relatedDocumentId: doc(related).documentId,
        status: 'PENDING',
      });
    }
    // Nothing applied: no earlier copy is marked as replaced, every file is kept.
    const all = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.applicantId, anna));
    expect(all).toHaveLength(8);
    expect(all.every((row) => row.supersededByDocumentId === null)).toBe(true);
  }, 120_000);

  it('step 3: proposals are source attributed and none becomes an approved fact on its own', async () => {
    const proposals = await db
      .select()
      .from(schema.fieldProposals)
      .where(eq(schema.fieldProposals.applicantId, anna));
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.status === 'PENDING')).toBe(true);
    const fromOld = proposals.filter((p) => p.documentVersionId === doc('old-passport').versionId);
    expect(fromOld.map((p) => p.fieldKey)).toEqual(
      expect.arrayContaining(['given_name', 'family_name', 'date_of_birth', 'passport_number']),
    );
    // Every reading cites a verified line that is really in the file it came from.
    const evidence = await db
      .select()
      .from(schema.evidenceLocations)
      .where(
        inArray(
          schema.evidenceLocations.fieldProposalId,
          fromOld.map((p) => p.id),
        ),
      );
    expect(evidence.length).toBe(fromOld.length);
    expect(evidence.every((e) => e.verified === true && OLD_PASSPORT.includes(e.snippet))).toBe(
      true,
    );
    // Negative: no silent approved facts. The profile has only what was typed by hand.
    expect(await factVersionCount()).toBe(factVersionsAfterSetup);
  }, 120_000);

  it('step 4: approving a differing value keeps the manual one under review as a conflict', async () => {
    const [givenName] = await db
      .select()
      .from(schema.fieldProposals)
      .where(eq(schema.fieldProposals.documentVersionId, doc('old-passport').versionId))
      .then((rows) => rows.filter((p) => p.fieldKey === 'given_name'));
    if (!givenName) throw new Error('given name proposal');
    expect(givenName.value).toBe('ANNA MARIA');
    const approved = await approveProposal(db, {
      actorAccountId: owner,
      proposalId: givenName.id,
    });
    expect(isOk(approved) && approved.value.version.status).toBe('CONFLICTED');
    const conflicts = await db.select().from(schema.conflicts);
    expect(conflicts).toHaveLength(1);
    // The manual value is still in the history, not overwritten.
    const manual = await db
      .select()
      .from(schema.factVersions)
      .where(eq(schema.factVersions.value, 'Anna'));
    expect(manual).toHaveLength(1);
  }, 120_000);

  it('negative: a proposal for Anna is never applied by someone else, nor to anyone else', async () => {
    const [familyName] = await db
      .select()
      .from(schema.fieldProposals)
      .where(eq(schema.fieldProposals.documentVersionId, doc('old-passport').versionId))
      .then((rows) => rows.filter((p) => p.fieldKey === 'family_name'));
    if (!familyName) throw new Error('family name proposal');
    const before = await factVersionCount();
    const refused = await approveProposal(db, {
      actorAccountId: stranger,
      proposalId: familyName.id,
    });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.code).toBe('forbidden');
    expect(await factVersionCount()).toBe(before);
    // Erik's profile has no fact from Anna's documents.
    const erikFacts = await db
      .select()
      .from(schema.facts)
      .where(eq(schema.facts.applicantId, erik));
    const erikVersions = await db
      .select()
      .from(schema.factVersions)
      .where(
        inArray(
          schema.factVersions.factId,
          erikFacts.map((f) => f.id),
        ),
      );
    expect(erikVersions.map((v) => v.value).sort()).toEqual(['2015-03-04', 'Erik', 'Eriksson']);
  }, 120_000);

  it('negative: a family file matching Anna is never filed under Erik or another account', async () => {
    const store = new MemoryStore();
    const held = await holdFamilyFile(
      await proofFor(db, owner, { applicantId: anna }),
      {
        storage: store,
        checks: { scanner: cleanScanner, contentLimits: withinLimits, virusScanner: false },
        converter: extractorFor(OLD_PASSPORT),
      },
      {
        uploadId: '9c9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f',
        originalFileName: 'family scan.pdf',
        bytes: new Uint8Array([37, 80, 68, 70, 45, 49, 7]),
        contentType: 'application/pdf',
        storedFileName: 'document.pdf',
      },
    );
    if (held.kind !== 'held') throw new Error(`hold: ${held.kind}`);
    const waiting = await listHeldFiles(
      await proofFor(db, owner, { applicantId: anna }, 'VIEW_METADATA'),
    );
    expect(waiting.files.find((f) => f.holdId === held.holdId)?.proposedApplicantId).toBe(anna);
    const wrong = await fileHeldFile(await proofFor(db, owner, { applicantId: erik }), {
      holdId: held.holdId,
      automatic: true,
    });
    expect(wrong.ok).toBe(false);
    const foreign = await fileHeldFile(
      await proofFor(db, stranger, { applicantId: strangersPerson }),
      { holdId: held.holdId },
    );
    expect(foreign.ok).toBe(false);
    const erikDocs = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.applicantId, erik));
    expect(erikDocs).toHaveLength(0);
    const theirs = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.applicantId, strangersPerson));
    expect(theirs).toHaveLength(0);
  }, 120_000);

  it('negative: a protected kind is recognised from a redacted excerpt only, never read in detail', async () => {
    await arrive('protected', PROTECTED_PAGE);
    const kind = classifier('PASSPORT', 0.97);
    const { result, calls } = await aiRead('protected', kind);
    expect(kind.sent).toHaveLength(1);
    expect(kind.sent[0]).not.toContain(PASSPORT_NO);
    expect(result.stopReason).toBe('PROTECTED');
    expect(calls.extract).toBe(0);
    expect(calls.ocr).toBe(0);
  }, 120_000);

  it('negative: an unknown kind is treated as protected and not read in detail', async () => {
    const kind = classifier('BANK_STATEMENT', 0.6);
    const { result, calls } = await aiRead('unclear', kind);
    expect(kind.sent).toHaveLength(1);
    expect(result.stopReason).toBe('PROTECTED');
    expect(calls.extract).toBe(0);
    expect((await documentRow('unclear'))?.docType).toBeNull();
  }, 120_000);

  it('step 5: a confident non-protected kind is read in detail into pending, attributed proposals', async () => {
    // Its own wording: a classification of the same excerpt would be answered from the cache.
    await arrive('hotel', 'A short note written on the back of a travel brochure.');
    const before = await factVersionCount();
    const kind = classifier('HOTEL_BOOKING', 0.95);
    const { result, calls } = await aiRead('hotel', kind);
    expect(kind.sent).toHaveLength(1);
    expect(result).toMatchObject({ outcome: 'READ', ranExtraction: true });
    expect(calls.extract).toBe(1);
    const proposals = await db
      .select()
      .from(schema.fieldProposals)
      .where(eq(schema.fieldProposals.documentVersionId, doc('hotel').versionId));
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.status === 'PENDING' && p.applicantId === anna)).toBe(true);
    expect(await factVersionCount()).toBe(before);
  }, 120_000);

  it('negative: an unsupported or unreadable file is refused or flagged honestly', async () => {
    const tooBig = await reserveUpload(db, {
      accountId: owner,
      applicantId: anna,
      sizeBytes: 10 * 1024 * 1024 * 1024,
    });
    expect(tooBig.ok).toBe(false);
    expect(!tooBig.ok && tooBig.error.message).toMatch(/upload limit/);
    await arrive('blank', unreadable);
    const listed = await listDocumentExceptions(
      await proofFor(db, owner, { applicantId: anna }, 'VIEW_METADATA'),
    );
    const kinds = listed.exceptions
      .filter((item) => item.documentId === doc('blank').documentId)
      .map((item) => item.kind);
    expect(kinds).toEqual(['no_readable_text']);
  }, 120_000);
});
