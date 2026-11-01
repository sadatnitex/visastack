'use server';

import { listNotificationsForAccount, markNotificationRead } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../../lib/session';

/** How many unread notifications one Mark All Read reaches (the most a list read returns). */
const MARK_ALL_LIMIT = 100;

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const notificationId = String(formData.get('notificationId') ?? '');

  await withSession(async ({ db, accountId }) =>
    markNotificationRead(db, { actorAccountId: accountId, notificationId }),
  );

  revalidatePath('/app/notifications');
  revalidatePath('/app', 'layout');
}

/**
 * Mark All Read (WP-SB1): every unread notification this person can see on the page, up to 100 at
 * a time. It reads the same list the page shows (so nothing hidden from the person is touched) and
 * marks each through the same one-at-a-time check, which refuses anything not addressed to them.
 */
export async function markAllNotificationsReadAction(): Promise<void> {
  await withSession(async ({ db, accountId }) => {
    const listed = await listNotificationsForAccount(db, accountId, {
      unreadFirst: true,
      limit: MARK_ALL_LIMIT,
    });
    for (const notification of listed) {
      if (notification.read) break;
      await markNotificationRead(db, {
        actorAccountId: accountId,
        notificationId: notification.id,
      });
    }
  });

  revalidatePath('/app/notifications');
  revalidatePath('/app', 'layout');
}
