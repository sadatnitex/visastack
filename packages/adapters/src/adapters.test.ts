import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
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
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { verifyBlobToken } from './blob-token';
import { BuiltinContentLimitsChecker } from './content-limits';
import { NeonBlobStorage } from './neon-blob';
import { BasicSafetyScanner } from './scanner';
import { DeterministicTextExtractor } from './text-extraction';

const SECRET = 'test-signing-secret';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7 -- always rejected, see scanner.ts
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // real PNG signature
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ...

/** A genuinely valid minimal DOCX — the scanner now validates real OOXML structure, not just ZIP magic bytes. */
async function buildMinimalDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types/>',
  );
  zip.folder('word')?.file('document.xml', '<w:document/>');
  return zip.generateAsync({ type: 'uint8array' });
}

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

  it('rejects a file over the configured size limit, even one with valid magic bytes', async () => {
    const tinyLimitScanner = new BasicSafetyScanner({ blobStore: storage, maxBytes: 16 });
    const overLimit = new Uint8Array([...PDF, ...new Array(20).fill(0x20)]); // valid PDF prefix, padded past 16 bytes
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'oversized',
      contentType: 'application/pdf',
      bytes: overLimit,
    });
    const result = await tinyLimitScanner.scan({ bucket: 'QUARANTINE', objectKey: 'oversized' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('size limit');
  });

  it('accepts a real document type and rejects an executable / unknown', async () => {
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'ok',
      contentType: 'image/png',
      bytes: PNG,
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

  it('accepts a genuinely valid DOCX and plain TXT/MD content', async () => {
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: await buildMinimalDocx(),
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

  it('exposes its name and version, used to persist which scanner produced a result', () => {
    expect(scanner.name.length).toBeGreaterThan(0);
    expect(scanner.version.length).toBeGreaterThan(0);
  });

  it('rejects a zip-shaped upload that is not actually a valid DOCX (regression: a magic-byte match alone used to be accepted as "docx")', async () => {
    const zip = new JSZip();
    zip.folder('xl')?.file('workbook.xml', '<workbook/>');
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types/>',
    );
    const xlsxBytes = await zip.generateAsync({ type: 'uint8array' });
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'fake-docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: xlsxBytes,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'fake-docx' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('invalid docx structure');
  });

  it('rejects every PDF unconditionally, regardless of content -- magic-byte recognition never establishes safety', async () => {
    // A hand-rolled PDF content parser (active-content marker detection,
    // stream decoding, filter/predictor classification) was built, then
    // abandoned after accumulating 20 distinct correctness findings across
    // 8 review rounds without converging (see the post-programme defect
    // register). PDF content is no longer parsed at all: a plain, benign
    // PDF and one shaped to look actively malicious must both be rejected
    // identically, with a detail message that makes no claim about having
    // inspected content.
    const benignPdf = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF',
    );
    const activeLookingPdf = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj\n<< /OpenAction 2 0 R >>\nendobj\n2 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj\n%%EOF',
    );
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'benign-pdf',
      contentType: 'application/pdf',
      bytes: benignPdf,
    });
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'active-looking-pdf',
      contentType: 'application/pdf',
      bytes: activeLookingPdf,
    });
    const benignResult = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'benign-pdf' });
    const activeLookingResult = await scanner.scan({
      bucket: 'QUARANTINE',
      objectKey: 'active-looking-pdf',
    });
    expect(benignResult.safe).toBe(false);
    expect(activeLookingResult.safe).toBe(false);
    expect(benignResult.detail).toBe(activeLookingResult.detail);
    expect(benignResult.detail).not.toContain('active');
    expect(benignResult.detail).toContain('cannot be established');
  });

  it('admits a PDF only when the owner opted in, records that its content is unverified, and still refuses a spoofed one', async () => {
    const open = new BasicSafetyScanner({ blobStore: storage, allowPdf: true });
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'opted-in-pdf',
      contentType: 'application/pdf',
      bytes: PDF,
    });
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'spoofed-pdf',
      contentType: 'application/pdf',
      bytes: new TextEncoder().encode('MZ-not-a-pdf'),
    });
    const admitted = await open.scan({ bucket: 'QUARANTINE', objectKey: 'opted-in-pdf' });
    expect(admitted.safe).toBe(true);
    expect(admitted.detail).toContain('content unverified');
    expect((await open.scan({ bucket: 'QUARANTINE', objectKey: 'spoofed-pdf' })).safe).toBe(false);
    expect((await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'opted-in-pdf' })).safe).toBe(
      false,
    );
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
  let contentLimits: BuiltinContentLimitsChecker;
  beforeEach(async () => {
    db = await freshDb();
    storage = new NeonBlobStorage({ db, signingSecret: SECRET, baseUrl: 'https://app.example' });
    scanner = new BasicSafetyScanner({ blobStore: storage });
    extractor = new DeterministicTextExtractor({ blobStore: storage });
    contentLimits = new BuiltinContentLimitsChecker({
      blobStore: storage,
      config: { maxPdfPages: 50, maxImageMegapixels: 40 },
    });
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

  it('drives a real (benign-looking) PDF to NEEDS_ATTENTION through the real pipeline, exactly like an EXE -- never AWAITING_REVIEW/CLEAN', async () => {
    const pdfUpload = await upload('pdf@example.com', PDF);
    const exeUpload = await upload('exe@example.com', EXE);

    const pdfResult = await processIntake(db, scanner, extractor, contentLimits, {
      documentVersionId: pdfUpload,
    });
    expect(isOk(pdfResult)).toBe(true);
    if (isOk(pdfResult)) {
      expect(pdfResult.value.processingStatus).toBe('NEEDS_ATTENTION');
      expect(pdfResult.value.safetyStatus).toBe('QUARANTINED');
    }

    const exeResult = await processIntake(db, scanner, extractor, contentLimits, {
      documentVersionId: exeUpload,
    });
    expect(isOk(exeResult)).toBe(true);
    if (isOk(exeResult)) {
      expect(exeResult.value.processingStatus).toBe('NEEDS_ATTENTION');
      expect(exeResult.value.safetyStatus).toBe('QUARANTINED');
    }
  });

  it('never reaches the extraction step (never sent to OpenAI or any other extractor) for a rejected PDF -- NEEDS_ATTENTION is terminal', async () => {
    // A spy extractor: if the pipeline ever advances a rejected PDF's
    // version into EXTRACTING, this counts it. Whatever backs extraction in
    // production (local unpdf/mammoth, or an AI_ENABLED OpenAI-backed
    // extractor) is irrelevant here -- the claim under test is that
    // extraction is never REACHED at all for a document the scanner
    // quarantined, which is exactly what makes "sent to OpenAI" impossible
    // regardless of which extractor implementation is wired in.
    let extractCalls = 0;
    const spyExtractor = {
      async extract() {
        extractCalls++;
        return {
          ok: false as const,
          code: 'unsupported_format' as const,
          message: 'should not run',
        };
      },
    };
    const pdfUpload = await upload('spy-pdf@example.com', PDF);
    const result = await processIntake(db, scanner, spyExtractor, contentLimits, {
      documentVersionId: pdfUpload,
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.processingStatus).toBe('NEEDS_ATTENTION');
    expect(extractCalls).toBe(0);
  });
});
