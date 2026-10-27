'use server';

import { EMAIL_RESEND_REFUSED, resendEmail } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import type { FormResult } from '../../../../components/form-feedback';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { triggerNotificationWorker } from '../../../../lib/jobs';
import { withSession } from '../../../../lib/session';

const EMAIL_DELIVERY_PATH = '/app/admin/email';

const DENIED: FormResult = {
  ok: false,
  message: 'Only a support admin or platform owner can send an email again.',
};

const REFUSED: Record<string, string> = {
  [EMAIL_RESEND_REFUSED.notFound]: 'This email is no longer listed. Reload the page.',
  [EMAIL_RESEND_REFUSED.notEmail]: 'Only emails can be sent again here.',
  [EMAIL_RESEND_REFUSED.bounced]:
    'The receiving address refused this email, so it cannot be sent again. Check the address with the person.',
  [EMAIL_RESEND_REFUSED.notFailed]:
    'This email is already waiting to be sent or has gone out. Reload the page to see where it is.',
  [EMAIL_RESEND_REFUSED.noLongerValid]:
    'What this email was about no longer applies (for example, the invitation was withdrawn or has run out), so it cannot be sent again. Ask the sender to make a new one.',
};

/**
 * Put one failed email back in line with fresh tries. The service checks the staff role live,
 * re-checks the email's state and records who asked; the send starts right after the reply.
 */
export async function resendEmailAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const notificationId = String(formData.get('notificationId') ?? '').trim();
  if (notificationId.length === 0) {
    return { ok: false, message: 'This email is no longer listed. Reload the page.' };
  }

  return withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'PROCESSING_JOB_RETRY',
    );
    if (!staff.ok) return DENIED;

    const result = await resendEmail(db, staff.value, { notificationId });
    if (!result.ok) {
      const refused = REFUSED[result.error.message];
      if (refused) return { ok: false, message: refused };
      if (result.error.code === 'forbidden') return DENIED;
      return { ok: false, message: 'This email could not be sent again. Try again in a moment.' };
    }
    revalidatePath(EMAIL_DELIVERY_PATH);
    const { resourceId } = result.value;
    // Only this email's record, so an older backlog cannot hold it back.
    after(() =>
      triggerNotificationWorker({
        limit: 5,
        timeBudgetMs: 15_000,
        ...(resourceId ? { resourceId } : {}),
      }).then(() => undefined),
    );
    return {
      ok: true,
      message:
        'Sending a fresh copy now. The failed one leaves this list; if the copy fails too, it appears here again.',
    };
  });
}
