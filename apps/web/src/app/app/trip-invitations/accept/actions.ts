'use server';

import {
  COMPANION_NAME_PROBLEM,
  COMPANION_SHARE_LEVELS,
  acceptCompanionInvitation,
  cleanCompanionName,
  declineCompanionInvitation,
  openCompanionInvitation,
  readCompanionTripSummary,
  tripCompanionsEnabled,
} from '@visastack/services';
import { redirect, unstable_rethrow } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { reportServerError } from '../../../../lib/server-error';
import { serviceErrorMessage } from '../../../../lib/service-error-message';
import { withSession } from '../../../../lib/session';
import { networkLimited } from './network-limit';
import {
  CONSENT_FIRST,
  INVITATION_BUSY,
  INVITATION_UNAVAILABLE,
  SHARE_LEVEL_PROBLEM,
} from './words';

/**
 * UMPE UX6: answering an invitation to travel with someone. Both answers are confirmed POSTs from
 * the accept page, never a link: opening the link only shows the page. Each one counts against the
 * visitor's network address and the signed-in account, opens the invitation as that account (its
 * verified email must be the invited one) and then acts. Every bad invitation, and every "too many
 * tries", answers with one fixed wording, so nothing says which case it was or whether an address
 * has an account. The link's token comes from the form and is never put in an answer or a log.
 */

const FAILED = 'Something went wrong. Try again.';

const unavailable = (): FormResult => ({ ok: false, message: INVITATION_UNAVAILABLE });
const busy = (): FormResult => ({ ok: false, message: INVITATION_BUSY });

function tokenOf(form: FormData): string {
  return String(form.get('token') ?? '');
}

/** The share level from the form: Name Only when none is sent, otherwise only a listed value. */
function shareLevelOf(form: FormData): string | null {
  const raw = form.get('shareLevel');
  if (raw === null) return 'NAME_ONLY';
  return typeof raw === 'string' && (COMPANION_SHARE_LEVELS as readonly string[]).includes(raw)
    ? raw
    : null;
}

export async function acceptTripInvitationAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  if (!tripCompanionsEnabled()) return unavailable();
  // The button that was pressed says it is a join (a forged post without it is not one).
  if (form.get('intent') !== 'join') return unavailable();
  const name = cleanCompanionName(String(form.get('displayName') ?? ''));
  if (name === null) return { ok: false, message: COMPANION_NAME_PROBLEM, field: 'displayName' };
  const level = shareLevelOf(form);
  if (level === null) return { ok: false, message: SHARE_LEVEL_PROBLEM, field: 'shareLevel' };
  const rawToken = tokenOf(form);
  let outcome: FormResult;
  try {
    outcome = await withSession(async ({ db, accountId }): Promise<FormResult> => {
      if (await networkLimited(db)) return busy();
      const access = await openCompanionInvitation(db, { accountId, rawToken });
      if (!access.ok) return access.error.code === 'rate_limited' ? busy() : unavailable();
      // The name is sent as a change only when it differs from the one the organiser typed.
      const shown = await readCompanionTripSummary(db, access.value);
      const accepted = await acceptCompanionInvitation(db, access.value, {
        rawToken,
        shareLevel: level,
        ...(shown.ok && shown.value.displayName === name ? {} : { displayName: name }),
      });
      if (accepted.ok) return { ok: true, message: '' };
      switch (accepted.error.code) {
        case 'consent_required':
          return { ok: false, message: CONSENT_FIRST };
        case 'rate_limited':
          return busy();
        case 'invalid':
          return { ok: false, message: await serviceErrorMessage(accepted.error) };
        default:
          return unavailable();
      }
    });
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('acceptTripInvitationAction', error);
    return { ok: false, message: FAILED };
  }
  if (outcome.ok) redirect('/app/trip-invitations/accept?done=joined');
  return outcome;
}

export async function declineTripInvitationAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  if (!tripCompanionsEnabled()) return unavailable();
  if (form.get('intent') !== 'decline') return unavailable();
  const rawToken = tokenOf(form);
  let outcome: FormResult;
  try {
    outcome = await withSession(async ({ db, accountId }): Promise<FormResult> => {
      if (await networkLimited(db)) return busy();
      const access = await openCompanionInvitation(db, { accountId, rawToken });
      if (!access.ok) return access.error.code === 'rate_limited' ? busy() : unavailable();
      const declined = await declineCompanionInvitation(db, access.value, { rawToken });
      if (declined.ok) return { ok: true, message: '' };
      return declined.error.code === 'rate_limited' ? busy() : unavailable();
    });
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('declineTripInvitationAction', error);
    return { ok: false, message: FAILED };
  }
  if (outcome.ok) redirect('/app/trip-invitations/accept?done=declined');
  return outcome;
}
