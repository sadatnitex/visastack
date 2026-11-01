import 'server-only';
import { TRAVELLER_REFUSALS } from '@visastack/services';

/*
 * The words people read for the traveller actions (LC-E). An action ends by sending the person back
 * to the page with one outcome word in the address (`?traveller=archived`); the page shows the
 * matching sentence. Only the words listed here are ever shown, so an address can never put its
 * own text on the page. Service refusals map from their fixed messages to these words.
 */

/** The address parameter that carries an outcome word. */
export const OUTCOME_PARAM = 'traveller';

type RefusalKey = keyof typeof TRAVELLER_REFUSALS;

const REFUSAL_WORDS: Readonly<Record<RefusalKey | 'failed', string>> = {
  unavailable: 'Archiving and removing travellers is not available yet.',
  notOwner: 'You can change only your own traveller records.',
  myselfArchive: 'Your own record cannot be archived.',
  deleted: 'This record is in Recently Deleted. Restore it first.',
  notDeleted: 'This record is not in Recently Deleted any more.',
  notEmpty:
    'This record holds details, documents or other information, so it can only be archived.',
  lastMyself: 'Your own record can be removed only while another record for you stays.',
  lastEveryday: 'Keep at least one traveller in use. Restore or add another traveller first.',
  onlyRecord: 'Your only traveller record cannot be removed.',
  noCode: 'That did not work. Try again in a moment.',
  failed: 'That did not work. Try again in a moment.',
};

const DONE_WORDS = {
  archived: 'Archived. They are hidden from your everyday lists, and their reminders stop.',
  restored: 'Restored. They are back in your everyday lists.',
  removed: 'Moved to Recently Deleted. You can restore this record until it is removed for good.',
} as const;

export type TravellerOutcome = keyof typeof DONE_WORDS | `refused-${RefusalKey | 'failed'}`;

/** The outcome word for a service refusal message (an unknown message is "failed"). */
export function refusalOutcome(message: string): TravellerOutcome {
  const key = (Object.keys(TRAVELLER_REFUSALS) as RefusalKey[]).find(
    (candidate) => TRAVELLER_REFUSALS[candidate] === message,
  );
  return `refused-${key ?? 'failed'}`;
}

/** The sentence for an outcome word from the address, or null for anything not listed. */
export function outcomeMessage(
  value: string | readonly string[] | undefined,
): { readonly ok: boolean; readonly text: string } | null {
  const word = typeof value === 'string' ? value : undefined;
  if (!word) return null;
  if (Object.hasOwn(DONE_WORDS, word)) {
    return { ok: true, text: DONE_WORDS[word as keyof typeof DONE_WORDS] };
  }
  const refusal = word.startsWith('refused-') ? word.slice('refused-'.length) : '';
  if (Object.hasOwn(REFUSAL_WORDS, refusal)) {
    return { ok: false, text: REFUSAL_WORDS[refusal as RefusalKey | 'failed'] };
  }
  return null;
}
