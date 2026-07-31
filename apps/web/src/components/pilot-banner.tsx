import type { DeploymentMode } from '@visastack/core';

/**
 * Unmistakable deployment-mode banner (master recovery directive §7 "PR 1"):
 * "Controlled-pilot mode must visibly state: Internal controlled pilot. Use
 * synthetic or irreversibly redacted information only." Rendered globally
 * from the root layout so it appears on every page, signed in or not — not
 * a per-section opt-in. `mode` is computed server-side
 * (`getDeploymentMode()`); the client never decides what this says.
 */
const COPY: Partial<Record<DeploymentMode, { readonly label: string; readonly detail: string }>> = {
  controlled_pilot: {
    label: 'VisaStack Controlled Pilot',
    detail: 'Internal controlled pilot. Use synthetic or irreversibly redacted information only.',
  },
  development: {
    label: 'VisaStack Development Preview',
    detail: 'Development/preview build. Not for real applicant data.',
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
        What&apos;s live
      </a>
    </div>
  );
}
