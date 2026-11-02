'use server';

import {
  type Db,
  accountPrincipal,
  addTravellerToTrip,
  addTripEvidence,
  removeTravellerFromTrip,
  removeTripEvidence,
  requireAccess,
  setTripEvidenceAllowance,
  startGroupTrip,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import type { FormResult } from '../../../components/form-feedback';
import { caseCountry, casePurpose } from '../../../lib/case-choices';
import { reportServerError } from '../../../lib/server-error';
import { withSession } from '../../../lib/session';
import { linkTripChecklist } from './trip-checklist';

/**
 * UMPE P5: the group trip actions. Every one runs through the access gate as the owner of the one
 * traveller (or document) it is about; the services check the trip's owner again, so a trip of
 * another account looks missing. Nothing here shares anything with another account.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TRAVELLERS = 12;
const TRAVELLER_UNAVAILABLE = 'One of these travellers is not available to you.';
const TRIP_UNAVAILABLE = 'This trip is not available to you.';
const FAILED = 'Something went wrong. Try again.';

type ActionState = FormResult;

/** The ticked travellers (ids only, deduplicated, capped). */
function ticked(formData: FormData): string[] {
  return [
    ...new Set(
      formData
        .getAll('traveller')
        .map((v) => String(v))
        .filter((v) => UUID.test(v)),
    ),
  ].slice(0, MAX_TRAVELLERS);
}

async function travellerProof(db: Db, accountId: string, applicantId: string) {
  return requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { applicantId },
    { purpose: 'owner_trip' },
  );
}

function consentWords(code: string, message: string): string {
  return code === 'consent_required'
    ? 'Turn on Let VisaStack Process My Details on Home, then try again.'
    : message;
}

/** Add each ticked traveller in turn; stops at the first refusal and says who was added. */
async function addEach(
  db: Db,
  accountId: string,
  tripId: string,
  applicantIds: readonly string[],
): Promise<ActionState> {
  let added = 0;
  for (const applicantId of applicantIds) {
    const proof = await travellerProof(db, accountId, applicantId);
    if (!proof.ok) return { ok: false, message: TRAVELLER_UNAVAILABLE, field: 'traveller' };
    const linked = await addTravellerToTrip(proof.value, tripId);
    if (!linked.ok) {
      const name = proof.value.applicant.displayName;
      const lead = added > 0 ? `${added} added. ` : '';
      return {
        ok: false,
        message: `${lead}${name}: ${consentWords(linked.error.code, linked.error.message)}`,
        field: 'traveller',
      };
    }
    if (!linked.value.existingCase) {
      await linkTripChecklist(
        db,
        accountId,
        linked.value.missionId,
        linked.value.destination,
        linked.value.purpose,
      );
    }
    added += 1;
  }
  return { ok: true, message: '' };
}

export async function startGroupTripAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const country = caseCountry(String(formData.get('destination') ?? ''));
  if (!country) return { ok: false, message: 'Choose where you are going.', field: 'destination' };
  const purpose = casePurpose(String(formData.get('purpose') ?? ''));
  if (!purpose) return { ok: false, message: 'Choose why you are travelling.', field: 'purpose' };
  const travellers = ticked(formData);
  const [firstTraveller, ...others] = travellers;
  if (!firstTraveller) {
    return { ok: false, message: 'Choose who is travelling.', field: 'traveller' };
  }
  let tripId: string | null = null;
  let outcome: ActionState;
  try {
    outcome = await withSession(async ({ db, accountId }) => {
      const proof = await travellerProof(db, accountId, firstTraveller);
      if (!proof.ok) return { ok: false, message: TRAVELLER_UNAVAILABLE, field: 'traveller' };
      const started = await startGroupTrip(proof.value, {
        destination: country.name,
        purpose: purpose.label,
      });
      if (!started.ok) {
        return {
          ok: false,
          message: `${proof.value.applicant.displayName}: ${consentWords(started.error.code, started.error.message)}`,
          field: 'traveller',
        };
      }
      tripId = started.value.tripId;
      if (!started.value.existingCase) {
        await linkTripChecklist(
          db,
          accountId,
          started.value.missionId,
          country.name,
          purpose.label,
        );
      }
      return addEach(db, accountId, started.value.tripId, others);
    });
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('startGroupTripAction', error);
    return { ok: false, message: FAILED };
  }
  if (tripId) {
    revalidatePath('/app/trips');
    // The trip exists even if a later traveller was refused; its page says who is on it.
    if (outcome.ok) redirect(`/app/trips/${tripId}`);
    return { ...outcome, message: `${outcome.message} Open the trip to see who is on it.` };
  }
  return outcome;
}

