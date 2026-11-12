'use client';

import { useActionState, useId } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { useT } from '../../../../../components/i18n-provider';
import { appAgencyCatalog } from '../../../../../i18n/app-agency';
import {
  type ChecklistActionState,
  addItemAction,
  copyListAction,
  discardDraftAction,
  publishDraftAction,
  removeItemAction,
  saveItemAction,
  startUpdateAction,
} from './actions';

const INITIAL: ChecklistActionState = { ok: true, message: '' };

/** Copies a shared list into the agency's own and opens it to change. */
export function CopyListButton({
  organizationId,
  packVersionId,
  name,
}: {
  readonly organizationId: string;
  readonly packVersionId: string;
  readonly name: string;
}) {
  const t = useT(appAgencyCatalog);
  const [state, action, pending] = useActionState(copyListAction, INITIAL);
  return (
    <form action={action} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="packVersionId" value={packVersionId} />
      <SubmitButton
        pending={pending}
        idle="Make It Our Own"
        busy="Copying"
        label={t('appAgency.appAgencyOrgidChecklistsChecklistForms.makeItOurOwnName', { name })}
        className="btn btn-secondary"
      />
      <FormMessage result={state} pending={pending} pendingText="Copying" />
    </form>
  );
}

/** Opens a draft of the published list, so it can be changed without touching what cases use now. */
export function StartChangesButton({
  organizationId,
  packId,
}: {
  readonly organizationId: string;
  readonly packId: string;
}) {
  const [state, action, pending] = useActionState(startUpdateAction, INITIAL);
  return (
    <form action={action} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="packId" value={packId} />
      <SubmitButton
        pending={pending}
        idle="Change This List"
        busy="Opening"
        className="btn btn-primary"
      />
      <FormMessage result={state} pending={pending} pendingText="Opening" />
    </form>
  );
}

