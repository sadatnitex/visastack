import {
  DATABASE_URL_ENV_CANDIDATES,
  checkConnection,
  createNeonDb,
  isSchemaApplied,
  resolveDatabaseUrl,
} from '@visastack/db';
import { buildFactVersionAad, protectValue, revealValue } from '@visastack/services';
import { getPlatformCapabilities } from '../../../../lib/capabilities';
import { evaluateCommercialReadiness } from '../../../../lib/commercial-readiness';
import { getDeploymentMode, isRealDeployment } from '../../../../lib/deployment-mode';
import { isPresent, isWorkosConfigured } from '../../../../lib/env';
import { createKeyManagementPort, validateProviderEnv } from '../../../../lib/providers';

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
 *
 * Finding #35 (post-programme defect register): a real deployment's
 * unauthenticated response used to include the FULL commercial-readiness
 * gate breakdown (pentest status, backup-restore attestation, incident
 * owner, etc.) — detailed operational/security posture, not a presence
 * boolean, and reachable by anyone via the public `/status` page. On a real
 * deployment (`!verbose`) only the aggregate `ready` boolean is included
 * now; the full per-gate breakdown is available to platform admins only,
 * on the authenticated `/app/admin` page (which independently re-evaluates
 * the same guard).
 *
 * Finding #36 (post-programme defect register): `validateProviderEnv()`
 * (`../../../../lib/providers`) previously had zero callers anywhere in the
 * app, so an unsupported `*_PROVIDER` value (e.g. a typo, or a provider
 * planned but not yet built) was silently ignored at runtime instead of
 * failing loudly. It now gates `coreReady` here — the one guaranteed
 * startup/readiness path — same as DB connectivity and WorkOS config.
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

  // Finding #36: fail loudly, as part of readiness, the moment any
  // *_PROVIDER var names a value this deployment doesn't implement — rather
  // than silently ignoring it, as happened when validateProviderEnv() had no
  // caller at all. The message only ever names a *_PROVIDER key and the
  // provider-name values it supports (never a secret) but is still withheld
  // on a real deployment's response body, same as every other diagnostic
  // detail here — only its effect on `coreReady`/`status` is always public.
  let providers: { valid: boolean; error?: string } = { valid: true };
  try {
    validateProviderEnv();
  } catch (error) {
    providers = {
      valid: false,
      error: error instanceof Error ? error.message : 'invalid_provider_configuration',
    };
  }

  // TEMPORARY (Commercial V1 SEC-03, remove once the deployed
  // KMS_LOCAL_MASTER_KEY_BASE64 is confirmed working): proves the key
  // actually decrypts what it encrypts, not just that it's present -- a
  // copy-paste truncation or stray whitespace would pass a presence check
  // but fail this round trip. Touches only fixed, fake IDs, never real
  // applicant data; never returns the key material or plaintext, only
  // booleans and a generic error message if something goes wrong.
  let kms: { configured: boolean; roundTripOk?: boolean; error?: string } = { configured: false };
  if (connectionString) {
    try {
      const encryption = createKeyManagementPort();
      if (encryption) {
        const client = createNeonDb(connectionString);
        const aad = buildFactVersionAad({
          applicantId: 'kms-verify',
          factId: 'kms-verify',
          fieldKey: 'kms-verify',
          factVersionId: 'kms-verify',
        });
        const protectedValue = await protectValue(client, encryption, 'kms-verify-probe', aad);
        const revealed = await revealValue(client, encryption, {
          ciphertext: protectedValue.ciphertext,
          nonce: protectedValue.nonce,
          keyVersion: protectedValue.keyVersion,
          aad,
        });
        kms = { configured: true, roundTripOk: revealed === 'kms-verify-probe' };
      }
    } catch (error) {
      kms = {
        configured: true,
        error: error instanceof Error ? error.message : 'kms_check_failed',
      };
    }
  }

  // The authenticated MANUAL core is ready only when the database is reachable
  // AND migrated AND the WorkOS auth configuration required to sign in is
  // present AND every configured provider is one this deployment actually
  // implements (Milestone 1 — honest readiness). Optional capabilities (AI,
  // signed blob storage) are reported separately and never gate the core.
  const coreReady = db.connected && db.schemaApplied && isWorkosConfigured() && providers.valid;

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
        providers,
        kms,
        capabilities: optionalCapabilities,
        platform: effectivePlatform,
        ...(commercial ? { commercialReadiness: commercial } : {}),
      }
    : {
        status,
        deploymentMode,
        platform: effectivePlatform,
        // Finding #35: a real deployment's response is public (reachable
        // unauthenticated via /status) — expose only the aggregate boolean.
        // The full per-gate breakdown (pentest, backups, incident owner,
        // etc.) is available to platform admins only, on /app/admin.
        ...(commercial ? { commercialReadiness: { ready: commercial.ready } } : {}),
      };

  // HTTP status now carries the truth: 200 = core (and, in commercial mode,
  // every commercial gate) ready; 503 = something required is missing.
  // Load balancers and the deploy smoke can gate on the status code alone.
  return new Response(JSON.stringify(body), {
    status: ready ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
