import type { PermissionAction } from '@visastack/core';

/**
 * The terms shown on the public page of an agency's client invitation, before anyone has signed in
 * (growth loop 1, Option B). They are written from the access the agency really receives when the
 * invitation is accepted (`DEFAULT_CLIENT_GRANT_ACTIONS` in the services package), never from a
 * hand-copied list: each action in that grant has one plain sentence here, and a grant that holds
 * an action with no sentence yields no terms at all, so the page can never show terms that leave
 * something out. Actions the agency does not receive are named only when they are really absent.
 */

/** One plain sentence for each kind of access an invitation can give. */
const CAN_DO: Readonly<Partial<Record<PermissionAction, string>>> = {
  VIEW_METADATA: 'See the details on the profile you choose',
  PREVIEW: 'Open previews of the documents on that profile',
  COMMENT: 'Leave comments on your case',
  PROPOSE_EDIT: 'Suggest changes to your profile. Nothing changes until you approve it',
  MANAGE: 'Run your case: assign their own staff, add case notes and ask you for documents',
};

/** Access an invitation does not give, in the words used when it is really absent from the grant. */
const WITHHELD: ReadonlyArray<{ readonly action: PermissionAction; readonly phrase: string }> = [
  { action: 'DOWNLOAD_ORIGINAL', phrase: 'download your original files' },
  { action: 'EXPORT_PROFILE', phrase: 'export your profile' },
  { action: 'SHARE', phrase: 'share your records with anyone else' },
  { action: 'APPROVE_EDIT', phrase: 'approve changes to your profile for you' },
];

export interface ClientInvitationTerms {
  /** What the agency would be able to see and do, one plain sentence each. */
  readonly agencyCan: readonly string[];
  /** One sentence on what it could not do, or null when the grant leaves nothing out of that list. */
  readonly agencyCannot: string | null;
}

/** Terms for exactly this grant, or null when any action in it has no plain sentence yet. */
export function clientInvitationTerms(
  actions: readonly PermissionAction[],
): ClientInvitationTerms | null {
  const agencyCan: string[] = [];
  for (const action of actions) {
    const sentence = CAN_DO[action];
    if (sentence === undefined) return null;
    agencyCan.push(sentence);
  }
  const withheld = WITHHELD.filter((item) => !actions.includes(item.action)).map(
    (item) => item.phrase,
  );
  const agencyCannot =
    withheld.length === 0
      ? null
      : `They could not ${joinWithOr(withheld)}. That would need a separate choice from you.`;
  return { agencyCan, agencyCannot };
}

function joinWithOr(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** The expiry as a day and a time that mean the same thing to everyone who reads the page. */
export function formatInvitationExpiry(expiresAt: Date): string {
  const day = expiresAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = expiresAt.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return `${day}, ${time} UTC`;
}
