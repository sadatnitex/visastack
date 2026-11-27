import type { DeploymentMode } from '@visastack/core';
import type { LandingKey } from '../i18n/landing-messages';

/**
 * Which words about the product's current state the home page shows twice: the third reassurance
 * in the row under the first screen and the answer to "Can I upload real documents today?". Both
 * come from the deployment mode and whether registration is open, the same two facts the banner,
 * the footer, the status page and the legal pages read, so the home page never says something they
 * do not. This returns message keys (`i18n/landing-messages.ts`); the page words them in the
 * visitor's language, so every mode keeps its own distinct wording in English and in Bengali.
 *
 * The public beta (registration open) deliberately says nothing about real documents here: the
 * Terms and the notice at the foot of the home page carry the exact words for that, and a second
 * wording would drift from them.
 */
export interface LandingStatus {
  /** The reassurance's title ("VisaStack is in a controlled pilot"). */
  readonly assurance: LandingKey;
  /** The answer to the real-documents question; it holds `{link}` for the status page link. */
  readonly answer: LandingKey;
}

export function landingStatus(mode: DeploymentMode, registrationOpen: boolean): LandingStatus {
  if (mode === 'commercial')
    return { assurance: 'landing.status.live', answer: 'landing.faq.a5Live' };
  if (mode === 'development')
    return { assurance: 'landing.status.testBuild', answer: 'landing.faq.a5Test' };
  if (registrationOpen) return { assurance: 'landing.status.beta', answer: 'landing.faq.a5Beta' };
  return { assurance: 'landing.status.pilot', answer: 'landing.faq.a5Pilot' };
}
