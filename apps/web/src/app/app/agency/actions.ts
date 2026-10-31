'use server';

import { createOrganization, withdrawOrganizationApplication } from '@visastack/services';
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Withdraw an agency application that is still waiting for review. The service decides who may
 * (an owner) and when (only while pending); this only reports the outcome back to the page, which
 * shows it as a status line.
 */
export async function withdrawOrganizationApplicationAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get('organizationId') ?? '');
  let withdrawn = false;
  if (UUID_PATTERN.test(organizationId)) {
    const result = await withSession(async ({ db, accountId }) =>
      withdrawOrganizationApplication(db, { actorAccountId: accountId, organizationId }),
    );
    withdrawn = result.ok;
  }
  revalidatePath('/app/agency');
  redirect(withdrawn ? '/app/agency?withdrawal=done' : '/app/agency?withdrawal=refused');
}
