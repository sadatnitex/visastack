'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { type ActionState, attachPackAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export interface PackOption {
  readonly packVersionId: string;
  readonly label: string;
}

export function AttachPackForm({
  missionId,
  options,
  primary = true,
}: {
  readonly missionId: string;
  readonly options: readonly PackOption[];
  /** False when another action on the page is the one primary button (the next step). */
  readonly primary?: boolean;
}) {
  const t = useT(appMissionCatalog);
  const [state, formAction, pending] = useActionState(attachPackAction, INITIAL);

  // Nothing to pick: the case page says so and why, in its own words (VS-006).
  if (options.length === 0) return null;

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <input type="hidden" name="missionId" value={missionId} />
      <select
        name="packVersionId"
        className="input"
        defaultValue=""
        required
        aria-label={t('appMission.appMissionIdAttachPackForm.requirementPack')}
      >
        <option value="" disabled>
          {t('appMission.appMissionIdAttachPackForm.chooseARequirementPack')}
        </option>
        {options.map((opt) => (
          <option key={opt.packVersionId} value={opt.packVersionId}>
            {opt.label}
          </option>
        ))}
      </select>
      <div>
        <SubmitButton
          pending={pending}
          idle="Attach Pack"
          busy="Attaching…"
          className={primary ? 'btn btn-primary' : 'btn btn-secondary'}
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
