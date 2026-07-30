'use client';

import { useActionState } from 'react';
import {
  type ActionState,
  approveVersionAction,
  openVersionAction,
  publishVersionAction,
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
