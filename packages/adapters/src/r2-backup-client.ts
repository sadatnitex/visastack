import type { S3Client } from '@aws-sdk/client-s3';
import { readR2Region, validateR2Endpoint } from './r2-storage';

export interface R2BackupCredentials {
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/**
 * The one R2 client setup for the backup freshness check (`backup-status.ts`) and the prune step
 * (`backup-prune.ts`): the validated account endpoint, path-style addressing, the configured
 * region, bounded connection and request time, at most one retry, and checksums only where the
 * service requires them. The SDK loads only when a backup tool runs.
 */
export async function createR2BackupClient(credentials: R2BackupCredentials): Promise<S3Client> {
  const { S3Client: Client } = await import('@aws-sdk/client-s3');
  return new Client({
    region: readR2Region(),
    forcePathStyle: true,
    endpoint: validateR2Endpoint(credentials.endpoint),
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    requestHandler: { connectionTimeout: 5000, requestTimeout: 10000 },
    maxAttempts: 2,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
