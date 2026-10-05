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
const COPY: Partial<Record<DeploymentMode, { readonly label: string; readonly detail: string }>> = {
  controlled_pilot: {
    label: 'VisaStack private pilot',
    detail:
      'Invite-only test version. Please use made-up details, or documents with all personal information permanently blacked out.',
  },
  development: {
    label: 'VisaStack test build',
    detail: 'Test build. Not for real personal data.',
  },
};

export function PilotBanner({ mode }: { readonly mode: DeploymentMode }) {
  const copy = COPY[mode];
  if (!copy) return null;
  return (
    <div className="pilot-banner">
      <span className="pilot-banner-label">{copy.label}</span>
      <span className="pilot-banner-detail">{copy.detail}</span>
      <a className="pilot-banner-link" href="/status">
        What works today
      </a>
    </div>
  );
}
