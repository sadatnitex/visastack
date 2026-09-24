'use client';

import { useActionState } from 'react';
import {
  type ActionState,
  approveVersionAction,
  clearSourceInaccessibleAction,
  markSourceInaccessibleAction,
  openVersionAction,
  publishVersionAction,
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
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? 'Opening…' : 'Open new draft version'}
        </button>
      </form>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
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
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Approving…' : 'Approve version'}
        </button>
      </form>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
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
    <div style={{ marginTop: '1rem' }}>
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            !window.confirm('Publish this version? It becomes attachable by missions immediately.')
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="packVersionId" value={packVersionId} />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Publishing…' : 'Publish version'}
        </button>
      </form>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
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
    <div style={{ marginTop: '1rem' }}>
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
        <button type="submit" className="btn btn-danger" disabled={pending}>
          {pending ? 'Withdrawing…' : 'Withdraw version'}
        </button>
      </form>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
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
        <button
          type="submit"
          className={`btn ${inaccessible ? 'btn-secondary' : 'btn-danger'}`}
          style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
          disabled={pending}
        >
          {pending ? '…' : inaccessible ? 'Clear source-inaccessible' : 'Mark source inaccessible'}
        </button>
      </form>
      {state.message ? (
        <span className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
