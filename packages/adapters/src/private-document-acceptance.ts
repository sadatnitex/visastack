import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { schema } from '@visastack/db';
import type { Db } from '@visastack/services';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { ClamAvScanner } from './clamav-scanner';
import { R2Storage, R2_DOCUMENT_BUCKET, readR2Region, validateR2Endpoint } from './r2-storage';
import { DeterministicTextExtractor } from './text-extraction';
import { VercelPrivateBlobStorage } from './vercel-blob';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/** Valid synthetic PDF with no applicant details, executable content or attachments. */
export function cleanPdf(): Buffer {
  const stream = 'BT /F1 12 Tf 20 100 Td (VisaStack synthetic storage acceptance) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += 'xref\n0 6\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(`${text}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

async function main(): Promise<void> {
  if (required('GITHUB_REF') !== 'refs/heads/main') throw new Error('Acceptance requires main');
  const version = required('CLAMAV_ENGINE_VERSION');
  if (!version.startsWith('ClamAV ')) throw new Error('Scanner engine not verified');
  const token = required('BLOB_READ_WRITE_TOKEN');
  const endpoint = validateR2Endpoint(required('R2_ENDPOINT_URL'));
  const accessKeyId = required('R2_ACCESS_KEY_ID');
  const secretAccessKey = required('R2_SECRET_ACCESS_KEY');
  // No production database connection is opened. Only the real storage adapters
  // need this isolated metadata table to locate the two newly generated objects.
  const PGlite = createRequire(new URL('../../db/package.json', import.meta.url))(
    '@electric-sql/pglite',
  ).PGlite;
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const directR2 = new S3Client({
    endpoint,
    region: readR2Region(),
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 5000 },
  });
  const memory = new PGlite();
  try {
    await memory.query(`CREATE TABLE storage_objects (
    id uuid PRIMARY KEY, bucket text NOT NULL, object_key text UNIQUE NOT NULL,
    content_hash text, size_bytes bigint, created_at timestamptz DEFAULT now()
  )`);
    const db = drizzle(memory, { schema });
    const common = {
      db: db as unknown as Db,
      signingSecret: randomBytes(32).toString('hex'),
      baseUrl: 'https://vs.obsidianglobal.studio',
    };
    const legacy = new VercelPrivateBlobStorage({
      ...common,
      token,
    });
    const store = new R2Storage({
      ...common,
      endpoint,
      accessKeyId,
      secretAccessKey,
      legacy,
    });
    const scanner = new ClamAvScanner({
      blobStore: store,
      socketPath: '/var/run/clamav/clamd.ctl',
      engineVersion: version,
    });
    const controls = [
      { key: `synthetic-acceptance-${randomUUID()}`, bytes: cleanPdf(), type: 'application/pdf' },
      {
        key: `synthetic-acceptance-${randomUUID()}`,
        bytes: Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
        type: 'text/plain',
      },
    ] as const;
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    let stage = 'storage';
    let failure: string | undefined;
    let cleanupFailed = false;
    try {
      for (const control of controls) {
        await db.insert(schema.storageObjects).values({
          id: randomUUID(),
          bucket: 'QUARANTINE',
          objectKey: control.key,
          contentHash: hash(control.bytes),
          sizeBytes: control.bytes.length,
        });
        await store.putObject({
          bucket: 'QUARANTINE',
          objectKey: control.key,
          bytes: control.bytes,
          contentType: control.type,
        });
        const raw = await directR2.send(
          new GetObjectCommand({
            Bucket: R2_DOCUMENT_BUCKET,
            Key: `documents/quarantine/${control.key}`,
          }),
        );
        if (!raw.Body || raw.ContentLength !== control.bytes.length)
          throw new Error('Primary copy length mismatch');
        if (hash(await raw.Body.transformToByteArray()) !== hash(control.bytes))
          throw new Error('Primary copy mismatch');
        const primary = await store.getObject(control.key);
        const mirror = await legacy.getObject(control.key);
        if (
          !primary ||
          !mirror ||
          hash(primary.bytes) !== hash(control.bytes) ||
          hash(mirror.bytes) !== hash(control.bytes)
        )
          throw new Error('Copy mismatch');
      }
      stage = 'scanner';
      const safe = await scanner.scan({ bucket: 'QUARANTINE', objectKey: controls[0].key });
      const threat = await scanner.scan({ bucket: 'QUARANTINE', objectKey: controls[1].key });
      if (!safe.safe || threat.safe || !threat.detail?.includes('threat detected'))
        throw new Error('Scanner controls failed');
      stage = 'extraction';
      const extracted = await new DeterministicTextExtractor({ blobStore: store }).extract({
        bucket: 'QUARANTINE',
        objectKey: controls[0].key,
        originalName: 'synthetic.pdf',
      });
      if (
        !extracted.ok ||
        !extracted.result.text.includes('VisaStack synthetic storage acceptance')
      )
        throw new Error('PDF extraction failed');
    } catch {
      failure = stage;
    } finally {
      // Delete only this run's own opaque keys, never a bucket listing or user record.
      for (const control of controls) {
        try {
          await store.deleteObject('QUARANTINE', control.key);
          if (await legacy.getObject(control.key)) cleanupFailed = true;
          if (await store.getPendingUpload(control.key)) cleanupFailed = true;
          await db
            .delete(schema.storageObjects)
            .where(eq(schema.storageObjects.objectKey, control.key));
        } catch {
          cleanupFailed = true;
        }
      }
    }
    if (failure) throw new Error(`Synthetic document acceptance failed at ${failure}`);
    if (cleanupFailed) throw new Error('Synthetic document acceptance failed at cleanup');
    process.stdout.write(
      `${JSON.stringify({ realR2AndPrivateMirror: true, bothCopiesVerified: true, realScannerCleanPdf: true, realScannerThreatRejected: true, realPdfExtraction: true, ownSyntheticObjectsRemoved: true, productionDatabaseChanged: false })}\n`,
    );
  } finally {
    directR2.destroy();
    await memory.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    // Only errors generated here are surfaced; adapter/network errors can contain URLs.
    const message =
      error instanceof Error &&
      /^(Missing |Acceptance requires |Scanner engine not |Synthetic document acceptance failed at )/.test(
        error.message,
      )
        ? error.message
        : 'Private acceptance failed; inspect configuration and cleanup.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
