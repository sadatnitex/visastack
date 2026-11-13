'use server';

import {
  COMPANION_SHARE_LEVELS,
  type Db,
  type TripCompanionAccess,
  accountPrincipal,
  chooseTripPaper,
  joinedCompanionAccess,
  leaveTrip,
  listApplicants,
  planMyOwnCase,
  removeTripPaper,
  requireAccess,
  setCompanionShareLevel,
  tripCompanionsEnabled,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { reportServerError } from '../../../../lib/server-error';
import { serviceErrorMessage } from '../../../../lib/service-error-message';
import { withSession } from '../../../../lib/session';
import { linkTripChecklist } from '../../trips/trip-checklist';
import { JOINED_TRIP_UNAVAILABLE } from './words';

/**
 * UMPE UX6 package 4: what a joined companion does on their own trip page. Every action finds the
 * trip from the address in the form AND the signed-in account (`joinedCompanionAccess`), so a
 * removed, left, declined or unknown trip, someone else's trip, and the switch being off are all
 * the one fixed answer. The account always comes from the session, never from a form field. Only
 * fixed words go back to the browser: never an address, a paper's details or an id.
 */

const FAILED = 'Something went wrong. Try again.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unavailable = (): FormResult => ({ ok: false, message: JOINED_TRIP_UNAVAILABLE });

function idOf(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/** Runs `run` with the joined companion's access to the trip in the form; one answer for any problem. */
async function asCompanion(
  form: FormData,
  action: string,
  run: (ctx: {
    db: Db;
    accountId: string;
    access: TripCompanionAccess;
    tripId: string;
  }) => Promise<FormResult>,
): Promise<FormResult> {
  if (!tripCompanionsEnabled()) return unavailable();
  const tripId = idOf(form, 'tripId');
  if (tripId === null) return unavailable();
  try {
    const outcome = await withSession(async ({ db, accountId }) => {
      const access = await joinedCompanionAccess(db, accountId, tripId);
      return access ? run({ db, accountId, access, tripId }) : unavailable();
    });
    revalidatePath(`/app/trip-invitations/${tripId}`);
    return outcome;
  } catch (error) {
    unstable_rethrow(error);
    reportServerError(action, error);
    return { ok: false, message: FAILED };
  }
}

/** What You Share with the Organiser: takes effect on the organiser's next read. */
export async function setShareLevelAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const level = String(form.get('shareLevel') ?? '');
  if (!(COMPANION_SHARE_LEVELS as readonly string[]).includes(level)) {
    return { ok: false, message: 'Choose how much you want to share.', field: 'shareLevel' };
  }
  return asCompanion(form, 'setShareLevelAction', async ({ db, access }) => {
    const changed = await setCompanionShareLevel(db, access, level);
    return changed.ok ? { ok: true, message: 'Saved.' } : unavailable();
  });
}

/** Leave This Trip: confirmed once on the page; access ends on the next read. */
export async function leaveTripAction(_previous: FormResult, form: FormData): Promise<FormResult> {
  const result = await asCompanion(form, 'leaveTripAction', async ({ db, access }) => {
    const left = await leaveTrip(db, access);
    return left.ok ? { ok: true, message: '' } : unavailable();
  });
  if (result.ok) {
    revalidatePath('/app/trips');
    redirect('/app/trips');
  }
  return result;
}

/** Where a person with no record of their own goes first, and the way back to this trip. */
async function ownRecordHref(db: Db, accountId: string, tripId: string): Promise<string> {
  const back = `/app/trip-invitations/${tripId}`;
  // Nobody on file yet: the first-run "Who is this record for" step, which returns here. Someone who
  // manages other people but has no record of their own adds it from All Travellers.
  return (await listApplicants(db, accountId)).length === 0
    ? `/app?next=${encodeURIComponent(back)}`
    : '/app/applicants';
}

/** Plan My Own Case for This Trip: their own case on their own account, then straight to it. */
export async function planOwnCaseAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  let destination: string | null = null;
  const result = await asCompanion(
    form,
    'planOwnCaseAction',
    async ({ db, accountId, access, tripId }) => {
      const planned = await planMyOwnCase(db, access);
      if (!planned.ok) {
        return planned.error.code === 'consent_required'
          ? {
              ok: false,
              message: 'Turn on Let VisaStack Process My Details on Home, then try again.',
            }
          : unavailable();
      }
      if (planned.value.status === 'needs_own_record') {
        destination = await ownRecordHref(db, accountId, tripId);
        return { ok: true, message: '' };
      }
      if (planned.value.status === 'started') {
        // The same checklist a trip traveller gets when it certainly covers the trip. Best effort.
        await linkTripChecklist(
          db,
          accountId,
          planned.value.missionId,
          planned.value.destination,
          planned.value.purpose,
        );
      }
      destination = `/app/mission/${planned.value.missionId}`;
      return { ok: true, message: '' };
    },
  );
  if (result.ok && destination !== null) redirect(destination);
  return result;
}

/** Show one of their own papers to the organiser, by name only. */
export async function choosePaperAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const documentId = idOf(form, 'documentId');
  if (documentId === null) {
    return { ok: false, message: 'Choose one of your papers.', field: 'documentId' };
  }
  return asCompanion(form, 'choosePaperAction', async ({ db, accountId, access }) => {
    // Their own owner proof of this one paper: a paper that is not theirs never gets this far.
    const proof = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { documentId },
      { purpose: 'owner_trip' },
    );
    if (!proof.ok)
      return { ok: false, message: 'That paper is not available.', field: 'documentId' };
    const chosen = await chooseTripPaper(db, access, proof.value);
    if (chosen.ok) return { ok: true, message: 'Added.' };
    // The service's words are fixed sentences about the paper or the level, never about anyone else.
    return chosen.error.code === 'invalid'
      ? { ok: false, message: await serviceErrorMessage(chosen.error), field: 'documentId' }
      : { ok: false, message: 'That paper is not available.', field: 'documentId' };
  });
}

/** Stop showing one paper to the organiser. */
export async function removePaperAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const documentId = idOf(form, 'documentId');
  if (documentId === null) return unavailable();
  return asCompanion(form, 'removePaperAction', async ({ db, access }) => {
    const removed = await removeTripPaper(db, access, documentId);
    return removed.ok ? { ok: true, message: 'Removed.' } : unavailable();
  });
}
