'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { saveWordingAction } from './edits-actions';

const INITIAL = { ok: true, message: '' };

/**
 * One checklist item's wording, in the traveller's own words. The official sentence stays on the
 * row, and nothing here changes what the case needs. The words show only to the traveller. One
 * form holds both buttons, so its message stays on screen when the original comes back.
 */
export function WordingEditor({
  missionId,
  packRequirementId,
  itemName,
  original,
  current,
  maxLength,
}: {
  readonly missionId: string;
  readonly packRequirementId: string;
  /** The item's official name, so each editor on the page says which item it is for. */
  readonly itemName: string;
  /** How the item is named when nothing has been reworded. */
  readonly original: string;
  /** The traveller's sentence now, or empty when the original is showing. */
  readonly current: string;
  readonly maxLength: number;
}) {
  const t = useT(appMissionCatalog);
  const [state, action, pending] = useActionState(saveWordingAction, INITIAL);
  const id = `wording-${packRequirementId}`;
  return (
    <details className="lift-check-edit">
      <summary>
        Edit Wording<span className="sr-only"> for {itemName}</span>
      </summary>
      <form action={action} className="field-list">
        <input type="hidden" name="missionId" value={missionId} />
        <input type="hidden" name="packRequirementId" value={packRequirementId} />
        <input type="hidden" name="original" value={original} />
        <div className="field-row">
          <label className="field-label" htmlFor={id}>
            Your Wording<span className="sr-only"> for {itemName}</span>
          </label>
          {/* Keyed by the saved sentence, so the box shows what is saved after a save or a reset. */}
          <textarea
            key={current}
            id={id}
            name="wording"
            className="input"
            rows={2}
            maxLength={maxLength}
            defaultValue={current}
          />
        </div>
        <SubmitButton
          pending={pending}
          idle="Save Wording"
          busy="Saving"
          label={t('appMission.appMissionIdWordingEditor.saveWordingForItemname', { itemName })}
          className="btn btn-secondary"
        />
        {current ? (
          <SubmitButton
            pending={pending}
            idle="Back to Original Wording"
            busy="Restoring"
            label={t('appMission.appMissionIdWordingEditor.backToOriginalWordingForItemname', {
              itemName,
            })}
            name="intent"
            value="original"
            className="btn btn-secondary"
          />
        ) : null}
        <FormMessage result={state} pending={pending} pendingText="Saving" />
      </form>
    </details>
  );
}
