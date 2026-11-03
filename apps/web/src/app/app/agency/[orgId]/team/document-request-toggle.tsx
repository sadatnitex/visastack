'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { type MemberPermissionState, setMemberRequestDocumentsAction } from './actions';

const INITIAL: MemberPermissionState = { ok: true, message: '' };

/**
 * May Request Documents for one member (UMPE G3): they may create and send document requests.
 * Answers and files stay with owners and admins, and the wording says so.
 */
export function DocumentRequestToggle({
  organizationId,
  membershipId,
  allowed,
  memberLabel,
}: {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly allowed: boolean;
  /** Who the button is for, for screen readers (the member's email). */
  readonly memberLabel: string;
}) {
  const [state, formAction, pending] = useActionState(setMemberRequestDocumentsAction, INITIAL);
  return (
    <div className="member-permission">
      <form action={formAction}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="membershipId" value={membershipId} />
        <input type="hidden" name="allowed" value={String(!allowed)} />
        <SubmitButton
          pending={pending}
          idle={allowed ? 'Stop Document Requests' : 'Allow Document Requests'}
          busy="Updating…"
          className="btn btn-secondary u-btn-sm"
          label={`${allowed ? 'Stop Document Requests' : 'Allow Document Requests'} for ${memberLabel}`}
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}
