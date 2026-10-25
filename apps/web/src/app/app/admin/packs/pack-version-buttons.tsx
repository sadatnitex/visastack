'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import {
  type ActionState,
  approveVersionAction,
  clearOfficialFeeStaleAction,
  clearSourceInaccessibleAction,
  markOfficialFeeStaleAction,
  markSourceInaccessibleAction,
  openVersionAction,
  publishToPublicTrustAction,
  publishVersionAction,
  unpublishFromPublicTrustAction,
  withdrawVersionAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function OpenVersionButton({ packId }: { readonly packId: string }) {
  const [state, formAction, pending] = useActionState(openVersionAction, INITIAL);
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}
    >
      <form action={formAction}>
        <input type="hidden" name="packId" value={packId} />
        <SubmitButton
          pending={pending}
          idle="Open New Draft Version"
          busy="Opening…"
          className="btn btn-secondary"
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

export function ApproveVersionButton({
  packId,
  packVersionId,
}: {
  readonly packId: string;
  readonly packVersionId: string;
}) {
  const [state, formAction, pending] = useActionState(approveVersionAction, INITIAL);
  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="packVersionId" value={packVersionId} />
        <SubmitButton
          pending={pending}
          idle="Approve Version"
          busy="Approving…"
          className="btn btn-primary"
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

export function PublishVersionButton({
  packId,
  packVersionId,
}: {
  readonly packId: string;
  readonly packVersionId: string;
}) {
  const [state, formAction, pending] = useActionState(publishVersionAction, INITIAL);
  return (
    <div className="u-mt-100">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            !window.confirm('Publish this version? It becomes attachable by cases immediately.')
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="packVersionId" value={packVersionId} />
        <SubmitButton
          pending={pending}
          idle="Publish Version"
          busy="Publishing…"
          className="btn btn-primary"
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

/** Withdraw a PUBLISHED version for cause -- always explicit and reasoned (RUL-05), never a bare confirm. */
export function WithdrawVersionButton({
  packId,
  packVersionId,
}: {
  readonly packId: string;
  readonly packVersionId: string;
}) {
  const [state, formAction, pending] = useActionState(withdrawVersionAction, INITIAL);
  return (
    <div className="u-mt-100">
      <form
        action={formAction}
        onSubmit={(e) => {
          const form = e.currentTarget;
          const reason = window.prompt(
            'Reason for withdrawing this version? (source turned out wrong, unsafe, or inaccessible)',
          );
          if (!reason || reason.trim().length === 0) {
            e.preventDefault();
            return;
          }
          (form.elements.namedItem('reason') as HTMLInputElement).value = reason.trim();
        }}
      >
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="packVersionId" value={packVersionId} />
        <input type="hidden" name="reason" value="" />
        <SubmitButton
          pending={pending}
          idle="Withdraw Version"
          busy="Withdrawing…"
          className="btn btn-danger"
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

/** Expose/remove a PUBLISHED, authoritative version on the public trust surface (RUL-06). */
export function PublicTrustPublishButton({
  packId,
  packVersionId,
  published,
}: {
  readonly packId: string;
  readonly packVersionId: string;
  readonly published: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    published ? unpublishFromPublicTrustAction : publishToPublicTrustAction,
    INITIAL,
  );
  return (
    <div style={{ marginTop: '0.75rem' }}>
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            published &&
            !window.confirm(
              'Remove this route from the public trust page? It stays usable by cases.',
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="packVersionId" value={packVersionId} />
        <SubmitButton
          pending={pending}
          idle={published ? 'Remove from public trust' : 'Publish to public trust'}
          busy={published ? 'Removing…' : 'Publishing…'}
          className={`btn ${published ? 'btn-danger' : 'btn-primary'}`}
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

/** Toggle a PUBLISHED version's official-fee staleness mark (RUL-06) -- mirrors `SourceInaccessibleButton` exactly. */
export function OfficialFeeStaleButton({
  packId,
  packVersionId,
  stale,
}: {
  readonly packId: string;
  readonly packVersionId: string;
  readonly stale: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    stale ? clearOfficialFeeStaleAction : markOfficialFeeStaleAction,
    INITIAL,
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <form action={formAction}>
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="packVersionId" value={packVersionId} />
        <SubmitButton
          pending={pending}
          idle={stale ? 'Restore fee' : 'Mark fee stale'}
          busy="…"
          className={`btn ${stale ? 'btn-secondary' : 'btn-danger'}`}
          style={{ padding: '0.2rem 0.6rem', fontSize: 'var(--text-caption)' }}
        />
      </form>
      <FormMessage result={state} style={{ display: 'inline' }} />
    </div>
  );
}

/** Toggle one requirement's source-inaccessible mark (RUL-05) -- a small inline action, not a whole-form row. */
export function SourceInaccessibleButton({
  packId,
  requirementId,
  inaccessible,
}: {
  readonly packId: string;
  readonly requirementId: string;
  readonly inaccessible: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    inaccessible ? clearSourceInaccessibleAction : markSourceInaccessibleAction,
    INITIAL,
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <form action={formAction}>
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="requirementId" value={requirementId} />
        <SubmitButton
          pending={pending}
          idle={inaccessible ? 'Clear source-inaccessible' : 'Mark source inaccessible'}
          busy="…"
          className="btn btn-secondary u-btn-xs"
        />
      </form>
      <FormMessage result={state} style={{ display: 'inline' }} />
    </div>
  );
}
