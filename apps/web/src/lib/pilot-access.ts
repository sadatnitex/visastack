import 'server-only';
import {
  type Db,
  type PilotAccessDecision,
  checkPilotAccess as checkPilotAccessService,
} from '@visastack/services';
import { getDeploymentMode } from './deployment-mode';

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
 * `PILOT_INVITE_ONLY` - set to `true` to bring the invitation gate back. Sign-up is open to anyone
 * by default (the owner's decision, 2026-10-07: feedback is collected from testers directly), so
 * the invitation table and the allowlist stay in place but only matter when this switch is on.
 */
export function pilotInviteOnly(): boolean {
  return readEnv('PILOT_INVITE_ONLY')?.trim().toLowerCase() === 'true';
}

/** True when anyone who signs in may get an account: always in development, and in a real deployment unless invite-only mode is on. */
export function pilotAccessBypassed(): boolean {
  return getDeploymentMode() === 'development' || !pilotInviteOnly();
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
    bypass: pilotAccessBypassed(),
  });
}
