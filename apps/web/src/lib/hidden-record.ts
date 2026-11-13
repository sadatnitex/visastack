import {
  type Db,
  accountPrincipal,
  appendAuditEvent,
  listAccessForApplicant,
  listComplaintsForMission,
  requireAccess,
} from '@visastack/services';

/**
 * One answer for "not yours" and "not there".
 *
 * The services tell a made-up id (`not_found`) from a real record the caller may not touch
 * (`forbidden`), and that difference is deliberate for them. A screen action that prints the
 * service's own refusal would pass it on, so a signed-in stranger who knows an id could tell a real
 * record from a nonexistent one. Each action that works on one record therefore asks here first
 * whether the signed-in account is the owner, and a stranger gets the fixed line below whichever
 * of the two it was, before any work starts. The real owner is never affected: these only return
 * true for them, and every later message is the service's own, as before.
 *
 * Ownership comes from the central access gate (live data, never from the form). A person who can
 * see a record only through a share is not its owner, so they get the fixed line too.
 */

export const CASE_HIDDEN_LINE = 'This case is not available to you.';
export const PROFILE_HIDDEN_LINE = 'This profile is not available to you.';
export const GRANT_HIDDEN_LINE = 'This access is not available to you.';
export const COMPLAINT_HIDDEN_LINE = 'This complaint is not available to you.';
export const SUGGESTION_HIDDEN_LINE = 'This suggestion is not available to you.';
export const FLAG_HIDDEN_LINE = 'This item is not available to you.';
export const NAME_HIDDEN_LINE = 'This naming proposal is not available to you.';

/**
 * For an action that already proved the caller owns the traveller named in the form and then acts on
 * a SECOND id (a suggestion, a flag, a naming proposal): the service says `not_found` for a made-up
 * id and `forbidden` for a real one that belongs to someone else, and printing either tells a
 * signed-in stranger which ids are real. Both get the one line; every other refusal keeps the
 * service's own words.
 */
export function refusalLine(
  error: { readonly code: string; readonly message: string },
  hiddenLine: string,
  /** The words for any other refusal; the service's English unless the caller has them translated. */
  otherwise: string = error.message,
): string {
  return error.code === 'forbidden' || error.code === 'not_found' ? hiddenLine : otherwise;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function isOwner(
  db: Db,
  accountId: string,
  ref: { readonly missionId: string } | { readonly applicantId: string },
): Promise<boolean> {
  const access = await requireAccess(db, accountPrincipal(accountId), 'VIEW_METADATA', ref, {
    purpose: 'self',
  });
  if (!access.ok && access.error.code === 'forbidden') await recordRefusedProbe(db, accountId, ref);
  return access.ok && access.value.actor.kind === 'applicant_owner';
}

/**
 * A signed-in account reached for a record that exists and is not theirs. The services this pre-check
 * now stands in front of used to write a denied event for this; one is written here so the audit
 * trail keeps the probe (ids only, never a value). A made-up id has no record to name and writes
 * nothing. Writing can never change the answer the person gets: a failure here is swallowed.
 */
async function recordRefusedProbe(
  db: Db,
  accountId: string,
  ref: { readonly missionId: string } | { readonly applicantId: string },
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'HIDDEN_RECORD_REFUSED',
        actorAccountId: accountId,
        action: 'VIEW_METADATA',
        result: 'DENIED',
        method: 'MANUAL',
        resourceType: 'missionId' in ref ? 'case' : 'applicant',
        resourceId: 'missionId' in ref ? ref.missionId : ref.applicantId,
        metadata: {},
      });
    });
  } catch {
    // The answer to the person does not depend on the record of it.
  }
}

/** True only when this account owns the case. A made-up, malformed or someone else's id is false. */
export function ownsCase(db: Db, accountId: string, missionId: string): Promise<boolean> {
  return isOwner(db, accountId, { missionId });
}

/** True only when this account owns the traveller profile. */
export function ownsApplicant(db: Db, accountId: string, applicantId: string): Promise<boolean> {
  return isOwner(db, accountId, { applicantId });
}

/**
 * True only when the grant exists AND belongs to a traveller this account owns. A grant id on its
 * own says nothing about its traveller, so the traveller the page was opened for is checked too:
 * a grant that belongs to someone else, or to no one, is false.
 */
export async function ownsGrant(
  db: Db,
  accountId: string,
  applicantId: string,
  grantId: string,
): Promise<boolean> {
  if (!UUID.test(applicantId)) return false;
  const listed = await listAccessForApplicant(db, accountId, applicantId);
  return listed.ok && listed.value.some((grant) => grant.id === grantId);
}

/** True only when this account owns the case and filed this complaint on it. */
export async function ownsComplaint(
  db: Db,
  accountId: string,
  missionId: string,
  complaintId: string,
): Promise<boolean> {
  if (!(await ownsCase(db, accountId, missionId))) return false;
  const listed = await listComplaintsForMission(db, accountId, missionId);
  return (
    listed.ok &&
    listed.value.some((row) => row.id === complaintId && row.filedByAccountId === accountId)
  );
}
