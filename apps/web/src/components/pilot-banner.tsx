import type { DeploymentMode } from '@visastack/core';
import type { MessageKey, Translator } from '@visastack/i18n';

/**
 * Unmistakable deployment-mode banner (master recovery directive §7 "PR 1"):
 * "Controlled-pilot mode must visibly state: Internal controlled pilot. Use
 * synthetic or irreversibly redacted information only." Rendered globally
 * from the root layout so it appears on every page, signed in or not - not
 * a per-section opt-in. `mode` is computed server-side
 * (`getDeploymentMode()`); the client never decides what this says. The words
 * come from the catalog so the warning is read in the visitor's own language.
 */
const COPY: Partial<
  Record<DeploymentMode, { readonly label: MessageKey; readonly detail: MessageKey }>
> = {
  controlled_pilot: { label: 'shell.pilot.label', detail: 'shell.pilot.detail' },
  development: { label: 'shell.preview.label', detail: 'shell.preview.detail' },
};

export function PilotBanner({
  mode,
  t,
}: {
  readonly mode: DeploymentMode;
  readonly t: Translator;
}) {
  const copy = COPY[mode];
  if (!copy) return null;
  return (
    <div className="pilot-banner">
      <span className="pilot-banner-label">{t(copy.label)}</span>
      <span className="pilot-banner-detail">{t(copy.detail)}</span>
      <a className="pilot-banner-link" href="/status">
        {t('shell.pilot.whatsLive')}
      </a>
    </div>
  );
}
