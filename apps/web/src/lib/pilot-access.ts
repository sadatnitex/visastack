import 'server-only';
import {
  type Db,
  type PilotAccessDecision,
  checkPilotAccess as checkPilotAccessService,
} from '@visastack/services';
import { getDeploymentMode } from './deployment-mode';
import { isPublicBetaOpen } from './public-beta';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * `PILOT_ALLOWLIST_EMAILS` — a comma-separated ops/bootstrap allowlist,
 * mirroring `ADMIN_EMAILS`' role in `admin.ts`. Exists so an operator can
 * always reach the pilot (e.g. to create the first real invitation) without
 * depending on the invitation system already containing a row — not the
 * ongoing authority for pilot access, which is the invitation table.
 */
export function pilotAllowlistEmails(): readonly string[] {
  const raw = readEnv('PILOT_ALLOWLIST_EMAILS');
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * The pilot-access boundary, wired to this deployment's real configuration
 * (docs/audits/post-programme-defect-register.md finding #2). Bypassed only
 * in `development` mode (local dev, automated tests, PR previews) — never
 * for a real deployment (controlled pilot or commercial) — matching how
 * every other environment-dependent capability in this app treats
 * `development` as a practical, explicit exception (e.g. `capabilities.ts`'s
 * `documentUpload` NeonBlobStorage fallback).
 */
export async function checkPilotAccess(
  db: Db,
  input: { readonly email: string; readonly workosUserId?: string | null },
): Promise<PilotAccessDecision> {
  return checkPilotAccessService(db, {
    ...input,
    allowlistEmails: pilotAllowlistEmails(),
    // Local development, or the public beta (Neon sign-in only, confirmed addresses only).
    bypass: getDeploymentMode() === 'development' || isPublicBetaOpen(),
  });
}
