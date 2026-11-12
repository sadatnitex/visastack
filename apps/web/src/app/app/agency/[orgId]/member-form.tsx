'use client';

import { useActionState } from 'react';
import { SubmitButton } from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appAgencyCatalog } from '../../../../i18n/app-agency';
import { type ActionState, addMemberAction } from './actions';
import { InvitationOutcome } from './invitation-outcome';

const INITIAL: ActionState = { ok: true, message: '' };

export function AddMemberForm({
  organizationId,
  pendingInvitationIds,
}: {
  readonly organizationId: string;
  /** Invitations still waiting, as the page last read them. */
  readonly pendingInvitationIds: readonly string[];
}) {
  const t = useT(appAgencyCatalog);
  const [state, formAction, pending] = useActionState(addMemberAction, INITIAL);
  return (
    <form action={formAction} className="field-list form-narrow">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor="memberEmail">
            {t('appAgency.appAgencyOrgidMemberForm.memberEmail')}
          </label>
          <input
            id="memberEmail"
            name="memberEmail"
            type="email"
            required
            className="input"
            placeholder={t('appAgency.appAgencyOrgidMemberForm.teammateExampleCom')}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="role">
            {t('appAgency.appAgencyOrgidMemberForm.role')}
          </label>
          <select id="role" name="role" className="input" defaultValue="REVIEWER">
            <option value="ADMIN">{t('appAgency.appAgencyOrgidMemberForm.admin')}</option>
            <option value="CASE_MANAGER">
              {t('appAgency.appAgencyOrgidMemberForm.caseManager')}
            </option>
            <option value="REVIEWER">{t('appAgency.appAgencyOrgidMemberForm.reviewer')}</option>
          </select>
        </div>
      </div>
      <div>
        <SubmitButton
          pending={pending}
          idle="Add Member"
          busy="Adding…"
          className="btn btn-primary"
        />
        <InvitationOutcome
          state={state}
          pendingInvitationIds={pendingInvitationIds}
          purpose="team"
        />
      </div>
    </form>
  );
}
