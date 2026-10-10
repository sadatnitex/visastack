import { createHash, timingSafeEqual } from 'node:crypto';
import { hasRecentDatabaseBackup } from '@visastack/adapters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Weekly verification, one hour after the runner schedule. Dispatch only
 * when no fresh backup exists. An accepted dispatch is never completion. */
export async function GET(request: Request): Promise<Response> {
  const secret = readEnv('CRON_SECRET');
  if (!secret) return new Response('Backup scheduling unavailable', { status: 503 });
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (
    !timingSafeEqual(digest(request.headers.get('authorization') ?? ''), digest(`Bearer ${secret}`))
  ) {
    return new Response('forbidden', { status: 403 });
  }
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

function readEnv(name: string): string | undefined {
  return process.env[name];
}
