'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../components/form-feedback';
import {
  type ActionState,
  releaseLegalHoldAction,
  resetStaffAuthenticatorAction,
  retryErasureJobAction,
  retryJobAction,
  reviewOrganizationAction,
  revokeInvitationAction,
  revokePlatformRoleAction,
  suspendOrganizationAction,
  terminateOrganizationAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function ReleaseHoldButton({ holdId }: { readonly holdId: string }) {
  const [state, formAction, pending] = useActionState(releaseLegalHoldAction, INITIAL);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm('Release this legal hold? Deletion/purge become possible again.')) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="holdId" value={holdId} />
      <SubmitButton
        pending={pending}
        idle="Release"
        busy="Releasing…"
        className="btn btn-secondary u-btn-sm"
      />
      <FormMessage result={state} />
    </form>
  );
}

export function RetryJobButton({ jobId }: { readonly jobId: string }) {
  const [state, formAction, pending] = useActionState(retryJobAction, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton
        pending={pending}
        idle="Retry"
        busy="Retrying…"
        className="btn btn-secondary u-btn-sm"
      />
      <FormMessage result={state} />
    </form>
  );
}

export function RetryErasureJobButton({ jobId }: { readonly jobId: string }) {
  const [state, formAction, pending] = useActionState(retryErasureJobAction, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton
        pending={pending}
        idle="Retry"
        busy="Retrying…"
        className="btn btn-secondary u-btn-sm"
      />
      <FormMessage result={state} />
    </form>
  );
}

export function RevokeRoleButton({ grantId }: { readonly grantId: string }) {
  const [state, formAction, pending] = useActionState(revokePlatformRoleAction, INITIAL);
  return (
    <form
      action={formAction}
      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
      onSubmit={(e) => {
        const form = e.currentTarget;
        const reason = window.prompt('Reason for revoking this role?');
        if (!reason || reason.trim().length === 0) {
          e.preventDefault();
          return;
        }
        (form.elements.namedItem('reason') as HTMLInputElement).value = reason.trim();
      }}
    >
      <input type="hidden" name="grantId" value={grantId} />
      <input type="hidden" name="reason" value="" />
      <SubmitButton
        pending={pending}
        idle="Revoke"
        busy="Revoking…"
        className="btn btn-secondary u-btn-sm"
      />
      <FormMessage result={state} />
    </form>
  );
}

export function ResetAuthenticatorButton({
  targetAccountId,
}: { readonly targetAccountId: string }) {
  const [state, formAction, pending] = useActionState(resetStaffAuthenticatorAction, INITIAL);
  return (
    <form
      action={formAction}
      className="inline-action-form"
      onSubmit={(e) => {
        const form = e.currentTarget;
        const reason = window.prompt('Why is this authenticator being reset?');
        if (!reason || reason.trim().length === 0) {
          e.preventDefault();
          return;
        }
        (form.elements.namedItem('reason') as HTMLInputElement).value = reason.trim();
      }}
    >
      <input type="hidden" name="targetAccountId" value={targetAccountId} />
      <input type="hidden" name="reason" value="" />
      <SubmitButton
        pending={pending}
        idle="Reset Authenticator"
        busy="Resetting…"
        className="btn btn-secondary u-btn-sm"
      />
      <FormMessage result={state} />
    </form>
  );
}

export function RevokeInvitationButton({ invitationId }: { readonly invitationId: string }) {
  const [state, formAction, pending] = useActionState(revokeInvitationAction, INITIAL);
  return (
    <form
      action={formAction}
      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
      onSubmit={(e) => {
        const form = e.currentTarget;
        const reason = window.prompt('Reason for revoking this invitation?');
        if (!reason || reason.trim().length === 0) {
          e.preventDefault();
          return;
        }
        (form.elements.namedItem('reason') as HTMLInputElement).value = reason.trim();
      }}
    >
      <input type="hidden" name="invitationId" value={invitationId} />
      <input type="hidden" name="reason" value="" />
      <SubmitButton
        pending={pending}
        idle="Revoke"
        busy="Revoking…"
        className="btn btn-secondary u-btn-sm"
      />
      <FormMessage result={state} />
    </form>
  );
}

export function OrgReviewButtons({ organizationId }: { readonly organizationId: string }) {
  const [state, formAction, pending] = useActionState(reviewOrganizationAction, INITIAL);
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}
    >
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <form action={formAction}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="decision" value="ACTIVE" />
          <SubmitButton
            pending={pending}
            idle="Verify"
            busy="Verify"
            className="btn btn-primary u-btn-sm"
          />
        </form>
        <form
          action={formAction}
          onSubmit={(e) => {
            if (!window.confirm('Reject this organization?')) e.preventDefault();
          }}
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="decision" value="REJECTED" />
          <SubmitButton
            pending={pending}
            idle="Reject"
            busy="Reject"
            className="btn btn-secondary u-btn-sm"
          />
        </form>
      </div>
      <FormMessage result={state} />
    </div>
  );
}

export function OrgSuspendButton({ organizationId }: { readonly organizationId: string }) {
  const [state, formAction, pending] = useActionState(suspendOrganizationAction, INITIAL);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm('Suspend this organization? It immediately loses all data access.')) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <SubmitButton
        pending={pending}
        idle="Suspend"
        busy="Suspending…"
        className="btn btn-secondary u-btn-sm"
      />
      <FormMessage result={state} />
    </form>
  );
}

export function OrgTerminateButton({ organizationId }: { readonly organizationId: string }) {
  const [state, formAction, pending] = useActionState(terminateOrganizationAction, INITIAL);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !window.confirm(
            'Terminate this organization? This is permanent and cannot be reversed. Its platform access is removed immediately; traveller data is untouched.',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <SubmitButton
        pending={pending}
        idle="Terminate"
        busy="Terminating…"
        className="btn btn-danger u-btn-sm"
      />
      <FormMessage result={state} />
    </form>
  );
}
