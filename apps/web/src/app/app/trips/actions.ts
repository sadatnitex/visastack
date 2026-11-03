'use server';

import {
  type Db,
  TRIP_MAX_TRAVELLERS,
  accountPrincipal,
  addTravellerToTrip,
  addTripEvidence,
  createApplicant,
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
import { tripExists } from './trip-data';

/**
 * UMPE P5: the group trip actions. Every one runs through the access gate as the owner of the one
 * traveller (or document) it is about; the services check the trip's owner again, so a trip of
 * another account looks missing. Nothing here shares anything with another account.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  ].slice(0, TRIP_MAX_TRAVELLERS);
}

/** The most characters a person's name may have (the trip service uses the same limit). */
const NAME_MAX = 120;

type ManagedKind = 'FAMILY_MEMBER' | 'MINOR_GUARDIAN';

/** The "Add a Family Member" part of a form: absent, refused with a reason, or ready to make. */
type NewMember =
  | { readonly status: 'none' }
  | { readonly status: 'refused'; readonly result: ActionState }
  | { readonly status: 'ready'; readonly name: string; readonly kind: ManagedKind };

/**
 * Reads the family member typed into a trip form. The fields exist only while the section is
 * open, so their absence means nobody is being added. A person is made only with a name, a
 * relationship that is not "myself", and the same authority confirmation the Home form asks for.
 */
function readNewMember(formData: FormData): NewMember {
  if (!formData.has('newName')) return { status: 'none' };
  const refuse = (message: string, field: string): NewMember => ({
    status: 'refused',
    result: { ok: false, message, field },
  });
  const name = String(formData.get('newName') ?? '').trim();
  if (name === '') return refuse('Enter their name, or close Add a Family Member.', 'newName');
  if (name.length > NAME_MAX) return refuse(`Keep the name to ${NAME_MAX} characters.`, 'newName');
  const kind = formData.get('newKind');
  if (kind !== 'FAMILY_MEMBER' && kind !== 'MINOR_GUARDIAN') {
    return refuse('Choose Family Member or Minor (Guardian).', 'newKind');
  }
  if (formData.get('newAuthority') !== 'true') {
    return refuse('Confirm you have authority to create this record.', 'newAuthority');
  }
  return { status: 'ready', name, kind };
}

/** Whether the account holder manages every one of these travellers (checked before anything is made). */
async function managesAll(db: Db, accountId: string, applicantIds: readonly string[]) {
  for (const applicantId of applicantIds) {
    if (!(await travellerProof(db, accountId, applicantId)).ok) return false;
  }
  return true;
}

/**
 * Makes the family member the person typed, owned by the signed-in account and with the authority
 * they confirmed, through the same service the Home form uses. Nothing is shared and no account
 * is created for them.
 */
async function makeMember(
  db: Db,
  accountId: string,
  member: Extract<NewMember, { status: 'ready' }>,
): Promise<{ readonly applicantId: string } | { readonly refused: ActionState }> {
  const made = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: member.name,
    relationship: member.kind,
    authorityConfirmed: true,
  });
  if (!made.ok) {
    return {
      refused: {
        ok: false,
        message: consentWords(made.error.code, made.error.message),
        ...(made.error.code === 'invalid' ? { field: 'newName' } : {}),
      },
    };
  }
  revalidatePath('/app');
  revalidatePath('/app/applicants');
  revalidatePath('/app/trips/new');
  return { applicantId: made.value.id };
}

