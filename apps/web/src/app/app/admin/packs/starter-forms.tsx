'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import type { ActionState } from './actions';
import {
  removeDraftItemAction,
  startPackUpdateAction,
  updateDraftItemAction,
} from './starter-actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** Starts an update of a published checklist: a draft copy to change, approve and publish. */
export function StartUpdateButton({
  packId,
  packVersionId,
}: {
  readonly packId: string;
  readonly packVersionId: string;
}) {
  const [state, action, pending] = useActionState(startPackUpdateAction, INITIAL);
  return (
    <form action={action} className="field-list">
      <input type="hidden" name="packId" value={packId} />
      <input type="hidden" name="packVersionId" value={packVersionId} />
      <SubmitButton
        pending={pending}
        idle="Start an Update"
        busy="Starting"
        className="btn btn-secondary"
      />
      <FormMessage result={state} pending={pending} pendingText="Starting" />
    </form>
  );
}

/** What an admin may change on an item of a draft. */
export function DraftItemEditor({
  packId,
  requirementId,
  kind,
  docType,
  necessity,
  wording,
  appliesWhen,
}: {
  readonly packId: string;
  readonly requirementId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly docType: string | null;
  readonly necessity: 'MANDATORY' | 'RECOMMENDED' | 'OPTIONAL' | 'CONDITIONAL';
  readonly wording: string | null;
  readonly appliesWhen: string | null;
}) {
  const [saved, saveAction, saving] = useActionState(updateDraftItemAction, INITIAL);
  const [removed, removeAction, removing] = useActionState(removeDraftItemAction, INITIAL);
  const id = `item-${requirementId}`;
  // A conditional item keeps its rule; only the three plain words can be set here.
  const plain = necessity === 'CONDITIONAL' ? 'MANDATORY' : necessity;
  return (
    <div className="field-list">
      <form action={saveAction} className="form-grid">
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="requirementId" value={requirementId} />
        {kind === 'DOCUMENT' ? (
          <div className="field-row">
            <label className="field-label" htmlFor={`${id}-type`}>
              Document Type
            </label>
            <input
              id={`${id}-type`}
              name="docType"
              type="text"
              className="input"
              list="catalogue-document-types"
              defaultValue={docType ?? ''}
            />
          </div>
        ) : null}
        {necessity === 'CONDITIONAL' ? null : (
          <div className="field-row">
            <label className="field-label" htmlFor={`${id}-necessity`}>
              How Necessary
            </label>
            <select id={`${id}-necessity`} name="necessity" className="input" defaultValue={plain}>
              <option value="MANDATORY">Required</option>
              <option value="RECOMMENDED">Recommended</option>
              <option value="OPTIONAL">Optional</option>
            </select>
          </div>
        )}
        <div className="field-row field-wide">
          <label className="field-label" htmlFor={`${id}-wording`}>
            Wording for the Traveller
          </label>
          <input
            id={`${id}-wording`}
            name="wording"
            type="text"
            maxLength={400}
            className="input"
            defaultValue={wording ?? ''}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`${id}-applies`}>
            Who It Is For
          </label>
          <input
            id={`${id}-applies`}
            name="appliesWhen"
            type="text"
            maxLength={120}
            className="input"
            defaultValue={appliesWhen ?? ''}
          />
        </div>
        <SubmitButton
          pending={saving}
          idle="Save Item"
          busy="Saving"
          className="btn btn-secondary"
        />
        <FormMessage result={saved} pending={saving} pendingText="Saving" />
      </form>
      <form action={removeAction}>
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="requirementId" value={requirementId} />
        <SubmitButton
          pending={removing}
          idle="Remove Item"
          busy="Removing"
          className="btn btn-secondary"
        />
        <FormMessage result={removed} pending={removing} pendingText="Removing" />
      </form>
    </div>
  );
}
