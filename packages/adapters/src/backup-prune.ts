import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_PREFIX,
  type BackupManifest,
  type BackupObject,
  type BackupPrunePlan,
  LATEST_MANIFEST_KEY,
  STORAGE_WARNING_BYTES,
  parseBackupManifest,
  planBackupPrune,
} from './backup-retention';
import { R2_DOCUMENT_BUCKET, readR2Region, validateR2Endpoint } from './r2-storage';

/**
 * The prune and storage report step of `.github/workflows/database-backup.yml` (S27). It lists
 * the archives, reads their manifests, applies `planBackupPrune`, and prints the storage total and
 * the plan. It deletes only when the repository variable `BACKUP_PRUNE` is exactly `on`; unset
 * (the default) or any other value only reports what WOULD be deleted. Object keys are run times
 * and run ids, never data. A failed listing or manifest read stops the step before anything is
 * deleted.
 */

export interface BackupStore {
  list(prefix: string): Promise<readonly BackupObject[]>;
  /** The object's text, or null when it does not exist. */
  readText(key: string): Promise<string | null>;
  remove(keys: readonly string[]): Promise<void>;
}

export interface BackupPruneOutcome {
  readonly plan: BackupPrunePlan;
  readonly deleted: readonly string[];
  readonly mode: 'report' | 'delete';
}

function gigabytes(bytes: number): string {
  return (bytes / 1000 ** 3).toFixed(2);
}

export async function runBackupPrune(input: {
  readonly store: BackupStore;
  readonly pruneSetting: string | undefined;
  readonly now: Date;
  readonly log: (line: string) => void;
}): Promise<BackupPruneOutcome> {
  const objects = await input.store.list(BACKUP_PREFIX);
  const manifests = new Map<string, BackupManifest | null>();
  for (const object of objects) {
    if (!object.key.endsWith('.manifest.json')) continue;
    const text = await input.store.readText(object.key);
    manifests.set(object.key, text === null ? null : parseBackupManifest(text));
  }
  const latestText = objects.some((object) => object.key === LATEST_MANIFEST_KEY)
    ? await input.store.readText(LATEST_MANIFEST_KEY)
    : null;
  const latest = latestText === null ? null : parseBackupManifest(latestText);
  const plan = planBackupPrune({
    objects,
    manifests,
    latestObjectKey: latest?.objectKey ?? null,
    now: input.now,
  });
  const mode = input.pruneSetting === 'on' ? 'delete' : 'report';

  input.log(
    `Backup storage: ${gigabytes(plan.totalBytes)} GB in ${objects.length} objects; ${plan.verified} verified archives.`,
  );
  if (plan.totalBytes > STORAGE_WARNING_BYTES) {
    input.log(
      `::warning title=Backup storage::Backup storage is ${gigabytes(plan.totalBytes)} GB, above the ${gigabytes(STORAGE_WARNING_BYTES)} GB warning line (free allowance 10 GB). Turn on pruning or review retention.`,
    );
  }
  for (const orphan of plan.orphans) {
    input.log(
      `Archive without a verified manifest: ${orphan.key}${orphan.removable ? ' (older than 2 days)' : ' (recent, kept)'}`,
    );
  }
  if (plan.paused) input.log(`Pruning paused: ${plan.paused}. Nothing will be deleted.`);
  for (const item of plan.remove) {
    input.log(`${mode === 'delete' ? 'Deleting' : 'Would delete'}: ${item.key} (${item.reason})`);
  }
  if (mode === 'report') {
    input.log(
      `Report only: BACKUP_PRUNE is not "on", so nothing was deleted (${plan.remove.length} objects would be).`,
    );
    return { plan, deleted: [], mode };
  }
  const keys = plan.remove.map((item) => item.key);
  if (keys.length > 0) await input.store.remove(keys);
  input.log(`Deleted ${keys.length} objects.`);
  return { plan, deleted: keys, mode };
}

/** The repository Actions variable that turns deletion on (exactly `on`). */
const PRUNE_VARIABLE = 'BACKUP_PRUNE';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function r2Store(): Promise<BackupStore & { close(): void }> {
  const { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } = await import(
    '@aws-sdk/client-s3'
  );
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
  return {
    async list(prefix) {
      const objects: BackupObject[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: R2_DOCUMENT_BUCKET,
            Prefix: prefix,
            ...(token ? { ContinuationToken: token } : {}),
          }),
        );
        for (const item of page.Contents ?? []) {
          if (!item.Key || item.Size === undefined || !item.LastModified) {
            throw new Error('invalid backup listing');
          }
          objects.push({ key: item.Key, size: item.Size, lastModified: item.LastModified });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return objects;
    },
    async readText(key) {
      try {
        const object = await client.send(
          new GetObjectCommand({ Bucket: R2_DOCUMENT_BUCKET, Key: key }),
        );
        if (!object.Body || (object.ContentLength ?? 0) > 8192) return '';
        return await object.Body.transformToString();
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (status === 404) return null;
        throw new Error('backup manifest unavailable');
      }
    },
    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: R2_DOCUMENT_BUCKET,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if ((result.Errors ?? []).length > 0)
          throw new Error('some backup objects were not deleted');
      }
    },
    close() {
      client.destroy();
    },
  };
}

/** Fixed diagnostics only: provider errors may carry signed addresses. */
export function backupPruneFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    for (const name of ['R2_ENDPOINT_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
      if (error.message === `Missing ${name}`) return `Backup prune failed: missing ${name}.`;
    }
  }
  return 'Backup prune failed. Check provider access; nothing outside the retention plan was deleted.';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const store = await r2Store();
    try {
      await runBackupPrune({
        store,
        pruneSetting: process.env[PRUNE_VARIABLE],
        now: new Date(),
        log: (line) => process.stdout.write(`${line}\n`),
      });
    } finally {
      store.close();
    }
  })().catch((error: unknown) => {
    process.stderr.write(`${backupPruneFailureMessage(error)}\n`);
    process.exitCode = 1;
  });
}
