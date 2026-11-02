import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { listNameVersions } from './document-naming';
import { registerDocumentWithVersion } from './documents';
import type { DocumentConverterPort, ExtractionOutcome } from './extraction';
import { type ContentLimitsPort, type MalwareScannerPort, processIntake } from './intake';
import { decideDocumentRelation, listDocumentExceptions } from './umpe-document-exceptions';
import {
  UPLOAD_CLAIM_STALE_MS,
  UPLOAD_REPLAY_WINDOW_MS,
  attachUploadIntent,
  claimUploadReceipt,
  completeUploadReceipt,
  releaseUploadReceipt,
} from './umpe-document-receipts';
import { reserveUpload } from './uploads';

/**
 * UMPE P3 end to end on a real (in-memory) database: upload receipts and idempotency (I16), the
 * private original file name, relations proposed by intake (I13), and the exceptions list with
 * the traveller's decision (I07, I11). Synthetic fixtures only. Time is passed in, never waited.
 */

// The ICAO TD3 specimen (check digits valid) and a renewal for the same holder: a new number and a
// later expiry, check digits computed for the synthetic values.
const OLD_PASSPORT =
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
const NEW_PASSPORT = td3Passport('X12345678', '360101');

function td3Passport(number: string, expiry: string): string {
  return `P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\n${td3Line2(number, expiry)}`;
}

/** ICAO 9303 check digit. */
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

/** The second TD3 line for the specimen holder with another number and expiry. */
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
// Two of the six bank statement signs: some signal, below the confidence a suggestion needs.
const WEAK = 'A letter that mentions an account number and an opening balance.';

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

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function person(db: Db, email: string, name = 'Anna Eriksson') {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: name,
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId, applicantId: applicant.value.id };
}

async function manage(db: Db, accountId: string, applicantId: string) {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { applicantId },
    {
      purpose: 'test',
    },
  );
  if (!access.ok) throw new Error('access');
  return access.value;
}

async function view(db: Db, accountId: string, applicantId: string) {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'self' },
  );
  if (!access.ok) throw new Error('access');
  return access.value;
}

let keyCounter = 0;

/** What the upload action does after a claim: reserve, register, then complete the receipt. */
async function storeUnderClaim(
  db: Db,
  owner: { accountId: string; applicantId: string },
  claim: { receiptId: string; claimToken: string } | null,
  options: { sha256?: string; complete?: boolean } = {},
) {
  const reservation = await reserveUpload(db, {
    accountId: owner.accountId,
    applicantId: owner.applicantId,
    sizeBytes: 10,
  });
  if (!reservation.ok) throw new Error('reserve');
  const proof = await manage(db, owner.accountId, owner.applicantId);
  if (claim) await attachUploadIntent(proof, { ...claim, uploadIntentId: reservation.value.id });
  keyCounter++;
  const created = await registerDocumentWithVersion(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    originalName: 'document.jpg',
    automaticTitle: true,
    source: 'UPLOAD',
    bucket: 'QUARANTINE',
    objectKey: reservation.value.objectKey,
    sizeBytes: 10,
    sha256: options.sha256 ?? `hash-${keyCounter}`,
  });
  if (!created.ok) throw new Error(created.error.message);
  if (claim && options.complete !== false) {
    await completeUploadReceipt(proof, {
      ...claim,
      documentId: created.value.version.documentId,
      documentVersionId: created.value.version.id,
    });
  }
  return created.value;
}

async function documentCount(db: Db, applicantId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.applicantId, applicantId));
  return rows.length;
}

const UPLOAD_ID = '0b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f';

