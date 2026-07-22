import {
  DATABASE_URL_ENV_CANDIDATES,
  checkConnection,
  createNeonDb,
  isSchemaApplied,
  resolveDatabaseUrl,
} from '@visastack/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Readiness probe. Reports whether required configuration is present and
 * whether the database is reachable and migrated.
 *
 * Security: it NEVER returns secret values — only presence booleans — and
 * the detailed breakdown is withheld in production (Build Spec §14: no
 * sensitive data in responses). Database errors are reported as a generic
 * code so a connection string can never leak into the body.
 */
const WORKOS_ENV_VARS = ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'WORKOS_COOKIE_PASSWORD'] as const;

/** Variable-keyed read — avoids both the index-signature and literal-key lint rules. */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

function isPresent(name: string): boolean {
  const value = readEnv(name);
  return typeof value === 'string' && value.length > 0;
}

function presenceMap(names: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(names.map((name) => [name, isPresent(name)]));
}

export async function GET(): Promise<Response> {
  const isProduction = readEnv('VERCEL_ENV') === 'production';

  const env = {
    database: presenceMap(DATABASE_URL_ENV_CANDIDATES),
    workos: presenceMap(WORKOS_ENV_VARS),
    redirectUri: isPresent('NEXT_PUBLIC_WORKOS_REDIRECT_URI'),
  };

  let db: { connected: boolean; schemaApplied: boolean; error?: string } = {
    connected: false,
    schemaApplied: false,
  };

  const connectionString = resolveDatabaseUrl(process.env);
  if (connectionString) {
    try {
      const client = createNeonDb(connectionString);
      await checkConnection(client);
      db = { connected: true, schemaApplied: await isSchemaApplied(client) };
    } catch {
      db = { connected: false, schemaApplied: false, error: 'connection_failed' };
    }
  }

  // The authenticated MANUAL core is ready only when the database is reachable
  // AND migrated AND the WorkOS auth configuration required to sign in is
  // present (Milestone 1 — honest readiness). Optional capabilities (AI,
  // signed blob storage) are reported separately and never gate the core.
  const workosConfigured = WORKOS_ENV_VARS.every(isPresent) && env.redirectUri;
  const coreReady = db.connected && db.schemaApplied && workosConfigured;
  const status = coreReady ? 'ready' : 'degraded';

  // Optional-capability visibility (not a core gate): signed document access.
  const capabilities = { signedBlobStorage: isPresent('BLOB_SIGNING_SECRET') };

  const body = isProduction ? { status } : { status, env, db, capabilities };

  // HTTP status now carries the truth: 200 = core ready, 503 = a required core
  // dependency is unavailable or unmigrated. Load balancers and the deploy
  // smoke can gate on the status code alone.
  return new Response(JSON.stringify(body), {
    status: coreReady ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
