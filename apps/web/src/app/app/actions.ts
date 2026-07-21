'use server';

import { CONSENT_TYPES, type ConsentType } from '@visastack/core';
import { type ApplicantRelationship, createApplicant, setConsent } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../lib/session';

const RELATIONSHIPS: readonly ApplicantRelationship[] = ['SELF', 'FAMILY_MEMBER', 'MINOR_GUARDIAN'];

/** Grant or revoke one consent type for the signed-in account. */
export async function setConsentAction(formData: FormData): Promise<void> {
  const type = String(formData.get('type'));
  const granted = formData.get('granted') === 'true';
  if (!CONSENT_TYPES.includes(type as ConsentType)) return;
  await withSession(async ({ db, accountId }) => {
    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: type as ConsentType,
      granted,
    });
  });
  revalidatePath('/app');
}

/** Create an applicant record owned by the signed-in account. */
export async function createApplicantAction(formData: FormData): Promise<void> {
  const displayName = String(formData.get('displayName') ?? '').trim();
  const relationshipRaw = String(formData.get('relationship') ?? 'SELF');
  const relationship: ApplicantRelationship = RELATIONSHIPS.includes(
    relationshipRaw as ApplicantRelationship,
  )
    ? (relationshipRaw as ApplicantRelationship)
    : 'SELF';
  if (displayName.length === 0) return;
  await withSession(async ({ db, accountId }) => {
    await createApplicant(db, {
      actorAccountId: accountId,
      ownerAccountId: accountId,
      displayName,
      relationship,
    });
  });
  revalidatePath('/app');
}
