import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import {
  type Db,
  addDocumentVersion,
  createApplicant,
  processIntake,
  provisionAccount,
  registerDocument,
  setConsent,
} from '@visastack/services';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { verifyBlobToken } from './blob-token';
import { NeonBlobStorage } from './neon-blob';
import { BasicSafetyScanner } from './scanner';
import { DeterministicTextExtractor } from './text-extraction';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));
const SECRET = 'test-signing-secret';

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ...

describe('NeonBlobStorage', () => {
  let db: Db;
  let storage: NeonBlobStorage;
  beforeEach(async () => {
    db = await freshDb();
    storage = new NeonBlobStorage({ db, signingSecret: SECRET, baseUrl: 'https://app.example' });
  });

  it('round-trips bytes through Postgres', async () => {
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'k1',
      contentType: 'application/pdf',
      bytes: PDF,
    });
    const got = await storage.getObject('k1');
    expect(got?.contentType).toBe('application/pdf');
    expect(got ? Array.from(got.bytes) : []).toEqual(Array.from(PDF));
  });

  it('issues a verifiable, expiring signed read reference', async () => {
    const ref = await storage.issueReadRef({
      bucket: 'CLEAN',
      objectKey: 'k2',
      disposition: 'preview',
      variant: 'redacted',
      expiresInSeconds: 300,
    });
    const url = new URL(ref.url);
    const fields = {
      objectKey: 'k2',
      disposition: url.searchParams.get('d') ?? '',
      variant: url.searchParams.get('v') ?? '',
      exp: Number(url.searchParams.get('exp')),
      sig: url.searchParams.get('sig') ?? '',
    };
    expect(verifyBlobToken(SECRET, fields)).toBe(true);
    // Tampered signature fails. Flip the last hex char deterministically so the
    // mutated value can never coincide with the original (the exp is time-based).
    const last = fields.sig.slice(-1);
    const tampered = `${fields.sig.slice(0, -1)}${last === '0' ? '1' : '0'}`;
    expect(verifyBlobToken(SECRET, { ...fields, sig: tampered })).toBe(false);
    // Expired token fails.
    expect(verifyBlobToken(SECRET, fields, (fields.exp + 1) * 1000)).toBe(false);
    // Wrong secret fails.
    expect(verifyBlobToken('other', fields)).toBe(false);
  });
});

