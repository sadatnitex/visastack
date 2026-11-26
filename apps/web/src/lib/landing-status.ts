import type { DeploymentMode } from '@visastack/core';

/**
 * The words about the product's current state that the home page shows twice: the third
 * reassurance in the row under the first screen and the answer to "Can I upload real documents
 * today?". Both come from the deployment mode and whether registration is open, the same two facts
 * the banner, the footer, the status page and the legal pages read, so the home page never says
 * something they do not.
 *
 * The public beta (registration open) deliberately says nothing about real documents here: the
 * Terms and the notice at the foot of the home page carry the exact words for that, and a second
 * wording would drift from them.
 */
export interface LandingStatus {
  /** The reassurance's title ("VisaStack is in a controlled pilot"). */
  readonly assurance: string;
  /** The answer to the real-documents question, before its link to the status page. */
  readonly realDocuments: string;
}

export function landingStatus(mode: DeploymentMode, registrationOpen: boolean): LandingStatus {
  if (mode === 'commercial')
    return {
      assurance: 'See what works today',
      realDocuments: 'Check the',
    };
  if (mode === 'development')
    return {
      assurance: 'This is a test build',
      realDocuments: 'This is a test build, so use made-up details only. Check the',
    };
  if (registrationOpen)
    return {
      assurance: 'VisaStack is in public beta',
      realDocuments: 'Some features are not switched on yet. Check the',
    };
  return {
    assurance: 'VisaStack is in a controlled pilot',
    realDocuments: 'Use sample data during the controlled pilot. Check the',
  };
}
