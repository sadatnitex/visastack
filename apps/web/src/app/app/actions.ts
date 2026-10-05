'use server';

import { CONSENT_TYPES, type ConsentType } from '@visastack/core';
import { type ApplicantRelationship, createApplicant, setConsent } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
  /** The input a problem is about, when the action knows (the form marks it invalid and moves focus to it). */
  readonly field?: string;
}

const RELATIONSHIPS: readonly ApplicantRelationship[] = ['SELF', 'FAMILY_MEMBER', 'MINOR_GUARDIAN'];

/** Grant or revoke one consent type for the signed-in account. */
export async function setConsentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const type = String(formData.get('type'));
  const granted = formData.get('granted') === 'true';
  if (!CONSENT_TYPES.includes(type as ConsentType))
    return { ok: false, message: 'Unknown consent type.' };
  const result = await withSession(async ({ db, accountId }) => {
    const set = await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: type as ConsentType,
      granted,
    });
    if (!set.ok) return { ok: false, message: set.error.message } satisfies ActionState;
    return {
      ok: true,
      message: granted ? 'Consent granted.' : 'Consent revoked.',
    } satisfies ActionState;
  });
  if (result.ok) {
    revalidatePath('/app');
    revalidatePath('/app/applicants');
    revalidatePath('/app/account');
  }
  return result;
}

/** Create an applicant record owned by the signed-in account. */
export async function createApplicantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const displayName = String(formData.get('displayName') ?? '').trim();
  const relationshipRaw = String(formData.get('relationship') ?? 'SELF');
  const relationship: ApplicantRelationship = RELATIONSHIPS.includes(
    relationshipRaw as ApplicantRelationship,
  )
    ? (relationshipRaw as ApplicantRelationship)
    : 'SELF';
  const authorityConfirmed = formData.get('authorityConfirmed') === 'true';
  if (displayName.length === 0)
    return { ok: false, message: 'Enter a name.', field: 'displayName' };
  if (relationship !== 'SELF' && !authorityConfirmed) {
    return {
      ok: false,
      message: 'Confirm you have authority to create this record.',
      field: 'authorityConfirmed',
    };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const created = await createApplicant(db, {
      actorAccountId: accountId,
      ownerAccountId: accountId,
      displayName,
      relationship,
      authorityConfirmed,
    });
    if (!created.ok) return { ok: false, message: created.error.message } satisfies ActionState;
    return { ok: true, message: `${displayName} added.` } satisfies ActionState;
  });
  if (result.ok) {
    revalidatePath('/app');
    revalidatePath('/app/applicants');
  }
  return result;
}
