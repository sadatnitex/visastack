import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
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
import JSZip from 'jszip';
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

  it('rejects a PDF containing an active-content marker (embedded JavaScript)', async () => {
    const pdfWithJs = new TextEncoder().encode(
      '%PDF-1.7\n1 0 obj\n<< /OpenAction 2 0 R >>\nendobj\n2 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj\n%%EOF',
    );
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'active-pdf',
      contentType: 'application/pdf',
      bytes: pdfWithJs,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'active-pdf' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('active PDF content');
  });

  it('rejects a PDF whose active-content markers are hex-escaped (#XX name-object syntax) to dodge a plain substring search (Codex review, PR-B3, finding #9)', async () => {
    // Every marker below decodes to the real name once #XX is unescaped —
    // #41 = 'A', #53 = 'S' — none of them appear as a literal, matchable
    // substring anywhere in the raw bytes.
    const pdfWithEscapedMarkers = new TextEncoder().encode(
      '%PDF-1.7\n' +
        '1 0 obj\n<< /Open#41ction 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /S /Java#53cript /J#53 (app.alert(1)) /#41A << /O 3 0 R >> >>\nendobj\n' +
        '%%EOF',
    );
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'escaped-pdf',
      contentType: 'application/pdf',
      bytes: pdfWithEscapedMarkers,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'escaped-pdf' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('active PDF content');
  });

  it('rejects a PDF whose active-content marker only exists inside a FlateDecode-compressed stream (a compressed object stream hiding the real dictionary) (Codex review, PR-B3, finding #9)', async () => {
    const hiddenObjectStream = deflateSync(
      Buffer.from('6 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj\n', 'latin1'),
    );
    const compressedBytes = hiddenObjectStream.toString('latin1');
    const pdfWithCompressedMarker = Buffer.from(
      `%PDF-1.7\n3 0 obj\n<< /Type /ObjStm /N 1 /Filter /FlateDecode /Length ${hiddenObjectStream.length} >>\nstream\n${compressedBytes}\nendstream\nendobj\n%%EOF`,
      'latin1',
    );
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'compressed-marker-pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array(pdfWithCompressedMarker),
    });
    const result = await scanner.scan({
      bucket: 'QUARANTINE',
      objectKey: 'compressed-marker-pdf',
    });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('active PDF content');
  });

  it('accepts a PDF with a genuine FlateDecode content stream that decompresses cleanly with no active-content markers inside', async () => {
    const compressedContent = deflateSync(
      Buffer.from('BT /F1 24 Tf 100 100 Td (Hello) Tj ET', 'latin1'),
    );
    const contentBytes = compressedContent.toString('latin1');
    const pdfWithBenignStream = Buffer.from(
      `%PDF-1.7\n5 0 obj\n<< /Filter /FlateDecode /Length ${compressedContent.length} >>\nstream\n${contentBytes}\nendstream\nendobj\n%%EOF`,
      'latin1',
    );
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'benign-compressed-pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array(pdfWithBenignStream),
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'benign-compressed-pdf' });
    expect(result.safe).toBe(true);
  });

  it('rejects a PDF whose stream declares FlateDecode but is not actually valid compressed data — undecidable, not silently treated as clean (Codex review, PR-B3, finding #9)', async () => {
    const garbage = 'this is not zlib-compressed data at all, just plain garbage bytes';
    const pdfWithBrokenStream = new TextEncoder().encode(
      `%PDF-1.7\n7 0 obj\n<< /Filter /FlateDecode /Length ${garbage.length} >>\nstream\n${garbage}\nendstream\nendobj\n%%EOF`,
    );
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'broken-stream-pdf',
      contentType: 'application/pdf',
      bytes: pdfWithBrokenStream,
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'broken-stream-pdf' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('could not be verified clean');
  });

  it('treats hitting the PDF stream-scan cap while more streams remain as undecidable, not silently clean (Codex review, PR-B3, round 1)', async () => {
    // 200 tiny, uncompressed, genuinely benign streams (exhausting the scan
    // cap), followed by a 201st, FlateDecode-compressed stream whose only
    // content is an active-content marker. The direct byte search can't see
    // it (it's compressed); the stream-scan loop never reaches it either
    // (the cap is hit first) — the result must be undecidable, not "clean
    // because nothing was found in what we did look at."
    const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n', 'latin1')];
    for (let i = 0; i < 200; i++) {
      chunks.push(
        Buffer.from(`${i} 0 obj\n<< /Length 1 >>\nstream\nX\nendstream\nendobj\n`, 'latin1'),
      );
    }
    const compressed = deflateSync(
      Buffer.from('<< /S /JavaScript /JS (app.alert(1)) >>', 'latin1'),
    );
    chunks.push(
      Buffer.from(
        `201 0 obj\n<< /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
        'latin1',
      ),
      compressed,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    );
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'many-streams-pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array(Buffer.concat(chunks)),
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'many-streams-pdf' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('could not be verified clean');
  });

  it('detects an active-content marker inside a FlateDecode stream delimited by a lone CR, not CRLF or LF (Codex review, PR-B3, round 1)', async () => {
    const compressed = deflateSync(
      Buffer.from('<< /S /JavaScript /JS (app.alert(1)) >>', 'latin1'),
    );
    const pdf = Buffer.concat([
      Buffer.from(
        `%PDF-1.7\n3 0 obj\n<< /Filter /FlateDecode /Length ${compressed.length} >>\nstream\r`,
        'latin1',
      ),
      compressed,
      Buffer.from('\rendstream\nendobj\n%%EOF', 'latin1'),
    ]);
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'lone-cr-pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array(pdf),
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'lone-cr-pdf' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('active PDF content');
  });

  it('detects a FlateDecode declaration even when it sits behind a stream dictionary larger than any fixed lookback window (Codex review, PR-B3, round 1)', async () => {
    const compressed = deflateSync(
      Buffer.from('<< /S /JavaScript /JS (app.alert(1)) >>', 'latin1'),
    );
    // A 2500-byte PDF comment between /Filter and stream — well past the
    // old fixed 2000-byte lookback, which would have missed /Filter
    // entirely and treated this stream as plain, uncompressed content.
    const padding = `%${'x'.repeat(2500)}\n`;
    const pdf = Buffer.concat([
      Buffer.from(
        `%PDF-1.7\n3 0 obj\n<< /Filter /FlateDecode\n${padding}/Length ${compressed.length} >>\nstream\n`,
        'latin1',
      ),
      compressed,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ]);
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: 'far-filter-pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array(pdf),
    });
    const result = await scanner.scan({ bucket: 'QUARANTINE', objectKey: 'far-filter-pdf' });
    expect(result.safe).toBe(false);
    expect(result.detail).toContain('active PDF content');
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
