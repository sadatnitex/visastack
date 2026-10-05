import { isRealDeployment } from '../../../../lib/deployment-mode';
import { evaluateReadiness } from '../../../../lib/readiness';

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
 *
 * OPS-03 (Part 9 section 7): "Public health: coarse. Admin readiness:
 * detailed. Never expose secret presence, sensitive provider detail,
 * identifiers." The detailed breakdown is now built by `lib/readiness.ts` and
 * shown to platform administrators on `/app/admin`. This public route reveals
 * the breakdown ONLY on a local or test run (`NODE_ENV` is not `production`
 * and the mode is `development`). Every deployed build, including a PR preview
 * (which is a public URL and used to be treated as development), returns the
 * coarse verdict alone. A database whose migrations lag this build is
 * `degraded`: that is what readiness exists to say, and it stayed `ready` while
 * production lacked migrations 0078 to 0082.
 */

export async function GET(): Promise<Response> {
  const report = await evaluateReadiness();
  const verbose = !isRealDeployment() && process.env.NODE_ENV !== 'production';
  const { ready, status, deploymentMode, commercial } = report;

  // Force these three off whenever the full guard fails, even if the
  // general-purpose (necessarily DB-blind) registry would otherwise report
  // them available: "keep public capabilities disabled" (master directive §7
  // "PR 11"). This endpoint just verified live DB state, so it is final.
  const effectivePlatform =
    commercial && !commercial.ready
      ? {
          ...report.platform,
          publicSignup: 'disabled' as const,
          realApplicantData: 'disabled' as const,
          commercialClaims: 'disabled' as const,
        }
      : report.platform;

  const body = verbose
    ? {
        status,
        deploymentMode,
        env: report.env,
        db: report.db,
        migrations: report.migrations,
        providers: report.providers,
        capabilities: report.capabilities,
        platform: effectivePlatform,
        ...(commercial ? { commercialReadiness: commercial } : {}),
      }
    : {
        status,
        deploymentMode,
        platform: effectivePlatform,
        // Finding #35: only the aggregate boolean is public. The per-gate
        // breakdown (pentest, backups, incident owner) is for platform admins.
        ...(commercial ? { commercialReadiness: { ready: commercial.ready } } : {}),
      };

  // HTTP status carries the truth: 200 = core (and, in commercial mode, every
  // commercial gate) ready; 503 = something required is missing. Load
  // balancers and the deploy smoke can gate on the status code alone.
  return new Response(JSON.stringify(body), {
    status: ready ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
