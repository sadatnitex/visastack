'use server';

import {
  placeLegalHold,
  releaseLegalHold,
  reviewOrganization,
  setRetentionPolicy,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { isPlatformAdmin } from '../../../lib/admin';
import { withSession } from '../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const DENIED: ActionState = { ok: false, message: 'Not authorized.' };

/** Set (upsert) the retention policy for a document type. Platform-admin only. */
export async function setRetentionPolicyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const docType = String(formData.get('docType') ?? '').trim();
  const retentionDays = Number(String(formData.get('retentionDays') ?? ''));
  if (docType.length === 0) return { ok: false, message: 'Enter a document type.' };
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { ok: false, message: 'Retention days must be a positive number.' };
  }

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return DENIED;
    const set = await setRetentionPolicy(db, { actorAccountId: accountId, docType, retentionDays });
    if (!set.ok) return { ok: false, message: set.error.message } satisfies ActionState;
    return { ok: true, message: `Retention for ${docType} set to ${retentionDays} days.` };
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/** Place a legal hold on an applicant. Platform-admin only. */
export async function placeLegalHoldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (applicantId.length === 0) return { ok: false, message: 'Enter an applicant ID.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return DENIED;
    const held = await placeLegalHold(db, { actorAccountId: accountId, applicantId, reason });
    if (!held.ok) return { ok: false, message: held.error.message } satisfies ActionState;
    return { ok: true, message: 'Legal hold placed.' };
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/** Release a legal hold. Platform-admin only. */
export async function releaseLegalHoldAction(formData: FormData): Promise<void> {
  const holdId = String(formData.get('holdId') ?? '').trim();
  if (holdId.length === 0) return;
  await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return;
    await releaseLegalHold(db, { actorAccountId: accountId, holdId });
  });
  revalidatePath('/app/admin');
}

/** Verify or reject a pending organization. Platform-admin only (and not a member). */
export async function reviewOrganizationAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const decision = String(formData.get('decision') ?? '') === 'ACTIVE' ? 'ACTIVE' : 'REJECTED';
  if (organizationId.length === 0) return;
  await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return;
    await reviewOrganization(db, { reviewerAccountId: accountId, organizationId, decision });
  });
  revalidatePath('/app/admin');
}