/** Runs `run` for a trip id from the form, refreshing the trip page after a success. */
async function onTrip(
  formData: FormData,
  action: string,
  run: (db: Db, accountId: string, tripId: string) => Promise<ActionState>,
): Promise<ActionState> {
  const tripId = String(formData.get('tripId') ?? '');
  if (!UUID.test(tripId)) return { ok: false, message: TRIP_UNAVAILABLE };
  try {
    const outcome = await withSession(({ db, accountId }) => run(db, accountId, tripId));
    revalidatePath(`/app/trips/${tripId}`);
    return outcome;
  } catch (error) {
    unstable_rethrow(error);
    reportServerError(action, error);
    return { ok: false, message: FAILED };
  }
}

export async function addTravellersAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const travellers = ticked(formData);
  if (travellers.length === 0) {
    return { ok: false, message: 'Choose who else is travelling.', field: 'traveller' };
  }
  return onTrip(formData, 'addTravellersAction', async (db, accountId, tripId) => {
    const outcome = await addEach(db, accountId, tripId, travellers);
    if (!outcome.ok) return outcome;
    return {
      ok: true,
      message:
        travellers.length === 1
          ? 'Traveller added with their own case.'
          : 'Travellers added, each with their own case.',
    };
  });
}

export async function removeTravellerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  if (!UUID.test(applicantId)) return { ok: false, message: TRAVELLER_UNAVAILABLE };
  return onTrip(formData, 'removeTravellerAction', async (db, accountId, tripId) => {
    const proof = await travellerProof(db, accountId, applicantId);
    if (!proof.ok) return { ok: false, message: TRAVELLER_UNAVAILABLE };
    const removed = await removeTravellerFromTrip(proof.value, tripId);
    if (!removed.ok) return { ok: false, message: removed.error.message };
    return { ok: true, message: 'Removed from the trip. Their case is kept as it is.' };
  });
}

export async function addTripEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const documentId = String(formData.get('documentId') ?? '');
  if (!UUID.test(documentId)) {
    return { ok: false, message: 'Choose a travel document to share.', field: 'documentId' };
  }
  return onTrip(formData, 'addTripEvidenceAction', async (db, accountId, tripId) => {
    const proof = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { documentId },
      { purpose: 'owner_trip' },
    );
    if (!proof.ok) {
      return { ok: false, message: 'That document is not available.', field: 'documentId' };
    }
    const added = await addTripEvidence(proof.value, tripId);
    if (!added.ok) return { ok: false, message: added.error.message, field: 'documentId' };
    return {
      ok: true,
      message: added.value.added
        ? 'Added to the trip. Choose who it may be used for.'
        : 'This document is already on the trip.',
    };
  });
}

export async function tripEvidenceAllowanceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const evidenceId = String(formData.get('evidenceId') ?? '');
  const applicantId = String(formData.get('applicantId') ?? '');
  const allowed = formData.get('allowed') === 'yes';
  if (!UUID.test(evidenceId) || !UUID.test(applicantId)) {
    return { ok: false, message: 'That shared document is not available.' };
  }
  return onTrip(formData, 'tripEvidenceAllowanceAction', async (db, accountId, tripId) => {
    const proof = await travellerProof(db, accountId, applicantId);
    if (!proof.ok) return { ok: false, message: TRAVELLER_UNAVAILABLE };
    const changed = await setTripEvidenceAllowance(proof.value, tripId, evidenceId, allowed);
    if (!changed.ok) return { ok: false, message: changed.error.message };
    return {
      ok: true,
      message: allowed
        ? `Can now be used for ${proof.value.applicant.displayName}.`
        : `No longer used for ${proof.value.applicant.displayName}.`,
    };
  });
}

export async function removeTripEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const evidenceId = String(formData.get('evidenceId') ?? '');
  const applicantId = String(formData.get('applicantId') ?? '');
  if (!UUID.test(evidenceId) || !UUID.test(applicantId)) {
    return { ok: false, message: 'That shared document is not available.' };
  }
  return onTrip(formData, 'removeTripEvidenceAction', async (db, accountId, tripId) => {
    const proof = await travellerProof(db, accountId, applicantId);
    if (!proof.ok) return { ok: false, message: TRAVELLER_UNAVAILABLE };
    const removed = await removeTripEvidence(proof.value, tripId, evidenceId);
    if (!removed.ok) return { ok: false, message: removed.error.message };
    return {
      ok: true,
      message: 'No longer shared across the trip. The document stays in its own place.',
    };
  });
}
