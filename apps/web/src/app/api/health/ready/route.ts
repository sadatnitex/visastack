import { checkConnection, createNeonDb, isSchemaApplied } from '@visastack/db';

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
/** Variable-keyed read — avoids both the index-signature and literal-key lint rules. */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

function isPresent(name: string): boolean {
  const value = readEnv(name);
  return typeof value === 'string' && value.length > 0;
}

export async function GET(): Promise<Response> {
  const isProduction = readEnv('VERCEL_ENV') === 'production';

  const env = {
    DATABASE_URL: isPresent('DATABASE_URL'),
    WORKOS_API_KEY: isPresent('WORKOS_API_KEY'),
    WORKOS_CLIENT_ID: isPresent('WORKOS_CLIENT_ID'),
    WORKOS_COOKIE_PASSWORD: isPresent('WORKOS_COOKIE_PASSWORD'),
  };

  let db: { connected: boolean; schemaApplied: boolean; error?: string } = {
    connected: false,
    schemaApplied: false,
  };

  const connectionString = readEnv('DATABASE_URL');
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
