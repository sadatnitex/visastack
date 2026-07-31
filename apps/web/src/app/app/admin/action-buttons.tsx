'use client';

import { useActionState } from 'react';
import {
  type ActionState,
  releaseLegalHoldAction,
  retryErasureJobAction,
  retryJobAction,
  reviewOrganizationAction,
  revokePlatformRoleAction,
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
      <button
        type="submit"
        className="btn btn-secondary"
        style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
        disabled={pending}
      >
        {pending ? 'Releasing…' : 'Release'}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function RetryJobButton({ jobId }: { readonly jobId: string }) {
  const [state, formAction, pending] = useActionState(retryJobAction, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="jobId" value={jobId} />
      <button
        type="submit"
        className="btn btn-secondary"
        style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
        disabled={pending}
      >
        {pending ? 'Retrying…' : 'Retry'}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function RetryErasureJobButton({ jobId }: { readonly jobId: string }) {
  const [state, formAction, pending] = useActionState(retryErasureJobAction, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="jobId" value={jobId} />
      <button
        type="submit"
        className="btn btn-secondary"
        style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
        disabled={pending}
      >
        {pending ? 'Retrying…' : 'Retry'}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
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
      <button
        type="submit"
        className="btn btn-secondary"
        style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
        disabled={pending}
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
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
          <button
            type="submit"
            className="btn btn-primary"
            style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
            disabled={pending}
          >
            Verify
          </button>
        </form>
        <form
          action={formAction}
          onSubmit={(e) => {
            if (!window.confirm('Reject this organization?')) e.preventDefault();
          }}
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="decision" value="REJECTED" />
          <button
            type="submit"
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
            disabled={pending}
          >
            Reject
          </button>
        </form>
      </div>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
