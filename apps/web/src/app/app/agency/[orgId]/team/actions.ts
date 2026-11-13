'use server';

import { serviceErrorMessage } from '../../../../../lib/service-error-message';

import { agencyCollectionPrincipal, setMemberMayRequestDocuments } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import {
  capabilityUnavailableMessage,
  getPlatformCapabilities,
} from '../../../../../lib/capabilities';
import { withSession } from '../../../../../lib/session';

export interface MemberPermissionState {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * An agency owner or admin turns May Request Documents on or off for one member (UMPE G3, A18).
 * The service checks, live, that the actor is an owner or admin with document requests switched
 * on and that the member belongs to this agency; a member of another agency looks exactly like a
 * missing one.
 */
export async function setMemberRequestDocumentsAction(
  _prev: MemberPermissionState,
  formData: FormData,
): Promise<MemberPermissionState> {
  if (getPlatformCapabilities().agencyCollaboration !== 'available') {
    return { ok: false, message: capabilityUnavailableMessage('agencyCollaboration') };
  }
  const organizationId = String(formData.get('organizationId') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '');
  const allowed = String(formData.get('allowed') ?? '') === 'true';
  const result = await withSession(async ({ db, accountId }) => {
    // Only an owner or admin with document requests switched on gets a scope that may change it.
    const scope = await agencyCollectionPrincipal(db, accountId, organizationId);
    const changed = scope.ok
      ? await setMemberMayRequestDocuments(db, scope.value, { membershipId, allowed })
      : scope;
    if (!changed.ok) {
      return {
        ok: false,
        message:
          changed.error.code === 'invalid'
            ? await serviceErrorMessage(changed.error)
            : 'This member could not be changed. Reload the page and try again.',
      } satisfies MemberPermissionState;
    }
    return {
      ok: true,
      message: allowed
        ? 'This member can now create and send document requests.'
        : 'This member can no longer create or send document requests.',
    } satisfies MemberPermissionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}/team`);
  return result;
}
