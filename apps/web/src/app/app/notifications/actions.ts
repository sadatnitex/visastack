'use server';

import { markNotificationRead } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../../lib/session';

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const notificationId = String(formData.get('notificationId') ?? '');

  await withSession(async ({ db, accountId }) =>
    markNotificationRead(db, { actorAccountId: accountId, notificationId }),
  );

  revalidatePath('/app/notifications');
}
