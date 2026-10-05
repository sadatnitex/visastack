'use server';

import { CONSENT_TYPES, type ConsentType } from '@visastack/core';
import { type ApplicantRelationship, createApplicant, setConsent } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { getI18n } from '../../lib/locale';
import { errorText } from '../../lib/localize-error';
import { withSession } from '../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const RELATIONSHIPS: readonly ApplicantRelationship[] = ['SELF', 'FAMILY_MEMBER', 'MINOR_GUARDIAN'];

/** Grant or revoke one consent type for the signed-in account. */
export async function setConsentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const i18n = await getI18n();
  const type = String(formData.get('type'));
  const granted = formData.get('granted') === 'true';
  if (!CONSENT_TYPES.includes(type as ConsentType))
    return { ok: false, message: i18n.t('consent.unknownType') };
  const result = await withSession(async ({ db, accountId }) => {
    const set = await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: type as ConsentType,
      granted,
    });
    if (!set.ok) return { ok: false, message: errorText(i18n, set.error) } satisfies ActionState;
    return {
      ok: true,
      message: granted ? i18n.t('consent.granted') : i18n.t('consent.revoked'),
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
  const i18n = await getI18n();
  const displayName = String(formData.get('displayName') ?? '').trim();
  const relationshipRaw = String(formData.get('relationship') ?? 'SELF');
  const relationship: ApplicantRelationship = RELATIONSHIPS.includes(
    relationshipRaw as ApplicantRelationship,
  )
    ? (relationshipRaw as ApplicantRelationship)
    : 'SELF';
  const authorityConfirmed = formData.get('authorityConfirmed') === 'true';
  if (displayName.length === 0) return { ok: false, message: i18n.t('account.add.nameRequired') };
  if (relationship !== 'SELF' && !authorityConfirmed) {
    return { ok: false, message: i18n.t('consent.authority.required') };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const created = await createApplicant(db, {
      actorAccountId: accountId,
      ownerAccountId: accountId,
      displayName,
      relationship,
      authorityConfirmed,
    });
    if (!created.ok) {
      return { ok: false, message: errorText(i18n, created.error) } satisfies ActionState;
    }
    // The name goes in exactly as typed: never transliterated, never normalised.
    return {
      ok: true,
      message: i18n.t('account.add.done', { name: displayName }),
    } satisfies ActionState;
  });
  if (result.ok) {
    revalidatePath('/app');
    revalidatePath('/app/applicants');
  }
  return result;
}
