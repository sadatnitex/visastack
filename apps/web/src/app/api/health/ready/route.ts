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

  const status = db.connected && db.schemaApplied ? 'ready' : 'degraded';
  const body = isProduction ? { status } : { status, env, db };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
