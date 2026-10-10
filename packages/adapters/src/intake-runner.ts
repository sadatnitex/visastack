import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPooledDb } from '@visastack/db';
import { type Db, loadUploadQuotaConfig, runIntakeWorker } from '@visastack/services';
import { ClamAvScanner, checkSignatureFreshness } from './clamav-scanner';
import { BuiltinContentLimitsChecker } from './content-limits';
import { R2Storage } from './r2-storage';
import { DeterministicTextExtractor } from './text-extraction';
import { VercelPrivateBlobStorage } from './vercel-blob';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/** No new queue or callback: reuse the durable intake pipeline and its fencing. */
export async function runIsolatedIntake(): Promise<void> {
  if (required('GITHUB_REF') !== 'refs/heads/main') throw new Error('Intake requires main');
  const connection = required('INTAKE_DATABASE_URL');
  const url = new URL(connection);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech'))
    throw new Error('Intake requires a Neon connection');
  const version = required('CLAMAV_ENGINE_VERSION');
  if (!version.startsWith('ClamAV ')) throw new Error('ClamAV version was not verified');
  const directory = '/var/lib/clamav';
  if (!(await checkSignatureFreshness(directory, 24 * 60 * 60 * 1000)).fresh)
    throw new Error('Scanner signatures are unavailable or stale');
  const { db, pool } = createPooledDb(connection);
  // Suppress driver errors containing connection details; exit status remains red.
  pool.on('error', () => {
    process.exitCode = 1;
  });
  try {
    const handle = db as unknown as Db;
    const common = {
      db: handle,
      // The worker never issues browser links and receives no production signing key.
      signingSecret: randomBytes(32).toString('hex'),
      baseUrl: 'https://vs.obsidianglobal.studio',
    };
    const legacy = new VercelPrivateBlobStorage({
      ...common,
      token: required('BLOB_READ_WRITE_TOKEN'),
    });
    const providerName = 'INTAKE_STORAGE_PROVIDER';
    const provider = process.env[providerName] || 'vercel_blob';
    if (provider !== 'vercel_blob' && provider !== 'r2')
      throw new Error('Unsupported intake storage provider');
    const storage =
      provider === 'r2'
        ? new R2Storage({
            ...common,
            endpoint: required('R2_ENDPOINT_URL'),
            accessKeyId: required('R2_ACCESS_KEY_ID'),
            secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
            legacy,
          })
        : legacy;
    const engine = new ClamAvScanner({
      blobStore: storage,
      socketPath: '/var/run/clamav/clamd.ctl',
      engineVersion: version,
      databaseDirectory: directory,
    });
    const scanner = {
      name: engine.name,
      version: engine.version,
      async scan(input: Parameters<typeof engine.scan>[0]) {
        const result = await engine.scan(input);
        if (
          /scanner (?:unavailable|degraded)|unrecognized response|clamav: scan error/.test(
            result.detail ?? '',
          )
        )
          throw new Error('Scanner unavailable; retry required');
        return result;
      },
    };
    const extractor = new DeterministicTextExtractor({ blobStore: storage });
    const limits = new BuiltinContentLimitsChecker({
      blobStore: storage,
      config: loadUploadQuotaConfig(),
    });
    let processed = 0;
    let failed = 0;
    // Claim one item at a time so later items cannot lose their five-minute leases.
    for (let pass = 0; pass < 10; pass++) {
      const result = await runIntakeWorker(handle, scanner, extractor, limits, { limit: 1 });
      processed += result.processed;
      failed += result.failed;
      if (result.processed + result.failed === 0) break;
    }
    process.stdout.write(`${JSON.stringify({ processed, failed })}\n`);
    if (failed) throw new Error('Intake retries remain pending');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runIsolatedIntake().catch(() => {
    process.stderr.write(
      'Private document worker failed. Check secure configuration and scanner.\n',
    );
    process.exitCode = 1;
  });