/** One item of the open draft: its wording, document type, how necessary it is and who it is for. */
export function ItemEditor({
  organizationId,
  packId,
  requirementId,
  kind,
  label,
  docType,
  necessity,
  wording,
  appliesWhen,
}: {
  readonly organizationId: string;
  readonly packId: string;
  readonly requirementId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  /** The item's name as the checklist shows it, so the person can tell which one they are changing. */
  readonly label: string;
  readonly docType: string | null;
  readonly necessity: 'MANDATORY' | 'RECOMMENDED' | 'OPTIONAL' | 'CONDITIONAL';
  readonly wording: string | null;
  readonly appliesWhen: string | null;
}) {
  const t = useT(appAgencyCatalog);
  const [saved, saveAction, saving] = useActionState(saveItemAction, INITIAL);
  const [removed, removeAction, removing] = useActionState(removeItemAction, INITIAL);
  const id = `item-${requirementId}`;
  // A conditional item keeps its rule; only the three plain words can be set here.
  const plain = necessity === 'CONDITIONAL' ? 'MANDATORY' : necessity;
  return (
    <div className="field-list">
      <strong>{label}</strong>
      <form action={saveAction} className="form-grid">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="requirementId" value={requirementId} />
        <div className="field-row field-wide">
          <label className="field-label" htmlFor={`${id}-wording`}>
            {t('appAgency.appAgencyOrgidChecklistsChecklistForms.whatTheTravellerReads')}
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
        {kind === 'DOCUMENT' ? (
          <div className="field-row">
            <label className="field-label" htmlFor={`${id}-type`}>
              {t('appAgency.appAgencyOrgidChecklistsChecklistForms.documentType')}
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
              {t('appAgency.appAgencyOrgidChecklistsChecklistForms.howNecessary')}
            </label>
            <select id={`${id}-necessity`} name="necessity" className="input" defaultValue={plain}>
              <option value="MANDATORY">
                {t('appAgency.appAgencyOrgidChecklistsChecklistForms.required')}
              </option>
              <option value="RECOMMENDED">
                {t('appAgency.appAgencyOrgidChecklistsChecklistForms.recommended')}
              </option>
              <option value="OPTIONAL">
                {t('appAgency.appAgencyOrgidChecklistsChecklistForms.optional')}
              </option>
            </select>
          </div>
        )}
        <div className="field-row">
          <label className="field-label" htmlFor={`${id}-applies`}>
            {t('appAgency.appAgencyOrgidChecklistsChecklistForms.whoItIsFor')}
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
        <input type="hidden" name="organizationId" value={organizationId} />
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

/** Adds an item of the agency's own to the open draft. */
export function AddItemForm({
  organizationId,
  packId,
  packVersionId,
}: {
  readonly organizationId: string;
  readonly packId: string;
  readonly packVersionId: string;
}) {
  const t = useT(appAgencyCatalog);
  const [state, action, pending] = useActionState(addItemAction, INITIAL);
  const id = useId();
  return (
    <form action={action} className="form-grid">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="packId" value={packId} />
      <input type="hidden" name="packVersionId" value={packVersionId} />
      <div className="field-row field-wide">
        <label className="field-label" htmlFor={`${id}-wording`}>
          {t('appAgency.appAgencyOrgidChecklistsChecklistForms.whatTheTravellerReads')}
        </label>
        <input
          id={`${id}-wording`}
          name="wording"
          type="text"
          required
          maxLength={400}
          className="input"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-type`}>
          {t('appAgency.appAgencyOrgidChecklistsChecklistForms.documentType')}
        </label>
        <input
          id={`${id}-type`}
          name="docType"
          type="text"
          required
          className="input"
          list="catalogue-document-types"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-necessity`}>
          {t('appAgency.appAgencyOrgidChecklistsChecklistForms.howNecessary')}
        </label>
        <select
          id={`${id}-necessity`}
          name="necessity"
          className="input"
          defaultValue="RECOMMENDED"
        >
          <option value="MANDATORY">
            {t('appAgency.appAgencyOrgidChecklistsChecklistForms.required')}
          </option>
          <option value="RECOMMENDED">
            {t('appAgency.appAgencyOrgidChecklistsChecklistForms.recommended')}
          </option>
          <option value="OPTIONAL">
            {t('appAgency.appAgencyOrgidChecklistsChecklistForms.optional')}
          </option>
        </select>
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-applies`}>
          {t('appAgency.appAgencyOrgidChecklistsChecklistForms.whoItIsFor')}
        </label>
        <input
          id={`${id}-applies`}
          name="appliesWhen"
          type="text"
          maxLength={120}
          className="input"
        />
      </div>
      <SubmitButton pending={pending} idle="Add Item" busy="Adding" className="btn btn-secondary" />
      <FormMessage result={state} pending={pending} pendingText="Adding" />
    </form>
  );
}

/** Publishes the open draft as the next version of the list. */
export function PublishButton({
  organizationId,
  packId,
  packVersionId,
}: {
  readonly organizationId: string;
  readonly packId: string;
  readonly packVersionId: string;
}) {
  const [state, action, pending] = useActionState(publishDraftAction, INITIAL);
  return (
    <form action={action} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="packId" value={packId} />
      <input type="hidden" name="packVersionId" value={packVersionId} />
      <SubmitButton
        pending={pending}
        idle="Publish"
        busy="Publishing"
        className="btn btn-primary"
      />
      <FormMessage result={state} pending={pending} pendingText="Publishing" />
    </form>
  );
}

/** Throws away the open draft. The published version stays as it is. */
export function DiscardButton({
  organizationId,
  packId,
  packVersionId,
}: {
  readonly organizationId: string;
  readonly packId: string;
  readonly packVersionId: string;
}) {
  const [state, action, pending] = useActionState(discardDraftAction, INITIAL);
  return (
    <form action={action} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="packId" value={packId} />
      <input type="hidden" name="packVersionId" value={packVersionId} />
      <SubmitButton
        pending={pending}
        idle="Discard Draft"
        busy="Discarding"
        className="btn btn-secondary"
      />
      <FormMessage result={state} pending={pending} pendingText="Discarding" />
    </form>
  );
}
