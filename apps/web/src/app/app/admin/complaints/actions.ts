'use server';

import {
  assignComplaintOwner,
  getAccountByEmail,
  updateComplaintStatus,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bootstrapAdminEmails, hasPlatformPermission } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const DENIED: ActionState = { ok: false, message: 'Not authorized.' };

const COMPLAINT_STATUSES = ['IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
function isComplaintStatus(value: string): value is ComplaintStatus {
  return (COMPLAINT_STATUSES as readonly string[]).includes(value);
}

/** QUALITY_ADMIN triage: assign a complaint to a named quality-admin account, by email (matching `grantPlatformRoleAction`'s own targeting convention). */
export async function assignComplaintOwnerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const complaintId = String(formData.get('complaintId') ?? '');
  const ownerEmail = String(formData.get('ownerEmail') ?? '').trim();
  if (complaintId.length === 0 || ownerEmail.length === 0) {
    return { ok: false, message: 'Missing complaint or owner email.' };
  }
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'COMPLAINT_MANAGE'))) return DENIED;
    const owner = await getAccountByEmail(db, ownerEmail);
    if (!owner)
      return { ok: false, message: 'No account found for that email.' } satisfies ActionState;
    const actor = { accountId, email, bootstrapEmails: bootstrapAdminEmails() };
    const assigned = await assignComplaintOwner(db, {
      actor,
      complaintId,
      ownerAccountId: owner.id,
    });
    if (!assigned.ok) return { ok: false, message: assigned.error.message } satisfies ActionState;
    return { ok: true, message: 'Complaint assigned.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin/complaints');
  return result;
}

/** QUALITY_ADMIN triage: move a complaint through IN_PROGRESS/RESOLVED/CLOSED (a resolution note is required for RESOLVED). */
export async function updateComplaintStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const complaintId = String(formData.get('complaintId') ?? '');
  const statusRaw = String(formData.get('status') ?? '');
  const resolution = String(formData.get('resolution') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  if (complaintId.length === 0 || !isComplaintStatus(statusRaw)) {
    return { ok: false, message: 'Missing complaint or status.' };
  }
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'COMPLAINT_MANAGE'))) return DENIED;
    const actor = { accountId, email, bootstrapEmails: bootstrapAdminEmails() };
    const updated = await updateComplaintStatus(db, {
      actor,
      complaintId,
      status: statusRaw,
      ...(resolution.length > 0 ? { resolution } : {}),
      ...(note.length > 0 ? { note } : {}),
    });
    if (!updated.ok) return { ok: false, message: updated.error.message } satisfies ActionState;
    return { ok: true, message: `Complaint moved to ${statusRaw}.` } satisfies ActionState;
  });
  if (!result.ok) return result;
  revalidatePath('/app/admin/complaints');
  // WP-SB6: the triage list shows one status tab at a time, so the moved complaint leaves the tab
  // it was on. Open its new tab, which names the move, instead of letting it vanish.
  redirect(`/app/admin/complaints?status=${STATUS_TAB[statusRaw]}&moved=${STATUS_TAB[statusRaw]}`);
}

/** The address name of each status tab on the triage page. */
const STATUS_TAB: Record<ComplaintStatus, string> = {
  IN_PROGRESS: 'in-progress',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};
