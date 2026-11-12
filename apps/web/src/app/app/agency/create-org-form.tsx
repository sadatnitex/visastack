'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../components/form-feedback';
import { useT } from '../../../components/i18n-provider';
import { appAgencyCatalog } from '../../../i18n/app-agency';
import { type ActionState, createOrganizationAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function CreateOrgForm() {
  const t = useT(appAgencyCatalog);
  const [state, formAction, pending] = useActionState(createOrganizationAction, INITIAL);

  return (
    <form action={formAction} className="stack-sm form-compact">
      <input
        name="name"
        type="text"
        required
        className="input"
        placeholder={t('appAgency.appAgencyCreateOrgForm.organizationName')}
        aria-label={t('appAgency.appAgencyCreateOrgForm.organizationName')}
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