/** A failure that comes after a person was made says so, so the form can tick them. */
function afterMember(result: ActionState, createdId: string | undefined): ActionState {
  return createdId && !result.ok ? { ...result, created: createdId } : result;
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
  const member = readNewMember(formData);
  if (member.status === 'refused') return member.result;
  if (travellers.length === 0 && member.status === 'none') {
    return {
      ok: false,
      message: 'Choose who is travelling, or add a family member.',
      field: 'traveller',
    };
  }
  let tripId: string | null = null;
  let outcome: ActionState;
  try {
    outcome = await withSession(async ({ db, accountId }) => {
      // Every ticked traveller is checked before anything is made, so a refused try leaves nothing behind.
      if (!(await managesAll(db, accountId, travellers))) {
        return { ok: false, message: TRAVELLER_UNAVAILABLE, field: 'traveller' };
      }
      const everyone = [...travellers];
      let createdId: string | undefined;
      if (member.status === 'ready') {
        const made = await makeMember(db, accountId, member);
        if ('refused' in made) return made.refused;
        createdId = made.applicantId;
        everyone.push(made.applicantId);
      }
      const [firstTraveller, ...others] = everyone;
      if (!firstTraveller) return { ok: false, message: TRAVELLER_UNAVAILABLE, field: 'traveller' };
      const proof = await travellerProof(db, accountId, firstTraveller);
      if (!proof.ok) {
        return afterMember(
          { ok: false, message: TRAVELLER_UNAVAILABLE, field: 'traveller' },
          createdId,
        );
      }
      const started = await startGroupTrip(proof.value, {
        destination: country.name,
        purpose: purpose.label,
      });
      if (!started.ok) {
        return afterMember(
          {
            ok: false,
            message: `${proof.value.applicant.displayName}: ${consentWords(started.error.code, started.error.message)}`,
            field: 'traveller',
          },
          createdId,
        );
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
    outcome = { ok: false, message: FAILED };
  }
  if (tripId) {
    // The trip exists even if a later traveller was refused or a step failed: always go to it, so
    // trying again adds the others there instead of starting a second trip.
    revalidatePath('/app/trips');
    redirect(`/app/trips/${tripId}${outcome.ok ? '' : '?done=partial'}`);
  }
  return outcome;
}

/** After a change that removes the form it came from, the trip page says what happened. */
function backToTrip(tripId: string, done: 'added' | 'removed' | 'shared' | 'unshared'): never {
  redirect(`/app/trips/${tripId}?done=${done}`);
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
  const member = readNewMember(formData);
  if (member.status === 'refused') return member.result;
  if (travellers.length === 0 && member.status === 'none') {
    return {
      ok: false,
      message: 'Choose who else is travelling, or add a family member.',
      field: 'traveller',
    };
  }
  const outcome = await onTrip(formData, 'addTravellersAction', async (db, accountId, tripId) => {
    // The trip and every ticked traveller are checked before anyone is made, so a trip that is not
    // this account's (or a refused try) leaves no record behind.
    if (!(await tripExists(db, accountId, tripId))) return { ok: false, message: TRIP_UNAVAILABLE };
    if (!(await managesAll(db, accountId, travellers))) {
      return { ok: false, message: TRAVELLER_UNAVAILABLE, field: 'traveller' };
    }
    const everyone = [...travellers];
    let createdId: string | undefined;
    if (member.status === 'ready') {
      const made = await makeMember(db, accountId, member);
      if ('refused' in made) return made.refused;
      createdId = made.applicantId;
      everyone.push(made.applicantId);
    }
    return afterMember(await addEach(db, accountId, tripId, everyone), createdId);
  });
  if (outcome.ok) backToTrip(String(formData.get('tripId')), 'added');
  return outcome;
}

export async function removeTravellerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  if (!UUID.test(applicantId)) return { ok: false, message: TRAVELLER_UNAVAILABLE };
  const outcome = await onTrip(formData, 'removeTravellerAction', async (db, accountId, tripId) => {
    const proof = await travellerProof(db, accountId, applicantId);
    if (!proof.ok) return { ok: false, message: TRAVELLER_UNAVAILABLE };
    const removed = await removeTravellerFromTrip(proof.value, tripId);
    if (!removed.ok) return { ok: false, message: removed.error.message };
    return { ok: true, message: '' };
  });
  if (outcome.ok) backToTrip(String(formData.get('tripId')), 'removed');
  return outcome;
}

export async function addTripEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const documentId = String(formData.get('documentId') ?? '');
  if (!UUID.test(documentId)) {
    return { ok: false, message: 'Choose a travel document to share.', field: 'documentId' };
  }
  const outcome = await onTrip(formData, 'addTripEvidenceAction', async (db, accountId, tripId) => {
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
    return { ok: true, message: '' };
  });
  if (outcome.ok) backToTrip(String(formData.get('tripId')), 'shared');
  return outcome;
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
  const outcome = await onTrip(
    formData,
    'removeTripEvidenceAction',
    async (db, accountId, tripId) => {
      const proof = await travellerProof(db, accountId, applicantId);
      if (!proof.ok) return { ok: false, message: TRAVELLER_UNAVAILABLE };
      const removed = await removeTripEvidence(proof.value, tripId, evidenceId);
      if (!removed.ok) return { ok: false, message: removed.error.message };
      return { ok: true, message: '' };
    },
  );
  if (outcome.ok) backToTrip(String(formData.get('tripId')), 'unshared');
  return outcome;
}
