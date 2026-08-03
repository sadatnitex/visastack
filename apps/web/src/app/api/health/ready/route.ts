import {
  DATABASE_URL_ENV_CANDIDATES,
  checkConnection,
  createNeonDb,
  isSchemaApplied,
  resolveDatabaseUrl,
} from '@visastack/db';
import { getPlatformCapabilities } from '../../../../lib/capabilities';
import { evaluateCommercialReadiness } from '../../../../lib/commercial-readiness';
import { getDeploymentMode, isRealDeployment } from '../../../../lib/deployment-mode';
import { isPresent, isWorkosConfigured } from '../../../../lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Readiness probe. Reports whether required configuration is present,
 * whether the database is reachable and migrated, and — truthfully, not
 * merely a green build (master recovery directive §6/§7 "PR 1") — the
 * current deployment mode and full platform capability registry.
 *
 * Security: it NEVER returns secret values — only presence booleans — and
 * the detailed breakdown is withheld on a real deployment (Build Spec §14:
 * no sensitive data in responses). Database errors are reported as a
 * generic code so a connection string can never leak into the body. The
 * deployment mode and capability registry are NOT sensitive — surfacing
 * them honestly, always, is the entire point of this PR.
 */
const WORKOS_ENV_VARS = ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'WORKOS_COOKIE_PASSWORD'] as const;

function presenceMap(names: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(names.map((name) => [name, isPresent(name)]));
}

export async function GET(): Promise<Response> {
  const deploymentMode = getDeploymentMode();
  const verbose = !isRealDeployment();

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
  const coreReady = db.connected && db.schemaApplied && isWorkosConfigured();

  // Commercial mode adds its own guard ON TOP of the pilot-level core bar,
  // never in place of it (master directive §7 "PR 11": "No normal
  // administrator may override this guard"). This is the one place the full
  // guard runs — including live DB connectivity, which
  // commercialConfigurationReady() (capabilities.ts) cannot check itself.
  const commercial =
    deploymentMode === 'commercial'
      ? evaluateCommercialReadiness({ databaseReady: db.connected && db.schemaApplied })
      : undefined;

  const ready = coreReady && (commercial?.ready ?? true);
  const status = ready ? 'ready' : 'degraded';

  // Optional-capability visibility (not a core gate): signed document access
  // and the periodic durable-job sweep (uploads still enqueue and process via
  // `after()` without this — it only gates the /api/jobs/process-intake
  // backstop route).
  const optionalCapabilities = {
    signedBlobStorage: isPresent('BLOB_SIGNING_SECRET'),
    asyncIntakeSweep: isPresent('CRON_SECRET'),
  };

  const platform = getPlatformCapabilities();
  // Force these three off whenever the full guard fails, even if the
  // general-purpose (necessarily DB-blind) registry would otherwise report
  // them available — "keep public capabilities disabled" (master directive
  // §7 "PR 11"). This endpoint just verified live DB state, so it is final.
  const effectivePlatform =
    commercial && !commercial.ready
      ? {
          ...platform,
          publicSignup: 'disabled' as const,
          realApplicantData: 'disabled' as const,
          commercialClaims: 'disabled' as const,
        }
      : platform;

  const body = verbose
    ? {
        status,
        deploymentMode,
        env,
        db,
        capabilities: optionalCapabilities,
        platform: effectivePlatform,
        ...(commercial ? { commercialReadiness: commercial } : {}),
      }
    : {
        status,
        deploymentMode,
        platform: effectivePlatform,
        ...(commercial ? { commercialReadiness: commercial } : {}),
      };

  // HTTP status now carries the truth: 200 = core (and, in commercial mode,
  // every commercial gate) ready; 503 = something required is missing.
  // Load balancers and the deploy smoke can gate on the status code alone.
  return new Response(JSON.stringify(body), {
    status: ready ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
