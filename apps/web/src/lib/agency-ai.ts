/**
 * The words of agency AI connections (S22, ADR 0021 S22 amendment), in one place, browser-safe.
 *
 * The traveller's note and the agency's statement are the draft legal wording of owner action O10:
 * Agency AI Tools stays off for everyone until the owner approves them (the platform owner's
 * switch in AI Features, default off). Change them only with the owner's approved text.
 */

/** The traveller's choice on an agency grant (the label of the checkbox). */
export const AGENCY_AI_CHOICE_LABEL = 'Let This Agency Use AI Tools on What I Share';

/** The line on an agency grant card when the choice is on. */
export const AGENCY_AI_ALLOWED_LINE = 'AI Tools Allowed';

/** O10 draft: what the traveller reads beside the choice. */
export function agencyAiTravellerNote(agencyName: string): string {
  return `When this is on, staff at ${agencyName} can ask an AI app they choose, such as ChatGPT or Claude, to read what you already share with ${agencyName}, to help with your cases. It reads nothing more. ${agencyName} runs that app under its own agreement with the app’s provider and is responsible for how that provider handles your information. Full document numbers and files are never sent to it. Turn this off at any time; it stops the next request.`;
}

/** The agency setting's name, as the agency's Settings page shows it. */
export const AGENCY_AI_SETTING_TITLE = 'AI Connections for This Agency';

/** O10 draft: what an owner or admin confirms before turning the setting on. */
export function agencyAiStatement(agencyName: string): string {
  return `By turning this on, ${agencyName} confirms it has a lawful basis and a written agreement with each AI provider it connects, will use it only for travellers’ cases, and is responsible for that provider’s processing. VisaStack checks every request against each traveller’s permission and keeps a record.`;
}

/** What a member who is not an owner or admin reads instead of the switch. */
export const AGENCY_AI_ADMINS_ONLY = 'Only owners and admins can change this.';

/** While the update that stores agency AI choices has not run. */
export const AGENCY_AI_NOT_YET = 'Available After the Next Update';

/** How long an agency connection may last (decision D4: never more than 30 days). */
export const AGENCY_AI_DURATIONS = ['1h', '24h', '7d', '30d'] as const;
export type AgencyAiDuration = (typeof AGENCY_AI_DURATIONS)[number];

export const AGENCY_AI_DURATION_LABELS: Readonly<Record<AgencyAiDuration, string>> = {
  '1h': '1 Hour',
  '24h': '24 Hours',
  '7d': '7 Days',
  '30d': '30 Days',
};

export function isAgencyAiDuration(value: unknown): value is AgencyAiDuration {
  return (AGENCY_AI_DURATIONS as readonly unknown[]).includes(value);
}

/** The consent screen's sentence for an agency connection. */
export function agencyAiConsentSentence(agencyName: string): string {
  return `For each case you can see at ${agencyName}, this app can read only what that case’s traveller allowed ${agencyName}’s AI tools to read. It cannot change anything in VisaStack. Full document numbers and files are never given to it. It works for at most 30 days, then you connect it again, and any owner or admin can turn it off at any time.`;
}

/** The Access Log line of an agency AI read on a traveller's record. */
export function agencyAiAccessLine(agencyName: string, appAddress: string | null): string {
  return appAddress
    ? `Agency AI Tools: ${agencyName} via ${appAddress}`
    : `Agency AI Tools: ${agencyName}`;
}
