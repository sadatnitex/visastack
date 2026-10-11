import { spawn } from 'node:child_process'; // supply-chain-allow: fixed pg_dump with argument array, no shell, credentials only in the child environment.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { encryptBackup, parseBackupKey } from './backup-encryption';
import { R2_DOCUMENT_BUCKET, readR2Region, validateR2Endpoint } from './r2-storage';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export async function runDatabaseBackup(): Promise<void> {
  if (readEnv('GITHUB_REF') !== 'refs/heads/main') throw new Error('Backups require main');
  const connection = new URL(required('BACKUP_DATABASE_URL'));
  if (
    !['postgres:', 'postgresql:'].includes(connection.protocol) ||
    !connection.hostname.endsWith('.neon.tech') ||
    connection.hostname.includes('-pooler.')
  ) {
    throw new Error('BACKUP_DATABASE_URL must be a direct Neon database connection');
  }
  const database = decodeURIComponent(connection.pathname.slice(1));
  if (database !== required('BACKUP_EXPECTED_DATABASE'))
    throw new Error('Backup connection does not select the expected application database');
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
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const env = {
    PATH: readEnv('PATH') ?? '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    PGCONNECT_TIMEOUT: '15',
    PGHOST: connection.hostname,
    PGPORT: connection.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: '/etc/ssl/certs/ca-certificates.crt',
  };
  // The runner uses PostgreSQL 18's client, supporting Neon versions through 18.
  // Credentials are environment bindings, never command arguments or log output.
  const dump = spawn(
    'pg_dump',
    ['--format=plain', '--no-owner', '--no-privileges', '--lock-wait-timeout=30s'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  dump.stderr.resume();
  const completed = new Promise<void>((resolve, reject) => {
    dump.once('error', () => reject(new Error('pg_dump failed to start')));
    dump.once('close', (code) => (code === 0 ? resolve() : reject(new Error('pg_dump failed'))));
  });
  // Observe immediately while upload is running, including early process exits.
  completed.catch(() => undefined);
  const timeout = setTimeout(() => dump.kill('SIGTERM'), 20 * 60 * 1000);
  const name = `database/${new Date().toISOString().replace(/[:.]/g, '-')}-${required('GITHUB_RUN_ID')}-${required('GITHUB_RUN_ATTEMPT')}.sql.vsbk`;
  const encrypted = encryptBackup(dump.stdout, key, keyId);
  encrypted.done.catch(() => undefined);
  const hash = createHash('sha256');
  let size = 0;
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  const piping = pipeline(encrypted.stream, counted);
  piping.catch(() => undefined);
  const upload = new Upload({
    client,
    params: {
      Bucket: R2_DOCUMENT_BUCKET,
      Key: name,
      Body: counted,
      ContentType: 'application/octet-stream',
    },
    queueSize: 1,
    partSize: 5 * 1024 * 1024,
    leavePartsOnError: false,
  });
  try {
    await Promise.all([upload.done(), completed, encrypted.done, piping]);
    // A successful manifest is the commit marker. Failed/partial dump objects
    // never count as a completed backup even if an upload finished first.
    const manifest = {
      version: 1,
      objectKey: name,
      sha256: hash.digest('hex'),
      size,
      keyId,
      completedAt: new Date().toISOString(),
      codeSha: required('GITHUB_SHA'),
      runId: required('GITHUB_RUN_ID'),
      scope: 'database-only',
      restoreVerified: false,
    };
    await client.send(
      new PutObjectCommand({
        Bucket: R2_DOCUMENT_BUCKET,
        Key: `${name}.manifest.json`,
        Body: JSON.stringify(manifest),
        ContentType: 'application/json',
        IfNoneMatch: '*',
      }),
    );
    await client.send(
      new PutObjectCommand({
        Bucket: R2_DOCUMENT_BUCKET,
        Key: 'database/latest.json',
        Body: JSON.stringify(manifest),
        ContentType: 'application/json',
      }),
    );
    process.stdout.write('Encrypted database backup uploaded. Restore drill remains required.\n');
  } catch {
    dump.kill('SIGTERM');
    await upload.abort().catch(() => undefined);
    throw new Error('Database backup failed; no success manifest was recorded');
  } finally {
    clearTimeout(timeout);
    key.fill(0);
  }
}

/** Fixed diagnostics only. Provider errors may contain credentials or signed URLs. */
export function backupFailureMessage(error: unknown): string {
  const configurationMessages = [
    'Backups require main',
    'BACKUP_DATABASE_URL must be a direct Neon database connection',
    'Backup connection does not select the expected application database',
  ];
  const requiredNames = [
    'BACKUP_DATABASE_URL',
    'BACKUP_EXPECTED_DATABASE',
    'BACKUP_ENCRYPTION_KEY_BASE64',
    'BACKUP_ENCRYPTION_KEY_ID',
    'R2_ENDPOINT_URL',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_SHA',
  ];
  if (error instanceof Error) {
    for (const message of configurationMessages) {
      if (error.message === message) return `Database backup failed: ${message}.`;
    }
    for (const name of requiredNames) {
      if (error.message === `Missing ${name}`) return `Database backup failed: missing ${name}.`;
    }
  }
  return 'Database backup failed. Check secure configuration and provider access.';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runDatabaseBackup().catch((error: unknown) => {
    process.stderr.write(`${backupFailureMessage(error)}\n`);
    process.exitCode = 1;
  });

function readEnv(name: string): string | undefined {
  return process.env[name];
}
