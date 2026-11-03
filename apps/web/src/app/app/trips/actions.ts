'use server';

import {
  type AuthorizedApplicant,
  COMPANION_INVITATION_DAYS,
  COMPANION_NAME_PROBLEM,
  COMPANION_NOT_SWITCHED_ON,
  type CompanionInvitationDelivery,
  type Db,
  TRIP_MAX_TRAVELLERS,
  accountPrincipal,
  addCompanion,
  addTravellerToTrip,
  addTripEvidence,
  cleanCompanionName,
  createApplicant,
  getTrip,
  isEmailAddress,
  listApplicants,
  queueCompanionInvitation,
  removeCompanion,
  removeTravellerFromTrip,
  removeTripEvidence,
  requireAccess,
  resendInvitation,
  setTripEvidenceAllowance,
  startGroupTrip,
  tripCompanionsAvailable,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { after } from 'next/server';
import type { FormResult } from '../../../components/form-feedback';
import { caseCountry, casePurpose } from '../../../lib/case-choices';
import { createKeyManagementPort } from '../../../lib/providers';
import { sendEmailNow } from '../../../lib/send-now';
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

/** The "Add Someone Else" part of a form: absent, refused with a reason, or ready to add. */
type NewPerson =
  | { readonly status: 'none' }
  | { readonly status: 'refused'; readonly result: ActionState }
  | {
      readonly status: 'ready';
      readonly name: string;
      /** As typed, trimmed; empty means a name with no email. Never sent back to the browser. */
      readonly email: string;
    };

/**
 * Reads the person typed into "Add Someone Else". The fields exist only while the section is open,
 * so their absence means nobody is being added. The name follows the service's own rule and
 * wording, so a bad name is refused here, before anyone else is made.
 */
function readNewPerson(formData: FormData): NewPerson {
  if (!formData.has('newPersonName')) return { status: 'none' };
  const refuse = (message: string, field: string): NewPerson => ({
    status: 'refused',
    result: { ok: false, message, field },
  });
  const name = cleanCompanionName(String(formData.get('newPersonName') ?? ''));
  if (name === null) return refuse(COMPANION_NAME_PROBLEM, 'newPersonName');
  const email = String(formData.get('newPersonEmail') ?? '').trim();
  if (email !== '' && !isEmailAddress(email.toLowerCase())) {
    return refuse('Enter a valid email address, or leave it empty.', 'newPersonEmail');
  }
  return { status: 'ready', name, email };
}

/**
 * Someone else can only be added while the feature is on, and the check comes before anything is
 * made, so a refused try leaves nobody behind. The words are the service's own.
 */
async function companionsRefusal(db: Db, person: NewPerson): Promise<ActionState | null> {
  if (person.status !== 'ready' || (await tripCompanionsAvailable(db))) return null;
  return { ok: false, message: COMPANION_NOT_SWITCHED_ON, field: 'newPersonName' };
}

/**
 * What a refused companion step says. The service's words go through unchanged (they are the same
 * for every address, so nothing here depends on whether an address has an account); only the
 * consent refusal gets the usual pointer to Home.
 */
function companionRefusal(error: { readonly code: string; readonly message: string }): ActionState {
  return { ok: false, message: consentWords(error.code, error.message) };
}

/** What Add Someone Else did: the usual result, and whether an invitation was due but not queued. */
type CompanionStep = ActionState & { readonly unsent?: boolean };

/**
 * Emails the invitation the service just made, on the server and nowhere else: the raw link and the
 * address go from the service straight into the sealed outbox (the link is encrypted before it is
 * stored) and are never returned, logged or put in a result. The email itself goes out right after
 * the response, so how long this takes does not depend on the address or on how the mail provider
 * answers; the organiser is never told about delivery, a bounce or an account. A step that fails
 * leaves the person on the trip (the row exists) and answers false, so the screen can offer Send Again.
 *
 * `invitation` is null when the service made no new link (a person who declined, which reads to the
 * organiser exactly like a person still waiting). That case still asks the key service for a key
 * and drops it, so the wait is the same and the organiser cannot tell the two apart by it.
 */
async function deliverInvitation(
  proof: AuthorizedApplicant<'MANAGE'>,
  tripId: string,
  companionId: string,
  invitation: CompanionInvitationDelivery | null,
): Promise<boolean> {
  const encryption = createKeyManagementPort();
  if (!encryption) return false;
  try {
    if (invitation === null) {
      await encryption.generateDataKey();
      return true;
    }
    const queued = await queueCompanionInvitation(proof, {
      tripId,
      companionId,
      invitation,
      encryption,
    });
    if (!queued.ok) return false;
  } catch (error) {
    reportServerError('deliverInvitation', error);
    return false;
  }
  after(async () => {
    try {
      await sendEmailNow(companionId);
    } catch (error) {
      reportServerError('deliverInvitation', error, { step: 'send after response' });
    }
  });
  return true;
}

/**
 * Adds the person typed into "Add Someone Else" to a trip that exists, as its organiser. Only the
 * outcome words go back to the browser: never the address, a link or a token. With an address the
 * invitation is emailed from here (see `deliverInvitation`); the person stays on the trip even if
 * that step fails, and `unsent` tells the caller to say so.
 */
async function makeCompanion(
  proof: AuthorizedApplicant<'MANAGE'>,
  tripId: string,
  person: Extract<NewPerson, { status: 'ready' }>,
): Promise<CompanionStep> {
  const added = await addCompanion(proof, tripId, {
    name: person.name,
    ...(person.email === '' ? {} : { email: person.email }),
  });
  if (added.ok) {
    const invitation = added.value.invitation;
    if (invitation === null) return { ok: true, message: '' };
    const sent = await deliverInvitation(proof, tripId, added.value.companion.id, invitation);
    return sent ? { ok: true, message: '' } : { ok: true, message: '', unsent: true };
  }
  // The form's own fields: the problem is shown beside the one it is about.
  const refused = companionRefusal(added.error);
  return added.error.code === 'invalid'
    ? { ...refused, field: /email/i.test(refused.message) ? 'newPersonEmail' : 'newPersonName' }
    : refused;
}

/**
 * The organiser's proof for a trip: one of their own people, as an owner with the right to manage. Null when the trip is not theirs, so a forged or foreign trip id adds nobody.
 */
async function organiserProof(db: Db, accountId: string, tripId: string) {
  const applicants = await listApplicants(db, accountId);
  const first = applicants[0];
  if (!first) return null;
  const view = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId: first.id },
    { purpose: 'owner_trip' },
  );
  if (!view.ok) return null;
  // The trip must be this account's. Any of their own people can carry the proof (the services
  // check the trip's owner again), so a trip whose travellers were all removed still works.
  if (!(await getTrip(view.value, tripId)).ok) return null;
  const proof = await travellerProof(db, accountId, first.id);
  return proof.ok ? proof.value : null;
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
  const person = readNewPerson(formData);
  if (person.status === 'refused') return person.result;
  if (travellers.length === 0 && member.status === 'none') {
    return {
      ok: false,
      message: 'Choose who is travelling, or add a family member.',
      field: 'traveller',
    };
  }
  let tripId: string | null = null;
  let outcome: ActionState;
  let companionFailed = false;
  // The person was added and has an address, but the invitation could not be queued.
  let companionUnsent = false;
  try {
    outcome = await withSession(async ({ db, accountId }) => {
      // Every ticked traveller is checked before anything is made, so a refused try leaves nothing behind.
      if (!(await managesAll(db, accountId, travellers))) {
        return { ok: false, message: TRAVELLER_UNAVAILABLE, field: 'traveller' };
      }
      const switchedOff = await companionsRefusal(db, person);
      if (switchedOff) return switchedOff;
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
      const added = await addEach(db, accountId, started.value.tripId, others);
      if (!added.ok || person.status !== 'ready') {
        // Someone else was typed but never tried: the trip says so, so they are not assumed added.
        if (person.status === 'ready') companionFailed = true;
        return added;
      }
      // Someone else can only be added once the trip exists, so it comes last. A failure here
      // sends the person to the trip (see below), where Add Someone Else can be tried again.
      const companion = await makeCompanion(proof.value, started.value.tripId, person);
      companionFailed = !companion.ok;
      companionUnsent = companion.ok && companion.unsent === true;
      return companion;
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
    const done = outcome.ok
      ? companionUnsent
        ? '?done=not-sent'
        : ''
      : companionFailed
        ? '?done=partial-someone'
        : '?done=partial';
    redirect(`/app/trips/${tripId}${done}`);
  }
  return outcome;
}

/** After a change that removes the form it came from, the trip page says what happened. */
function backToTrip(
  tripId: string,
  done:
    | 'added'
    | 'added-someone'
    | 'not-sent'
    | 'partial-someone'
    | 'removed'
    | 'removed-someone'
    | 'shared'
    | 'unshared',
): never {
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
  const person = readNewPerson(formData);
  if (person.status === 'refused') return person.result;
  if (travellers.length === 0 && member.status === 'none' && person.status === 'none') {
    return {
      ok: false,
      message: 'Choose who else is travelling, or add a family member.',
      field: 'traveller',
    };
  }
  // True when the people ticked were added but the typed Someone Else was refused afterwards: the
  // form is replaced by the trip, which then says so, so the refusal is never lost.
  let someoneRefusedAfterOthers = false;
  let someoneUnsent = false;
  const outcome = await onTrip(formData, 'addTravellersAction', async (db, accountId, tripId) => {
    // The trip and every ticked traveller are checked before anyone is made, so a trip that is not
    // this account's (or a refused try) leaves no record behind.
    if (!(await tripExists(db, accountId, tripId))) return { ok: false, message: TRIP_UNAVAILABLE };
    if (!(await managesAll(db, accountId, travellers))) {
      return { ok: false, message: TRAVELLER_UNAVAILABLE, field: 'traveller' };
    }
    const switchedOff = await companionsRefusal(db, person);
    if (switchedOff) return switchedOff;
    const everyone = [...travellers];
    let createdId: string | undefined;
    if (member.status === 'ready') {
      const made = await makeMember(db, accountId, member);
      if ('refused' in made) return made.refused;
      createdId = made.applicantId;
      everyone.push(made.applicantId);
    }
    const added = afterMember(await addEach(db, accountId, tripId, everyone), createdId);
    if (!added.ok || person.status !== 'ready') return added;
    const proof = await organiserProof(db, accountId, tripId);
    if (!proof) return { ok: false, message: TRIP_UNAVAILABLE };
    const companion = await makeCompanion(proof, tripId, person);
    someoneRefusedAfterOthers = !companion.ok && everyone.length > 0;
    someoneUnsent = companion.ok && companion.unsent === true;
    return companion;
  });
  if (someoneRefusedAfterOthers) backToTrip(String(formData.get('tripId')), 'partial-someone');
  if (outcome.ok && someoneUnsent) backToTrip(String(formData.get('tripId')), 'not-sent');
  if (outcome.ok) {
    const onlySomeoneElse = everyoneTicked(travellers, member) === 0;
    backToTrip(String(formData.get('tripId')), onlySomeoneElse ? 'added-someone' : 'added');
  }
  return outcome;
}

/** How many of the account holder's own people the form adds (ticked, plus a new family member). */
function everyoneTicked(travellers: readonly string[], member: NewMember): number {
  return travellers.length + (member.status === 'ready' ? 1 : 0);
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

/**
 * Remove someone who is travelling with the organiser. Their access ends on their next read and an
 * invitation stops working at once. Their own case, if they started one, is theirs and is kept.
 */
export async function removeCompanionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const outcome = await onTrip(formData, 'removeCompanionAction', async (db, accountId, tripId) => {
    const proof = await organiserProof(db, accountId, tripId);
    if (!proof) return { ok: false, message: TRIP_UNAVAILABLE };
    const removed = await removeCompanion(proof, tripId, String(formData.get('companionId') ?? ''));
    return removed.ok ? { ok: true, message: '' } : companionRefusal(removed.error);
  });
  if (outcome.ok) backToTrip(String(formData.get('tripId')), 'removed-someone');
  return outcome;
}

/** What Send Again says when the invitation was handed on. Nothing about delivery or the address. */
const INVITATION_SENT = `A new invitation is on its way. It lasts ${COMPANION_INVITATION_DAYS} days.`;
const INVITATION_NOT_SENT =
  'The invitation could not be sent just now. Try Send Again in a moment.';

/**
 * Make a fresh invitation for someone who has not joined yet, and email it from here (the old link
 * stops working). The service answers the same way for everyone it accepts and refuses with the
 * same words whoever the address belongs to, so nothing here says anything about the address: the
 * words are the same for a person still waiting and one who declined (who is sent nothing).
 */
export async function resendCompanionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return onTrip(formData, 'resendCompanionAction', async (db, accountId, tripId) => {
    const proof = await organiserProof(db, accountId, tripId);
    if (!proof) return { ok: false, message: TRIP_UNAVAILABLE };
    const companionId = String(formData.get('companionId') ?? '');
    const again = await resendInvitation(proof, tripId, companionId);
    if (!again.ok) return companionRefusal(again.error);
    const sent = await deliverInvitation(proof, tripId, companionId, again.value.invitation);
    return sent
      ? { ok: true, message: INVITATION_SENT }
      : { ok: false, message: INVITATION_NOT_SENT };
  });
}
