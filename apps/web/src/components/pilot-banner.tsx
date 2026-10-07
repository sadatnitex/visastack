import type { DeploymentMode } from '@visastack/core';

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
 */
interface BannerCopy {
  readonly label: string;
  readonly detail: string;
}

/**
 * Exported so a test can tie the deployment smoke check (`scripts/smoke.mjs`, which
 * looks for these labels in the landing page of every deployment) to the words the
 * page really shows. Change the wording here and that test says where else to update.
 */
export const PILOT_BANNER_COPY = {
  controlled_pilot: {
    label: 'VisaStack private pilot',
    detail:
      'Open test version. Please use made-up details, or documents with all personal information permanently blacked out.',
  },
  development: {
    label: 'VisaStack test build',
    detail: 'Test build. Not for real personal data.',
  },
} as const satisfies Partial<Record<DeploymentMode, BannerCopy>>;

export function PilotBanner({ mode }: { readonly mode: DeploymentMode }) {
  if (mode === 'commercial') return null;
  const copy = PILOT_BANNER_COPY[mode];
  // A named region, so the notice is a landmark a screen reader user can find and skip,
  // not loose content above the page's own landmarks.
  return (
    <section className="pilot-banner" aria-label="About this version">
      <span className="pilot-banner-label">{copy.label}</span>
      <span className="pilot-banner-detail">{copy.detail}</span>
      <a className="pilot-banner-link" href="/status">
        What works today
      </a>
    </section>
  );
}
