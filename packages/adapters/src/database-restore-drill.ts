import { spawn } from 'node:child_process'; // supply-chain-allow: fixed psql and private recovery host only, no shell or inherited credentials.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { decryptBackup, parseBackupKey } from './backup-encryption';
import { R2_DOCUMENT_BUCKET, readR2Region, validateR2Endpoint } from './r2-storage';

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024;

export interface RecoveryManifest {
  objectKey: string;
  sha256: string;
  size: number;
  keyId: string;
  completedAt: string;
  codeSha: string;
  runId: string;
}

/** Reject arbitrary object paths, malformed commit markers and mismatched keys. */
export function validateRecoveryManifest(
  value: unknown,
  expectedKeyId: string,
  now = Date.now(),
): RecoveryManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid manifest');
  const m = value as Partial<RecoveryManifest> & {
    version?: unknown;
    scope?: unknown;
    restoreVerified?: unknown;
  };
  if (
    m.version !== 1 ||
    m.scope !== 'database-only' ||
    typeof m.restoreVerified !== 'boolean' ||
    typeof m.objectKey !== 'string' ||
    !/^database\/\d{4}-\d{2}-\d{2}T[0-9TZ-]+-\d+-\d+\.sql\.vsbk$/.test(m.objectKey) ||
    typeof m.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(m.sha256) ||
    typeof m.size !== 'number' ||
    !Number.isSafeInteger(m.size) ||
    m.size < 27 ||
    m.size > MAX_ARCHIVE_BYTES ||
    m.keyId !== expectedKeyId ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(expectedKeyId) ||
    typeof m.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(m.completedAt)) ||
    Date.parse(m.completedAt) > now + 5 * 60_000 ||
    typeof m.codeSha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(m.codeSha) ||
    typeof m.runId !== 'string' ||
    !/^\d+$/.test(m.runId)
  )
    throw new Error('Invalid manifest');
  return {
    objectKey: m.objectKey,
    sha256: m.sha256,
    size: m.size,
    keyId: expectedKeyId,
    completedAt: m.completedAt,
    codeSha: m.codeSha,
    runId: m.runId,
  };
}

/** Fixed isolated service only. Never accepts a URL or inherited PG settings. */
function recoveryPsql(): Record<string, string> {
  return {
    PATH: readEnv('PATH') ?? '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    PGHOST: 'recovery-postgres',
    PGPORT: '5432',
    PGDATABASE: 'vs_recovery',
    PGUSER: 'vs_restore',
    PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c statement_timeout=600000 -c lock_timeout=30000',
  };
}

async function psql(source: NodeJS.ReadableStream, capture = false): Promise<string> {
  const child = spawn(
    'psql',
    ['-X', '--set=ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align'],
    {
      env: recoveryPsql(),
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  child.stderr.resume(); // SQL errors may include private records, never log them.
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    if (capture && output.length < 4096) output += chunk.toString();
  });
  const completed = new Promise<void>((accept, reject) => {
    child.once('error', () => reject(new Error('Recovery client failed')));
    child.once('close', (code) =>
      code === 0 ? accept() : reject(new Error('Recovery SQL failed')),
    );
  });
  completed.catch(() => undefined);
  const timer = setTimeout(() => child.kill('SIGTERM'), 20 * 60_000);
  try {
    await Promise.all([pipeline(source, child.stdin), completed]);
    return output.trim();
  } finally {
    clearTimeout(timer);
    child.kill('SIGTERM');
  }
}

async function scalar(sql: string): Promise<string> {
  const { Readable } = await import('node:stream');
  return psql(Readable.from([sql]), true);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Recovery configuration missing');
  return value;
}