describe('upload receipts: the same upload never stores a second copy (I16)', () => {
  let db: Db;
  let owner: { accountId: string; applicantId: string };
  beforeEach(async () => {
    db = await freshDb();
    owner = await person(db, 'p3-receipts@example.invalid');
  });

  it('answers a retried upload whose first answer was lost with the original document', async () => {
    const proof = await manage(db, owner.accountId, owner.applicantId);
    const t0 = new Date('2026-11-02T10:00:00Z');
    const first = await claimUploadReceipt(proof, {
      uploadId: UPLOAD_ID,
      originalFileName: 'bank_statement_march.pdf',
      now: t0,
    });
    expect(first.kind).toBe('claimed');
    if (first.kind !== 'claimed') return;
    const stored = await storeUnderClaim(db, owner, first);
    // The browser never heard back and sends the same file again with the same id.
    const again = await claimUploadReceipt(proof, {
      uploadId: UPLOAD_ID.toUpperCase(),
      now: new Date(t0.getTime() + 60_000),
    });
    expect(again).toEqual({
      kind: 'replay',
      documentId: stored.version.documentId,
      documentVersionId: stored.version.id,
      title: stored.document.approvedName,
      uploadIntentId: expect.any(String),
    });
    expect(await documentCount(db, owner.applicantId)).toBe(1);
  });

  it('tells a repeat that arrives while the first is still storing to wait', async () => {
    const proof = await manage(db, owner.accountId, owner.applicantId);
    const t0 = new Date('2026-11-02T10:00:00Z');
    expect((await claimUploadReceipt(proof, { uploadId: UPLOAD_ID, now: t0 })).kind).toBe(
      'claimed',
    );
    const during = await claimUploadReceipt(proof, {
      uploadId: UPLOAD_ID,
      now: new Date(t0.getTime() + UPLOAD_CLAIM_STALE_MS - 1),
    });
    expect(during).toEqual({ kind: 'in_progress', retryAfterSeconds: 1 });
    const early = await claimUploadReceipt(proof, { uploadId: UPLOAD_ID, now: t0 });
    expect(early).toEqual({
      kind: 'in_progress',
      retryAfterSeconds: UPLOAD_CLAIM_STALE_MS / 1000,
    });
  });

  it('finishes a crashed claim with the document it stored, never storing again', async () => {
    const proof = await manage(db, owner.accountId, owner.applicantId);
    const t0 = new Date('2026-11-02T10:00:00Z');
    const first = await claimUploadReceipt(proof, { uploadId: UPLOAD_ID, now: t0 });
    if (first.kind !== 'claimed') throw new Error('claim');
    // Registered, then the request died before completing its receipt.
    const stored = await storeUnderClaim(db, owner, first, { complete: false });
    const later = await claimUploadReceipt(proof, {
      uploadId: UPLOAD_ID,
      now: new Date(t0.getTime() + UPLOAD_CLAIM_STALE_MS + 1),
    });
    expect(later).toMatchObject({ kind: 'replay', documentId: stored.version.documentId });
    // The caller is handed the reservation, to finish what the crashed request may not have.
    expect(later.kind === 'replay' && later.uploadIntentId).toBeTruthy();
    expect(await documentCount(db, owner.applicantId)).toBe(1);
  });

  it('lets a crashed claim that stored nothing be taken over, fenced by its token', async () => {
    const proof = await manage(db, owner.accountId, owner.applicantId);
    const t0 = new Date('2026-11-02T10:00:00Z');
    const first = await claimUploadReceipt(proof, { uploadId: UPLOAD_ID, now: t0 });
    if (first.kind !== 'claimed') throw new Error('claim');
    const taken = await claimUploadReceipt(proof, {
      uploadId: UPLOAD_ID,
      now: new Date(t0.getTime() + UPLOAD_CLAIM_STALE_MS + 1),
    });
    expect(taken.kind).toBe('claimed');
    if (taken.kind !== 'claimed') return;
    expect(taken.claimToken).not.toBe(first.claimToken);
    // The old request can no longer complete or release the claim.
    expect(
      await completeUploadReceipt(proof, {
        ...first,
        documentId: '00000000-0000-4000-8000-000000000000',
        documentVersionId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toBe(false);
    await releaseUploadReceipt(proof, first);
    const still = await db.select().from(schema.documentUploadReceipts);
    expect(still).toHaveLength(1);
  });

  it('frees the id after a failed upload, so Try Again with the same id works', async () => {
    const proof = await manage(db, owner.accountId, owner.applicantId);
    const first = await claimUploadReceipt(proof, { uploadId: UPLOAD_ID });
    if (first.kind !== 'claimed') throw new Error('claim');
    await releaseUploadReceipt(proof, first);
    expect((await claimUploadReceipt(proof, { uploadId: UPLOAD_ID })).kind).toBe('claimed');
  });

  it('treats the id as new once the window has passed or the document was deleted', async () => {
    const proof = await manage(db, owner.accountId, owner.applicantId);
    const t0 = new Date('2026-11-02T10:00:00Z');
    const first = await claimUploadReceipt(proof, { uploadId: UPLOAD_ID, now: t0 });
    if (first.kind !== 'claimed') throw new Error('claim');
    const stored = await storeUnderClaim(db, owner, first);
    await db
      .update(schema.documentUploadReceipts)
      .set({ completedAt: t0 })
      .where(eq(schema.documentUploadReceipts.id, first.receiptId));
    const late = await claimUploadReceipt(proof, {
      uploadId: UPLOAD_ID,
      now: new Date(t0.getTime() + UPLOAD_REPLAY_WINDOW_MS + 1),
    });
    expect(late.kind).toBe('claimed');

    const second = await claimUploadReceipt(proof, {
      uploadId: '1b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f',
      now: t0,
    });
    if (second.kind !== 'claimed') throw new Error('claim');
    const kept = await storeUnderClaim(db, owner, second);
    await db.insert(schema.documentLifecycle).values({
      documentId: kept.version.documentId,
      applicantId: owner.applicantId,
      deletedAt: t0,
      deletedByAccountId: owner.accountId,
      deletePath: 'DUPLICATE',
      purgeAfter: new Date(t0.getTime() + 30 * 86_400_000),
    });
    const afterDelete = await claimUploadReceipt(proof, {
      uploadId: '1b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f',
      now: new Date(t0.getTime() + 1000),
    });
    expect(afterDelete.kind).toBe('claimed');
    expect(stored.version.documentId).not.toBe(kept.version.documentId);
  });

  it('never crosses people: an id already used for another traveller is refused', async () => {
    const proof = await manage(db, owner.accountId, owner.applicantId);
    await claimUploadReceipt(proof, { uploadId: UPLOAD_ID });
    const sibling = await createApplicant(db, {
      actorAccountId: owner.accountId,
      ownerAccountId: owner.accountId,
      displayName: 'Synthetic Sibling',
    });
    if (!isOk(sibling)) throw new Error('sibling');
    const siblingProof = await manage(db, owner.accountId, sibling.value.id);
    expect(await claimUploadReceipt(siblingProof, { uploadId: UPLOAD_ID })).toEqual({
      kind: 'conflict',
    });
  });

  it('keeps no receipt without a valid id, and keeps the file name cleaned and private', async () => {
    const proof = await manage(db, owner.accountId, owner.applicantId);
    expect(await claimUploadReceipt(proof, { uploadId: null })).toEqual({ kind: 'untracked' });
    expect(await claimUploadReceipt(proof, { uploadId: 'not-an-id' })).toEqual({
      kind: 'untracked',
    });
    await claimUploadReceipt(proof, {
      uploadId: UPLOAD_ID,
      originalFileName: `Family/Anna/${String.fromCodePoint(0x202e)}passport.jpg`,
    });
    const [row] = await db.select().from(schema.documentUploadReceipts);
    expect(row?.originalFileName).toBe('passport.jpg');
  });

  it('refuses a forged proof', async () => {
    const forged = { tx: db, applicant: { id: owner.applicantId } } as never;
    expect(await claimUploadReceipt(forged, { uploadId: UPLOAD_ID })).toEqual({ kind: 'conflict' });
    expect(await db.select().from(schema.documentUploadReceipts)).toHaveLength(0);
  });
});

describe('relations proposed by intake and decided by the traveller (I13, I07, I11)', () => {
  let db: Db;
  let owner: { accountId: string; applicantId: string };
  beforeEach(async () => {
    db = await freshDb();
    owner = await person(db, 'p3-relations@example.invalid');
  });

  async function addAndRead(text: string, options: { sha256?: string; fileName?: string } = {}) {
    const proof = await manage(db, owner.accountId, owner.applicantId);
    keyCounter++;
    const claim = await claimUploadReceipt(proof, {
      uploadId: `${String(keyCounter).padStart(8, '0')}-0000-4000-8000-000000000000`,
      originalFileName: options.fileName ?? null,
    });
    const stored = await storeUnderClaim(
      db,
      owner,
      claim.kind === 'claimed' ? claim : null,
      options.sha256 ? { sha256: options.sha256 } : {},
    );
    const processed = await processIntake(db, cleanScanner, extractorFor(text), withinLimits, {
      documentVersionId: stored.version.id,
    });
    if (!processed.ok) throw new Error('intake');
    return stored.version;
  }

  async function proposals() {
    return db.select().from(schema.documentRelationProposals);
  }

  it('proposes a renewal for a new passport of the same holder, and nothing is applied', async () => {
    const older = await addAndRead(OLD_PASSPORT);
    const newer = await addAndRead(NEW_PASSPORT);
    const [proposal, ...rest] = await proposals();
    expect(rest).toEqual([]);
    expect(proposal).toMatchObject({
      documentId: newer.documentId,
      relatedDocumentId: older.documentId,
      relation: 'RENEWED',
      newIsCurrent: true,
      status: 'PENDING',
    });
    const [oldRow] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, older.documentId));
    expect(oldRow?.supersededByDocumentId).toBeNull();

    // The older passport's kind was accepted; the new one's is not saved yet (the common case).
    await db
      .update(schema.documents)
      .set({ docType: 'PASSPORT' })
      .where(eq(schema.documents.id, older.documentId));
    // Confirming says the new file is a passport too, then asks Replace With a Newer Document
    // (with its own rules) to mark the older one as the Earlier Copy: both kept, nothing deleted.
    const decided = await decideDocumentRelation(
      await manage(db, owner.accountId, owner.applicantId),
      {
        proposalId: proposal?.id ?? '',
        decision: 'CONFIRM',
      },
    );
    expect(decided).toEqual({ ok: true, value: { status: 'CONFIRMED', replaced: true } });
    const [linked] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, older.documentId));
    expect(linked?.supersededByDocumentId).toBe(newer.documentId);
    const [newRow] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, newer.documentId));
    expect(newRow?.docType).toBe('PASSPORT');
    expect(await documentCount(db, owner.applicantId)).toBe(2);
  });

  it('proposes a corrected scan for the same passport scanned again', async () => {
    const older = await addAndRead(OLD_PASSPORT);
    const rescan = await addAndRead(`${OLD_PASSPORT}\n`);
    const [proposal] = await proposals();
    expect(proposal).toMatchObject({
      relation: 'CORRECTED_SCAN',
      relatedDocumentId: older.documentId,
    });

    // When the replace path refuses (here the new copy is being checked again), nothing is
    // recorded or marked, the reason comes back, and the suggestion can be answered later.
    await db
      .update(schema.documentVersions)
      .set({ processingStatus: 'SCANNING' })
      .where(eq(schema.documentVersions.id, rescan.id));
    const decided = await decideDocumentRelation(
      await manage(db, owner.accountId, owner.applicantId),
      {
        proposalId: proposal?.id ?? '',
        decision: 'CONFIRM',
      },
    );
    expect(decided).toMatchObject({ ok: false, error: { code: 'invalid' } });
    const [stillPending] = await proposals();
    expect(stillPending?.status).toBe('PENDING');
    const [kept] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, older.documentId));
    expect(kept?.supersededByDocumentId).toBeNull();
  });

  it('proposes a new period for the next month statement of the same account', async () => {
    const march = await addAndRead(MARCH);
    await addAndRead(APRIL);
    const [proposal] = await proposals();
    expect(proposal).toMatchObject({
      relation: 'NEW_PERIOD',
      relatedDocumentId: march.documentId,
      newIsCurrent: true,
    });
    expect(proposal?.signals).toEqual(['same_type', 'different_period', 'same_account']);
  });

  it('proposes an exact duplicate for the same bytes, and nothing for unrelated files', async () => {
    const original = await addAndRead(UNCLEAR, { sha256: 'same-bytes' });
    await addAndRead(MARCH);
    expect(await proposals()).toEqual([]);
    await addAndRead(UNCLEAR, { sha256: 'same-bytes' });
    const [proposal] = await proposals();
    expect(proposal).toMatchObject({
      relation: 'EXACT_DUPLICATE',
      relatedDocumentId: original.documentId,
    });
  });

  it('lists only the files needing one decision, and the decision records only that', async () => {
    const march = await addAndRead(MARCH);
    const april = await addAndRead(APRIL);
    const unclear = await addAndRead(UNCLEAR);
    const weak = await addAndRead(WEAK);
    const proof = await view(db, owner.accountId, owner.applicantId);
    const listed = await listDocumentExceptions(proof);
    const kinds = listed.exceptions.map((item) => [item.kind, item.documentId]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['relation', april.documentId],
        ['unknown_type', unclear.documentId],
        ['low_confidence', weak.documentId],
      ]),
    );
    // The confident March statement is routine: not listed on its own.
    expect(kinds).toHaveLength(3);
    expect(kinds.some(([, id]) => id === march.documentId)).toBe(false);

    const relation = listed.exceptions.find((item) => item.kind === 'relation');
    if (relation?.kind !== 'relation') throw new Error('relation');
    expect(relation.labels).toEqual({
      newDocument: 'New Period',
      relatedDocument: 'Earlier Period',
    });
    const decided = await decideDocumentRelation(
      await manage(db, owner.accountId, owner.applicantId),
      {
        proposalId: relation.proposalId,
        decision: 'CONFIRM',
      },
    );
    expect(decided).toEqual({ ok: true, value: { status: 'CONFIRMED', replaced: false } });
    // Decided once: a second answer finds nothing.
    const twice = await decideDocumentRelation(
      await manage(db, owner.accountId, owner.applicantId),
      {
        proposalId: relation.proposalId,
        decision: 'KEEP_SEPARATE',
      },
    );
    expect(twice.ok).toBe(false);
    const after = await listDocumentExceptions(proof);
    expect(after.exceptions.some((item) => item.kind === 'relation')).toBe(false);
    expect(after.confirmed).toHaveLength(1);
    expect(await documentCount(db, owner.applicantId)).toBe(4);
  });

  it('keeps the traveller decision and the file name out of every audit record', async () => {
    await addAndRead(MARCH, { fileName: 'Anna_Secret_Bank_March.pdf' });
    const april = await addAndRead(APRIL, { fileName: 'Anna_Secret_Bank_April.pdf' });
    const [proposal] = await proposals();
    if (!proposal) throw new Error('proposal');
    await decideDocumentRelation(await manage(db, owner.accountId, owner.applicantId), {
      proposalId: proposal.id,
      decision: 'KEEP_SEPARATE',
    });
    const audits = await db.select().from(schema.auditEvents);
    const decidedRow = audits.find((row) => row.eventType === 'DOCUMENT_RELATION_DECIDED');
    expect(decidedRow?.metadata).toEqual({
      relation: 'NEW_PERIOD',
      decision: 'DISMISSED',
      replaced: false,
    });
    expect(decidedRow?.resourceId).toBe(april.documentId);
    expect(JSON.stringify(audits)).not.toMatch(/Secret/i);
  });

  it('suggests a readable name from the file name only when the kind is unknown', async () => {
    const unclear = await addAndRead(UNCLEAR, { fileName: 'travel_insurance-policy.jpg' });
    const pending = async (documentId: string) =>
      (await listNameVersions(db, documentId))
        .filter((n) => n.decision === 'PENDING')
        .map((n) => n.proposedName);
    // A suggestion waiting for the person, never the saved name.
    expect(await pending(unclear.documentId)).toEqual(['Travel Insurance Policy.jpg']);
    const [row] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, unclear.documentId));
    expect(row?.approvedName).not.toContain('Travel');
    const camera = await addAndRead(UNCLEAR, { fileName: 'IMG_2041.jpg' });
    expect(await pending(camera.documentId)).toEqual([]);
  });

  it('drops a suggestion about a version that is no longer the latest', async () => {
    await addAndRead(MARCH);
    const april = await addAndRead(APRIL);
    const [proposal] = await proposals();
    if (!proposal) throw new Error('proposal');
    const object = await db
      .insert(schema.storageObjects)
      .values({ bucket: 'QUARANTINE', objectKey: 'p3-second-version' })
      .returning();
    await db.insert(schema.documentVersions).values({
      documentId: april.documentId,
      versionNumber: 2,
      storageObjectId: object[0]?.id ?? '',
    });
    const listed = await listDocumentExceptions(await view(db, owner.accountId, owner.applicantId));
    expect(listed.exceptions.some((item) => item.kind === 'relation')).toBe(false);
    const refused = await decideDocumentRelation(
      await manage(db, owner.accountId, owner.applicantId),
      { proposalId: proposal.id, decision: 'CONFIRM' },
    );
    expect(refused).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('never matches against an archived document', async () => {
    const original = await addAndRead(UNCLEAR, { sha256: 'archived-bytes' });
    await db.insert(schema.documentLifecycle).values({
      documentId: original.documentId,
      applicantId: owner.applicantId,
      archivedAt: new Date('2026-11-01T00:00:00Z'),
      archivedByAccountId: owner.accountId,
    });
    await addAndRead(UNCLEAR, { sha256: 'archived-bytes' });
    expect(await proposals()).toEqual([]);
  });

  it('lets only the traveller see and decide, and refuses a forged proof', async () => {
    await addAndRead(MARCH);
    await addAndRead(APRIL);
    const [proposal] = await proposals();
    if (!proposal) throw new Error('proposal');
    const forged = {
      tx: db,
      applicant: { id: owner.applicantId },
      actor: { kind: 'applicant_owner' },
    } as never;
    expect(await listDocumentExceptions(forged)).toEqual({ exceptions: [], confirmed: [] });
    const refused = await decideDocumentRelation(forged, {
      proposalId: proposal.id,
      decision: 'CONFIRM',
    });
    expect(refused.ok).toBe(false);
    const [still] = await db
      .select()
      .from(schema.documentRelationProposals)
      .where(and(eq(schema.documentRelationProposals.id, proposal.id)));
    expect(still?.status).toBe('PENDING');
  });
});
