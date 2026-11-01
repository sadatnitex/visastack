'use server';

import {
  accountPrincipal,
  archiveTraveller,
  deleteEmptyTraveller,
  requireAccess,
  restoreDeletedTraveller,
  restoreTraveller,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isRecordId } from '../../../../../lib/record-id';
import { withSession } from '../../../../../lib/session';
import { OUTCOME_PARAM, type TravellerOutcome, refusalOutcome } from './messages';

/*
 * Archive Traveller, Restore Traveller and Remove Empty Record (LC-E), as plain form actions so
 * they work without script. Each opens the central gate as the record's owner (MANAGE) and hands
 * the proof to the service, which checks it again; nothing here decides who may act. The person
 * is then sent back with one outcome word, which the page turns into a sentence.
 */

const COMMANDS = ['archive', 'restore', 'remove', 'restoreDeleted'] as const;
type Command = (typeof COMMANDS)[number];

/**
 * Where to land afterwards: the traveller's own page, or the list of all travellers. A record just
 * moved to Recently Deleted lands on the list, where its Restore button is.
 */
function landing(applicantId: string, returnTo: string, outcome: TravellerOutcome): string {
  const query = `?${OUTCOME_PARAM}=${outcome}`;
  return returnTo === 'list' || outcome === 'removed'
    ? `/app/applicants${query}#traveller-outcome`
    : `/app/applicant/${applicantId}${query}#traveller-outcome`;
}

async function perform(applicantId: string, command: Command): Promise<TravellerOutcome> {
  return withSession(async ({ db, accountId }): Promise<TravellerOutcome> => {
    try {
      const access = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { applicantId },
        { purpose: 'owner_traveller_lifecycle' },
      );
      if (!access.ok || access.value.actor.kind !== 'applicant_owner') return 'refused-notOwner';
      const proof = access.value;
      const result =
        command === 'archive'
          ? await archiveTraveller(proof)
          : command === 'restore'
            ? await restoreTraveller(proof)
            : command === 'remove'
              ? await deleteEmptyTraveller(proof)
              : await restoreDeletedTraveller(proof);
      if (!result.ok) return refusalOutcome(result.error.message);
      return command === 'archive' ? 'archived' : command === 'remove' ? 'removed' : 'restored';
    } catch (error) {
      // Message only: a driver error can carry query parameters.
      console.error(
        `[traveller-lifecycle] ${command} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'refused-failed';
    }
  });
}

/** The one form action behind every traveller lifecycle button. */
export async function travellerLifecycleAction(formData: FormData): Promise<void> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const command = String(formData.get('command') ?? '');
  const returnTo = String(formData.get('returnTo') ?? '');
  if (!isRecordId(applicantId) || !(COMMANDS as readonly string[]).includes(command)) {
    redirect('/app/applicants');
  }
  const outcome = await perform(applicantId, command as Command);
  revalidatePath('/app', 'layout');
  redirect(landing(applicantId, returnTo, outcome));
}
