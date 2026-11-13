import type { SelfDeleteImpact } from '@visastack/services';
import { agree, plural } from '../../../../../../../lib/plural';
import { BACKUP_NOTE } from '../request/messages';

/*
 * The words of Delete My File (Delete My File, Removal Records,
 * Removing Securely). Plain, short, and exact about what is lost. Backup wording is the owner's
 * (owner decision D10), shared with Ask Us to Remove This File.
 */

export { BACKUP_NOTE };

export const WHAT_HAPPENS = 'This removes the file from VisaStack for good. It cannot be undone.';

export const NOT_ALLOWED = 'Only the owner of this record can do this.';
export const SWITCHED_OFF = 'Deleting files is not available yet.';
export const GONE = 'That file is no longer here. Refresh the page and try again.';
export const TYPE_THE_WORD = 'Type DELETE to confirm.';
export const SIGN_IN_AGAIN =
  'For your safety, sign in again first. You will come back to this screen.';

/** What the file touches, one short line each, only for what is not zero. */
export function impactLines(impact: SelfDeleteImpact): string[] {
  const lines: string[] = [];
  if (impact.agencies > 0) {
    lines.push(
      `${plural(impact.agencies, 'agency', 'agencies')} can see it. ${agree(impact.agencies, 'It loses', 'They lose')} access now and ${agree(impact.agencies, 'is', 'are')} told, without the file name.`,
    );
  }
  // Shares include the agencies' own; the line says so when only people are left to name.
  const personShares = Math.max(impact.shares - impact.agencies, 0);
  if (personShares > 0) {
    lines.push(
      `${plural(personShares, 'share')} with ${agree(personShares, 'a person', 'people')} ${agree(personShares, 'ends', 'end')} now.`,
    );
  }
  if (impact.openCases > 0) {
    lines.push(
      `Used in ${plural(impact.openCases, 'open case')}. ${agree(impact.openCases, 'It', 'Each')} will ask you to choose another document.`,
    );
  }
  if (impact.profileDetails > 0) {
    lines.push(
      `${plural(impact.profileDetails, 'profile detail')} ${agree(impact.profileDetails, 'was', 'were')} read from it and ${agree(impact.profileDetails, 'stays', 'stay')}, without this file as ${agree(impact.profileDetails, 'its', 'their')} source.`,
    );
  }
  if (impact.aiChoices > 0) {
    lines.push(
      `Chosen for ${plural(impact.aiChoices, 'AI app')}. ${agree(impact.aiChoices, 'It loses', 'They lose')} it now.`,
    );
  }
  if (impact.trips > 0) {
    lines.push(
      `Used in ${plural(impact.trips, 'trip')}. It is taken out of ${agree(impact.trips, 'it', 'each')}.`,
    );
  }
  if (impact.contributorHandovers > 0) {
    lines.push('Someone you invited sent it. Their hand-over stays, without the file.');
  }
  return lines;
}

/** The line after a successful deletion. */
export function deletedLine(documentCode: string, removal: 'QUEUED' | 'REMOVED'): string {
  return removal === 'REMOVED'
    ? `Removed. Record ${documentCode} is in Removal Records.`
    : `Removing securely. Record ${documentCode} is in Removal Records.`;
}