export async function runDatabaseRestoreDrill(): Promise<void> {
  if (readEnv('GITHUB_REF') !== 'refs/heads/main') throw new Error('Recovery requires main');
  const started = Date.now();
  const key = parseBackupKey(required('BACKUP_ENCRYPTION_KEY_BASE64'));
  const keyId = required('BACKUP_ENCRYPTION_KEY_ID');
  const client = new S3Client({
    region: readR2Region(),
    forcePathStyle: true,
    endpoint: validateR2Endpoint(required('R2_ENDPOINT_URL')),
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  let directory: string | undefined;
  try {
    // Verify the sandbox role before downloading or executing any backup bytes.
    const boundary = await scalar(
      "SELECT current_database() = 'vs_recovery' AND current_user = 'vs_restore' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication FROM pg_roles WHERE rolname = current_user;",
    );
    if (boundary !== 't') throw new Error('Recovery isolation check failed');
    directory = await mkdtemp(join(tmpdir(), 'visastack-db-drill-'));
    const archive = join(directory, 'encrypted.vsbk');
    const sql = join(directory, 'verified.sql');
    const response = await client.send(
      new GetObjectCommand({ Bucket: R2_DOCUMENT_BUCKET, Key: 'database/latest.json' }),
    );
    if (!response.Body || (response.ContentLength ?? Number.POSITIVE_INFINITY) > MAX_MANIFEST_BYTES)
      throw new Error('Invalid manifest');
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      if (bytes > MAX_MANIFEST_BYTES) throw new Error('Invalid manifest');
      chunks.push(Buffer.from(chunk));
    }
    const manifest = validateRecoveryManifest(JSON.parse(Buffer.concat(chunks).toString()), keyId);
    const object = await client.send(
      new GetObjectCommand({ Bucket: R2_DOCUMENT_BUCKET, Key: manifest.objectKey }),
    );
    if (!object.Body || object.ContentLength !== manifest.size)
      throw new Error('Archive size mismatch');
    const hash = createHash('sha256');
    let size = 0;
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > manifest.size) return callback(new Error('Archive size mismatch'));
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      object.Body as NodeJS.ReadableStream,
      verifier,
      createWriteStream(archive, { mode: 0o600, flags: 'wx' }),
    );
    if (size !== manifest.size || hash.digest('hex') !== manifest.sha256)
      throw new Error('Archive hash mismatch');
    const output = createWriteStream(sql, { mode: 0o600, flags: 'wx' });
    const { finished } = await import('node:stream/promises');
    const closed = finished(output);
    closed.catch(() => undefined);
    try {
      await decryptBackup(createReadStream(archive), output, key, keyId);
      await closed;
    } finally {
      output.destroy();
    }
    // Only authenticated whole-dump SQL reaches the restricted temporary role.
    await psql(createReadStream(sql));
    const schema = await scalar(
      "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('accounts','applicants','documents','audit_events','fact_versions','data_keys');",
    );
    if (schema !== '6') throw new Error('Recovered schema incomplete');
    const crypto = await scalar(
      "SELECT pgp_sym_decrypt(pgp_sym_encrypt('restore-drill-synthetic', 'temporary-synthetic-key'), 'temporary-synthetic-key') = 'restore-drill-synthetic';",
    );
    if (crypto !== 't') throw new Error('Recovered pgcrypto unavailable');
    const ended = Date.now();
    const report = {
      databaseRestoreVerified: true,
      fullDisasterRecoveryVerified: false,
      ciphertextHashVerified: true,
      authenticatedDecryption: true,
      restrictedRole: true,
      outboundDelivery: 'disabled-no-application-started',
      sourceRunId: manifest.runId,
      sourceCodeSha: manifest.codeSha,
      backupCompletedAt: manifest.completedAt,
      snapshotTime: 'not-recorded-in-v1-manifest',
      startedAt: new Date(started).toISOString(),
      completedAt: new Date(ended).toISOString(),
      elapsedSeconds: Math.ceil((ended - started) / 1000),
      backupAgeSecondsSinceCompletion: Math.max(
        0,
        Math.ceil((started - Date.parse(manifest.completedAt)) / 1000),
      ),
      remaining: [
        'document-object-recovery',
        'protected-field-key-recovery',
        'audit-checkpoint-verification',
        'deletion-tombstone-replay',
        'revocation-verification',
        'measured-end-to-end-rpo-rto',
      ],
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    const summaryPath = readEnv('GITHUB_STEP_SUMMARY');
    if (summaryPath) {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(
        summaryPath,
        `Database-only restore drill succeeded. Full disaster recovery remains unverified.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
      );
    }
  } finally {
    key.fill(0);
    client.destroy();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDatabaseRestoreDrill().catch(() => {
    process.stderr.write(
      'Isolated database restore drill failed. No production restore was attempted.\n',
    );
    process.exitCode = 1;
  });
}

function readEnv(name: string): string | undefined {
  return process.env[name];
}
