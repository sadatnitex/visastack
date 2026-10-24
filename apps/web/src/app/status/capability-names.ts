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
  authentication: 'Signing in',
  manualProfile: 'Building your profile by hand',
  documentUpload: 'Uploading documents',
  deterministicExtraction: 'Reading details from documents',
  aiExtraction: 'AI suggestions from documents',
  structuralValidation: 'Checking that uploaded files are valid',
  malwareScanning: 'Virus scanning of uploads',
  ownerPreview: 'Previewing your own documents',
  thirdPartyPreview: 'Previewing documents you share with others',
  originalDownload: 'Downloading original files',
  redactedDownload: 'Downloading blacked-out copies',
  sharing: 'Sharing with agencies',
  agencyCollaboration: 'Agency workspaces',
  bulkExport: 'Exporting records for agencies',
  missionWorkspace: 'Visa case workspaces',
  packGeneration: 'Preparing application packs',
  publicSignup: 'Open sign-up for anyone',
  payments: 'Payments',
  realApplicantData: 'All protections for real personal data in place',
  commercialClaims: null,
};

export type StateTone = 'success' | 'warning' | 'neutral';

/** How each state reads. "Not set up yet" and "switched off" are different things and are said differently. */
export const STATE_WORDS: { readonly [S in CapabilityState]: { label: string; tone: StateTone } } =
  {
    available: { label: 'Working', tone: 'success' },
    degraded: { label: 'Working with limits', tone: 'warning' },
    unconfigured: { label: 'Not set up yet', tone: 'neutral' },
    disabled: { label: 'Switched off for now', tone: 'neutral' },
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
    rows.push({ key, name, ...STATE_WORDS[state] });
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