describe('BasicSafetyScanner', () => {
  let db: Db;
  let storage: NeonBlobStorage;
  let scanner: BasicSafetyScanner;
  beforeEach(async () => {
    db = await freshDb();
    storage = new NeonBlobStorage({ db, signingSecret: SECRET, baseUrl: 'https://app.example' });
    scanner = new BasicSafetyScanner({ blobStore: storage });
  });

  it('accepts a real document type and rejects an executable / unknown', async () => {
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'ok',
      contentType: 'application/pdf',
      bytes: PDF,
    });
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'bad',
      contentType: 'application/octet-stream',
      bytes: EXE,
    });
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'junk',
      contentType: 'text/plain',
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'ok' })).safe).toBe(true);
    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'bad' })).safe).toBe(false);
    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'junk' })).safe).toBe(false);
    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'missing' })).safe).toBe(false);
  });

  it('accepts a DOCX (ZIP magic bytes) and plain TXT/MD content', async () => {
    const DOCX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: DOCX_MAGIC,
    });
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'txt',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('Bank Statement\nAccount Number: 12345\n'),
    });
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'md',
      contentType: 'text/markdown',
      bytes: new TextEncoder().encode('# Employment Certificate\n\nThis certifies employment.'),
    });

    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'docx' })).safe).toBe(true);
    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'txt' })).safe).toBe(true);
    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'md' })).safe).toBe(true);
  });

  it('rejects a shebang script even though it is otherwise plain text', async () => {
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'script',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('#!/bin/sh\nrm -rf /'),
    });
    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'script' })).safe).toBe(false);
  });

  it('rejects binary content with embedded NUL/control bytes as neither a known type nor text', async () => {
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'binary-junk',
      contentType: 'application/octet-stream',
      bytes: new Uint8Array([0x10, 0x00, 0x05, 0x02, 0x99, 0x01]),
    });
    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'binary-junk' })).safe).toBe(
      false,
    );
  });

  it('rejects HTML/SVG content declared under a spoofed content type, even though the bytes are clean UTF-8 text (stored-XSS regression)', async () => {
    // A caller that bypasses the file picker (a raw Server Action call) could
    // declare any content type it likes. HTML/SVG source is ordinary,
    // control-character-free UTF-8 text — indistinguishable from a real TXT/MD
    // file by content alone — so the plain-text path must gate on the
    // declared type, not just "does this decode as clean text".
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'html-xss',
      contentType: 'text/html',
      bytes: new TextEncoder().encode('<script>alert(document.cookie)</script>'),
    });
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'svg-xss',
      contentType: 'image/svg+xml',
      bytes: new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    });
    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'html-xss' })).safe).toBe(false);
    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'svg-xss' })).safe).toBe(false);
  });

  it('accepts a valid multi-byte UTF-8 TXT file larger than the old fixed sample size, with no truncation false-negative', async () => {
    // Regression for a boundary bug: decoding only a fixed-size prefix can
    // split a multi-byte UTF-8 sequence exactly at the cut, rejecting a
    // perfectly valid file. Build ASCII padding long enough to push a 3-byte
    // UTF-8 character ("é" is 2 bytes; use "字" — a 3-byte CJK character — to
    // straddle an 8192-byte boundary deterministically) across the old
    // sample-size boundary.
    const padding = 'A'.repeat(8190);
    const text = `${padding}字 - a valid non-ASCII bank statement footer.`;
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'large-utf8',
      contentType: 'text/plain',
      bytes: new TextEncoder().encode(text),
    });
    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'large-utf8' })).safe).toBe(true);
  });
});

describe('end-to-end: real bytes through the intake pipeline (no S3, no ClamAV)', () => {
  let db: Db;
  let storage: NeonBlobStorage;
  let scanner: BasicSafetyScanner;
  let extractor: DeterministicTextExtractor;
  beforeEach(async () => {
    db = await freshDb();
    storage = new NeonBlobStorage({ db, signingSecret: SECRET, baseUrl: 'https://app.example' });
    scanner = new BasicSafetyScanner({ blobStore: storage });
    extractor = new DeterministicTextExtractor({ blobStore: storage });
  });

  async function upload(email: string, bytes: Uint8Array) {
    const p = await provisionAccount(db, { email });
    if (!isOk(p)) throw new Error('provision');
    const account = p.value;
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName: 'Owner',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.value.id,
      originalName: 'p.pdf',
    });
    if (!isOk(doc)) throw new Error('doc');
    const objectKey = `obj-${email}`;
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey,
      contentType: 'application/pdf',
      bytes,
    });
    const version = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'QUARANTINE',
      objectKey,
      sizeBytes: bytes.byteLength,
    });
    if (!isOk(version)) throw new Error('version');
    return version.value.version.id;
  }

  it('drives a real PDF to AWAITING_REVIEW and an EXE to NEEDS_ATTENTION', async () => {
    const good = await upload('good@example.com', PDF);
    const bad = await upload('bad@example.com', EXE);

    const okResult = await processIntake(db, scanner, extractor, { documentVersionId: good });
    expect(isOk(okResult)).toBe(true);
    if (isOk(okResult)) {
      expect(okResult.value.processingStatus).toBe('AWAITING_REVIEW');
      expect(okResult.value.safetyStatus).toBe('CLEAN');
    }

    const badResult = await processIntake(db, scanner, extractor, { documentVersionId: bad });
    expect(isOk(badResult)).toBe(true);
    if (isOk(badResult)) {
      expect(badResult.value.processingStatus).toBe('NEEDS_ATTENTION');
      expect(badResult.value.safetyStatus).toBe('QUARANTINED');
    }
  });
});
