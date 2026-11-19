import 'server-only';
import { getPlatformCapabilities } from './capabilities';
import { evaluateOperationalReadiness } from './commercial-readiness';
import { getDeploymentMode } from './deployment-mode';
import { isPublicBetaOpen } from './public-beta';
import { rememberedReadinessSignals } from './readiness-signals';

/**
 * Whether real personal data is switched on: the `realApplicantData` capability ("every
 * operational gate met, or deferred by the owner under its register id"), never deployment mode.
 *
 * The capability reads two database facts (the AI provider settings, the scan runner's proof)
 * remembered from the latest readiness read on this server. On a server that has not read them
 * yet they are unknown, and the capability fails closed. That is right for the capability, but
 * the words on a page must not flip back to "made-up details" just because this server instance
 * started a minute ago. So, only while those facts are unknown, the same operational guard is
 * asked with them treated as not blocking; once they are known, the capability's own answer
 * stands. Every other gate (sign-in, storage, step-up, each owner deferral) is still checked.
 *
 * Owner decision, 19 Nov 2026: "stop telling madeup details etc" once the site is live for real
 * use. Rolling back is unsetting the deferral settings: this then answers false again.
 */
export function realDataOpen(): boolean {
  if (getDeploymentMode() === 'development') return false;
  if (getPlatformCapabilities().realApplicantData === 'available') return true;
  const signals = rememberedReadinessSignals();
  if (signals.aiProvider.kind !== 'unknown') return false;
  return evaluateOperationalReadiness({
    databaseReady: true,
    signals: {
      aiProvider: { kind: 'none_active' },
      scannerEvidenceFresh: signals.scannerEvidenceFresh,
    },
  }).ready;
}

/**
 * Whether the public and signed-in words invite people to use their own details and documents
 * (at their own risk) instead of asking for made-up details: real personal data is switched on,
 * or the free public beta is open (owner decision of 26 Oct 2026, #233). Made-up wording shows
 * only when neither holds.
 */
export function ownDetailsWelcome(): boolean {
  return isPublicBetaOpen() || realDataOpen();
}
