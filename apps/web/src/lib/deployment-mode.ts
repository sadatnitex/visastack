import 'server-only';
import { DEPLOYMENT_MODES, type DeploymentMode } from '@visastack/core';
import { isProductionSite } from './hosting';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

function isDeploymentMode(value: string): value is DeploymentMode {
  return (DEPLOYMENT_MODES as readonly string[]).includes(value);
}

/**
 * The single server-authoritative source of truth for "which of the three
 * operating modes is this request running in" (master recovery directive
 * §3). Never derived on the client.
 *
 * `DEPLOYMENT_MODE` is an explicit operator override, checked first, so a
 * deliberate future commercial activation is a configuration act, not an
 * inference from Vercel's own environment classification. Absent that,
 * `VERCEL_ENV === 'production'` maps to `controlled_pilot` — there is no
 * commercial infrastructure provisioned yet (see
 * docs/roadmap/commercial-recovery-completion-ux-directive.md §11 for the
 * activation gate); everything else (`preview`, or unset for local dev) maps
 * to `development`, matching the directive's own taxonomy, which classifies
 * PR-preview builds as development mode.
 */
export function getDeploymentMode(): DeploymentMode {
  const override = readEnv('DEPLOYMENT_MODE');
  if (override && isDeploymentMode(override)) return override;
  // The production site (Vercel production, or the Render fallback marked HOSTING_PLATFORM=render,
  // see hosting.ts) falls back to controlled_pilot, so a forgotten DEPLOYMENT_MODE on the
  // fallback host can never open development behaviour on the public site.
  return isProductionSite(readEnv) ? 'controlled_pilot' : 'development';
}

/** True for any real deployment (controlled pilot or commercial) — false for local dev, tests, and PR previews. */
export function isRealDeployment(): boolean {
  return getDeploymentMode() !== 'development';
}
