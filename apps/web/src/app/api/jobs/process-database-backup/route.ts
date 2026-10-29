import { hasRecentDatabaseBackup } from '@visastack/adapters';
import { rejectUnauthorizedCron } from '../../../../lib/cron-auth';
import { readEnv } from '../../../../lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Daily verification at 11:07 UTC, about six hours after the 05:17 UTC capture (S27): only a
 * capture under 24 hours old counts as fresh, so a failed morning capture fails this check the same
 * day. Dispatch only when no fresh backup exists. An accepted dispatch is never completion. */
export async function GET(request: Request): Promise<Response> {
  const denied = rejectUnauthorizedCron(request);
  if (denied) return denied;
  if (readEnv('VERCEL_ENV') !== 'production')
    return new Response('Production only', { status: 403 });
  const endpoint = readEnv('R2_ENDPOINT_URL');
  const accessKeyId = readEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY');
  if (!endpoint || !accessKeyId || !secretAccessKey)
    return new Response('Backup storage unavailable', { status: 503 });
  try {
    if (await hasRecentDatabaseBackup({ endpoint, accessKeyId, secretAccessKey })) {
      return Response.json(
        { backupCompleted: true, restoreVerified: false, dispatched: false },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
  } catch {
    return new Response('Backup status unavailable', { status: 502 });
  }
  const token = readEnv('GITHUB_BACKUP_DISPATCH_TOKEN');
  if (!token) return new Response('Backup dispatch is not configured', { status: 503 });
  try {
    const result = await fetch(
      'https://api.github.com/repos/sadatnitex/visastack/actions/workflows/database-backup.yml/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (result.status !== 204) return new Response('Backup dispatch failed', { status: 502 });
    return Response.json(
      { dispatched: true, backupCompleted: false },
      { status: 202, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return new Response('Backup dispatch failed', { status: 502 });
  }
}
