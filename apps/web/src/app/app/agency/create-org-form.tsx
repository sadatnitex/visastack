'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../components/form-feedback';
import { type ActionState, createOrganizationAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function CreateOrgForm() {
  const [state, formAction, pending] = useActionState(createOrganizationAction, INITIAL);

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <input
        name="name"
        type="text"
        required
        className="input"
        placeholder="Organization name"
        aria-label="Organization name"
      />
      <div>
        <SubmitButton
          pending={pending}
          idle="Create Organization"
          busy="Creating…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
