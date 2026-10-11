import { timingSafeEqual } from 'node:crypto';
export const dynamic = 'force-dynamic';
function env(name: string): string | undefined {
  return process.env[name];
}
/** Private configuration proof before sending any synthetic sign-in credentials. */
export function GET(request: Request): Response {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const secret = env('STAGING_ATTESTATION_SECRET');
  if (
    env('VERCEL_ENV') !== 'preview' ||
    env('E2E_SYNTHETIC_ISOLATION_VERIFIED') !== 'true' ||
    !secret ||
    secret.length < 32
  )
    return Response.json({ error: 'Not found' }, { status: 404, headers });
  const actual = Buffer.from(request.headers.get('Authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  try {
    if (env('IDENTITY_PROVIDER') !== 'neon_auth') throw new Error('Not Neon');
    const database = new URL(env('DATABASE_URL') ?? '');
    const auth = new URL(env('NEON_AUTH_BASE_URL') ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      auth.protocol !== 'https:' ||
      auth.username ||
      auth.password ||
      auth.search ||
      auth.hash
    )
      throw new Error('Invalid configuration');
    return Response.json(
      {
        deployment: env('VERCEL_GIT_COMMIT_SHA'),
        databaseHost: database.hostname.replace('-pooler.', '.'),
        databaseName: decodeURIComponent(database.pathname.slice(1)),
        neonAuthBaseUrl: `${auth.origin}${auth.pathname}`.replace(/\/$/, ''),
        isolatedSyntheticConfiguration: true,
      },
      { headers },
    );
  } catch {
    return Response.json({ error: 'Staging configuration unavailable' }, { status: 503, headers });
  }
}
