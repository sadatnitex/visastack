'use server';

import { listNotificationsForAccount, markNotificationRead } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../../lib/session';

/** One list read (the most a list read returns), and how many reads one click may take. */
const MARK_ALL_BATCH = 100;
const MARK_ALL_ROUNDS = 10;

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const notificationId = String(formData.get('notificationId') ?? '');

  await withSession(async ({ db, accountId }) =>
    markNotificationRead(db, { actorAccountId: accountId, notificationId }),
  );

  revalidatePath('/app/notifications');
  revalidatePath('/app', 'layout');
}

/**
 * Mark All Read (WP-SB1): every unread notification this person can see, read in batches of 100
 * (up to 1,000 in one click). It reads the same list the page shows, so nothing hidden from the
 * person is touched, and marks each through the same one-at-a-time check, which refuses anything
 * not addressed to them. A batch that marks nothing ends the click, so it can never loop.
 */
export async function markAllNotificationsReadAction(): Promise<void> {
  await withSession(async ({ db, accountId }) => {
    for (let round = 0; round < MARK_ALL_ROUNDS; round += 1) {
      const listed = await listNotificationsForAccount(db, accountId, {
        unreadFirst: true,
        limit: MARK_ALL_BATCH,
      });
      const unread = listed.filter((notification) => !notification.read);
      let marked = 0;
      for (const notification of unread) {
        const result = await markNotificationRead(db, {
          actorAccountId: accountId,
          notificationId: notification.id,
        });
        if (result.ok) marked += 1;
      }
      if (marked === 0 || unread.length < MARK_ALL_BATCH) break;
    }
  });

  revalidatePath('/app/notifications');
  revalidatePath('/app', 'layout');
}
