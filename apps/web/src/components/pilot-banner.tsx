import type { DeploymentMode } from '@visastack/core';
import { type VersionNoticeCopy as BannerCopy, VersionNotice } from './version-notice';

/**
 * Unmistakable deployment-mode banner (master recovery directive §7 "PR 1"): in
 * controlled-pilot mode every page, signed in or not, must say plainly that this is
 * a test version and that only made-up or fully blacked-out information belongs in
 * it. The directive's own sentence ("Internal controlled pilot. Use synthetic or
 * irreversibly redacted information only.") says the same thing in words a
 * traveller does not use; the owner asked for plain language on public pages, so
 * the meaning is kept and the words are everyday ones.
 *
 * Rendered globally from the root layout, not a per-section opt-in. `mode` is
 * computed server-side (`getDeploymentMode()`); the client never decides what this
 * says. Since owner list item 17 it shows in full on a visitor's first page only (`seen` comes
 * from a small cookie, `lib/version-notice.ts`), and the same words stay on What Works Today.
 */

/**
 * Exported so a test can tie the deployment smoke check (`scripts/smoke.mjs`, which
 * looks for these labels in the landing page of every deployment) to the words the
 * page really shows. Change the wording here and that test says where else to update.
 */
export const PILOT_BANNER_COPY = {
  controlled_pilot: {
    label: 'VisaStack Private Pilot',
    detail:
      'Invite-only test version. Please use made-up details, or documents with all personal information permanently blacked out.',
    short: 'Test version. Made-up details only.',
  },
  development: {
    label: 'VisaStack Test Build',
    detail: 'Test build. Not for real personal data.',
    short: 'Not for real personal data.',
  },
} as const satisfies Partial<Record<DeploymentMode, BannerCopy>>;

/** The words the notice shows in a deployment mode, or null in commercial mode (no notice). */
export function versionNoticeCopy(
  mode: DeploymentMode,
  registrationOpen = false,
): BannerCopy | null {
  if (mode === 'commercial') return null;
  return mode === 'controlled_pilot' && registrationOpen
    ? {
        label: 'VisaStack Public Beta',
        detail:
          'Free to use at your own risk. Some protections, such as virus scanning of uploads, are not switched on yet.',
        short: 'Free, at your own risk.',
      }
    : PILOT_BANNER_COPY[mode];
}

export function PilotBanner({
  mode,
  registrationOpen = false,
  seen = false,
}: {
  readonly mode: DeploymentMode;
  readonly registrationOpen?: boolean;
  /** This device has already seen the notice (or hid it), so it stays folded away. */
  readonly seen?: boolean;
}) {
  const copy = versionNoticeCopy(mode, registrationOpen);
  if (!copy || seen) return null;
  return <VersionNotice copy={copy} />;
}
