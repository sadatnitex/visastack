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
 * says.
 *
 * Owner list item 17 (the beta banner once), together with the rule above that every page says
 * this is a test version: the full notice shows once per visitor, on the first page they open.
 * After that (`seen` comes from a small cookie, `lib/version-notice.ts`), and after Hide This
 * Notice, every page keeps a slim one-line label: the version name from the same copy below and
 * the What Works Today link, which also carries the full words under About This Version. Nothing
 * removes the label.
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

/**
 * What the public beta notice means, shown under About This Version on the Status page. Exported
 * so that page can show it in Bangla (it looks the sentence up by these English words, the way the
 * footer looks up the version name) and so the words live in one place.
 */
export const PUBLIC_BETA_DETAIL =
  'Some features are still being switched on. This page shows what works today.';

/**
 * The words the notice shows in a deployment mode, or null in commercial mode (no notice).
 * `realData` is `realDataOpen()` (lib/real-data-wording.ts), the realApplicantData capability:
 * owner decision of 19 Nov 2026 ("stop telling madeup details etc"), so once real personal data is
 * on, an invite-only pilot keeps its name but never asks for made-up details.
 */
export function versionNoticeCopy(
  mode: DeploymentMode,
  registrationOpen = false,
  realData = false,
): BannerCopy | null {
  if (mode === 'commercial') return null;
  if (mode !== 'controlled_pilot') return PILOT_BANNER_COPY[mode];
  if (registrationOpen) {
    return {
      label: 'VisaStack Public Beta',
      detail: PUBLIC_BETA_DETAIL,
      short: '',
      detailInBanner: false,
    };
  }
  return realData
    ? {
        label: PILOT_BANNER_COPY.controlled_pilot.label,
        detail: PUBLIC_BETA_DETAIL,
        short: '',
        detailInBanner: false,
      }
    : PILOT_BANNER_COPY.controlled_pilot;
}

export function PilotBanner({
  mode,
  registrationOpen = false,
  realData = false,
  seen = false,
}: {
  readonly mode: DeploymentMode;
  readonly registrationOpen?: boolean;
  /** Real personal data is switched on (`realDataOpen()`): no made-up-details words. */
  readonly realData?: boolean;
  /** This device has already seen the notice (or hid it), so only the slim label shows. */
  readonly seen?: boolean;
}) {
  const copy = versionNoticeCopy(mode, registrationOpen, realData);
  if (!copy) return null;
  return <VersionNotice copy={copy} folded={seen} />;
}
