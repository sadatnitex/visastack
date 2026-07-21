'use server';

import { createOrganization } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withSession } from '../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

/** Create an organization (creator becomes OWNER); redirect into its console. */
export async function createOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get('name') ?? '').trim();
  if (name.length === 0) return { ok: false, message: 'Enter an organization name.' };

  const outcome = await withSession(async ({ db, accountId }) => {
    const created = await createOrganization(db, { actorAccountId: accountId, name });
    if (!created.ok) {
      return { state: { ok: false, message: created.error.message } as ActionState, id: null };
    }
    return { state: { ok: true, message: '' } as ActionState, id: created.value.id };
  });

  if (outcome.id) {
    revalidatePath('/app/agency');
    redirect(`/app/agency/${outcome.id}`);
  }
  return outcome.state;
}
