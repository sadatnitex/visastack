'use server';

import type { MembershipRole } from '@visastack/core';
import {
  addMembership,
  getAccountByEmail,
  requestEvidence,
  setMembershipActive,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const ROLES: readonly MembershipRole[] = ['ADMIN', 'CASE_MANAGER', 'REVIEWER'];
function toRole(value: string): MembershipRole {
  return (ROLES as readonly string[]).includes(value) ? (value as MembershipRole) : 'REVIEWER';
}

/** Org admin requests a specific field or document from an applicant. */
export async function requestEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const applicantId = String(formData.get('applicantId') ?? '').trim();
  const kind = String(formData.get('kind') ?? '') === 'DOCUMENT' ? 'DOCUMENT' : 'FIELD';
  const key = String(formData.get('key') ?? '').trim();
  const message = String(formData.get('message') ?? '').trim();

  if (applicantId.length === 0) return { ok: false, message: 'Enter the applicant ID.' };
  if (key.length === 0) {
    return {
      ok: false,
      message: kind === 'FIELD' ? 'Enter the field key.' : 'Enter the document type.',
    };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const requested = await requestEvidence(db, {
      actorAccountId: accountId,
      organizationId,
      applicantId,
      kind,
      ...(kind === 'FIELD' ? { fieldKey: key } : { docType: key }),
      ...(message.length > 0 ? { message } : {}),
    });
    if (!requested.ok) return { ok: false, message: requested.error.message } satisfies ActionState;
    return { ok: true, message: 'Evidence request sent.' } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
  return result;
}

/** Add an existing VisaStack user to the organization by email (org admin). */
export async function addMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const memberEmail = String(formData.get('memberEmail') ?? '')
    .trim()
    .toLowerCase();
  const role = toRole(String(formData.get('role') ?? ''));
  if (memberEmail.length === 0) return { ok: false, message: 'Enter a member email.' };

  const result = await withSession(async ({ db, accountId }) => {
    const account = await getAccountByEmail(db, memberEmail);
    if (!account) {
      return {
        ok: false,
        message: 'No VisaStack account for that email. They must sign in once first.',
      } satisfies ActionState;
    }
    const added = await addMembership(db, {
      actorAccountId: accountId,
      organizationId,
      accountId: account.id,
      role,
    });
    if (!added.ok) return { ok: false, message: added.error.message } satisfies ActionState;
    return { ok: true, message: `${memberEmail} added as ${role}.` } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
  return result;
}

/** Activate or deactivate a membership (org admin). Deactivation ends access. */
export async function toggleMemberAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';
  if (membershipId.length === 0) return;
  await withSession(async ({ db, accountId }) => {
    await setMembershipActive(db, {
      actorAccountId: accountId,
      organizationId,
      membershipId,
      active,
    });
  });
  revalidatePath(`/app/agency/${organizationId}`);
}
