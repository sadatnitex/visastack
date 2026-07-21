'use server';

import { acceptGrant } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../../lib/session';

/** Accept a grant that names the signed-in account as recipient. */
export async function acceptGrantAction(formData: FormData): Promise<void> {
  const grantId = String(formData.get('grantId') ?? '').trim();
  if (grantId.length === 0) return;
  await withSession(async ({ db, accountId }) => {
    await acceptGrant(db, { actorAccountId: accountId, grantId });
  });
  revalidatePath('/app/shared');
}
