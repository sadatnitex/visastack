'use server';

import { setOrganizationAiSetting, turnOffAgencyAiConnection } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import type { FormResult } from '../../../../components/form-feedback';
import { withSession } from '../../../../lib/session';

/**
 * "AI Connections for This Agency" (S22): an owner or admin turns it on, after confirming the
 * agency's statement, or off. The service checks the role, the agency and the confirmation again.
 */
export async function setAgencyAiSettingAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const enabled = formData.get('enabled') === 'true';
  const confirmed = formData.get('confirm') === 'on';
  if (enabled && !confirmed) {
    return {
      ok: false,
      message: 'Tick the box to confirm the statement before turning this on.',
      field: 'confirm',
    };
  }
  const result = await withSession(({ db, accountId }) =>
    setOrganizationAiSetting(db, { organizationId, accountId, enabled, confirmed }),
  );
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.error.code === 'forbidden'
          ? 'Only an owner or admin of an active agency can change this.'
          : 'This could not be changed right now. Try again later.',
    };
  }
  revalidatePath(`/app/agency/${organizationId}/settings`);
  return {
    ok: true,
    message: enabled
      ? 'AI connections are on for this agency.'
      : 'AI connections are off for this agency. Connected apps stop on their next request.',
  };
}

/** An owner or admin turns one of the agency's AI connections off (S22). */
export async function turnOffAgencyAiConnectionAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const connectionId = String(formData.get('connectionId') ?? '');
  const result = await withSession(({ db, accountId }) =>
    turnOffAgencyAiConnection(db, { organizationId, accountId, connectionId }),
  );
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.error === 'forbidden'
          ? 'Only an owner or admin of this agency can turn this off.'
          : 'This connection was not found. It may have been turned off already.',
    };
  }
  revalidatePath(`/app/agency/${organizationId}/ai-connections`);
  return { ok: true, message: 'Turned off. The app stops on its next request.' };
}
