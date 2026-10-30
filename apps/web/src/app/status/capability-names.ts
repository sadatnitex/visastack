import type { CapabilityState, PlatformCapabilities } from '@visastack/core';

/**
 * What a visitor reads on the status page for each platform capability, in
 * everyday words. A capability with no name here is not shown to the public: that
 * is deliberate for `commercialClaims`, which is an internal switch about what the
 * product may say about itself, not a feature anyone uses. Because the table is
 * typed on every key of `PlatformCapabilities`, adding a capability without
 * deciding how to name it (or to hide it) does not compile.
 */
export const CAPABILITY_NAMES: { readonly [K in keyof PlatformCapabilities]: string | null } = {
  authentication: 'Signing In',
  manualProfile: 'Building Your Profile by Hand',
  documentUpload: 'Uploading Documents',
  deterministicExtraction: 'Reading Details from Documents',
  aiExtraction: 'AI Suggestions from Documents',
  structuralValidation: 'Checking Uploaded Files Are Valid',
  malwareScanning: 'Virus Scanning of Uploads',
  ownerPreview: 'Previewing Your Own Documents',
  thirdPartyPreview: 'Previewing Documents You Share with Others',
  originalDownload: 'Downloading Original Files',
  redactedDownload: 'Downloading Safe Copies',
  sharing: 'Sharing with Agencies',
  agencyCollaboration: 'Agency Workspaces',
  bulkExport: 'Exporting Records for Agencies',
  missionWorkspace: 'Visa Case Workspaces',
  packGeneration: 'Preparing Application Packs',
  publicSignup: 'Open Sign-Up for Anyone',
  payments: 'Payments',
  aiConnector: 'AI App Connections',
  realApplicantData: 'All Protections for Real Personal Data in Place',
  commercialClaims: null,
};

export type StateTone = 'success' | 'warning' | 'neutral';

/** How each state reads. "Not set up yet" and "switched off" are different things and are said differently. */
export const STATE_WORDS: { readonly [S in CapabilityState]: { label: string; tone: StateTone } } =
  {
    available: { label: 'Working', tone: 'success' },
    degraded: { label: 'Working with Limits', tone: 'warning' },
    unconfigured: { label: 'Not Set Up Yet', tone: 'neutral' },
    disabled: { label: 'Switched Off for Now', tone: 'neutral' },
  };

/**
 * A capability whose limited state has a more exact name (S29): payments in the gateway's test
 * mode take only test payments.
 */
export const STATE_WORD_OVERRIDES: {
  readonly [K in keyof PlatformCapabilities]?: { readonly [S in CapabilityState]?: string };
} = {
  payments: { degraded: 'Test Payments Only' },
};

export interface CapabilityRow {
  readonly key: keyof PlatformCapabilities;
  readonly name: string;
  readonly label: string;
  readonly tone: StateTone;
}

function isState(value: unknown): value is CapabilityState {
  return typeof value === 'string' && Object.hasOwn(STATE_WORDS, value);
}

/**
 * The rows to show for a readiness response's `platform` object. Anything the
 * response says that this page does not know how to put in plain words (an unnamed
 * capability, a state it has no wording for) is left out rather than shown as a raw
 * key or code.
 */
export function capabilityRows(platform: unknown): CapabilityRow[] {
  if (platform === null || typeof platform !== 'object') return [];
  const source = platform as Record<string, unknown>;
  const rows: CapabilityRow[] = [];
  for (const key of Object.keys(CAPABILITY_NAMES) as (keyof PlatformCapabilities)[]) {
    const name = CAPABILITY_NAMES[key];
    const state = source[key];
    if (name === null || !isState(state)) continue;
    const label = STATE_WORD_OVERRIDES[key]?.[state] ?? STATE_WORDS[state].label;
    rows.push({ key, name, label, tone: STATE_WORDS[state].tone });
  }
  return rows;
}

export type Verdict = 'working' | 'limited' | 'unreachable' | 'checking';

/** What the headline says, from the two checks the page runs. */
export const VERDICT_WORDS: {
  readonly [V in Verdict]: { label: string; tone: StateTone | 'danger' };
} = {
  checking: { label: 'Checking…', tone: 'neutral' },
  working: { label: 'Everything is working', tone: 'success' },
  limited: { label: 'Some parts are having problems', tone: 'warning' },
  unreachable: { label: 'We can’t reach the service right now', tone: 'danger' },
};

/**
 * The headline: working only if the service answers and says it is ready; limited if
 * it answers but says it is not; unreachable if it does not answer at all.
 */
export function verdictOf(
  live: { readonly ok: boolean } | null,
  ready: { readonly ok: boolean; readonly status: string } | null,
): Verdict {
  if (live === null || ready === null) return 'checking';
  if (!live.ok && !ready.ok && ready.status === 'unreachable') return 'unreachable';
  if (live.ok && ready.ok && ready.status === 'ready') return 'working';
  return 'limited';
}
