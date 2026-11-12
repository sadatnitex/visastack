'use client';

import { useActionState, useRef } from 'react';
import {
  FieldError,
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../components/form-feedback';
import { useT } from '../../components/i18n-provider';
import { collectCatalog } from '../../i18n/collect';
import {
  type GuestActionState,
  placeFileAction,
  removeFileAction,
  submitDocumentsAction,
} from './actions';

const INITIAL: GuestActionState = { ok: true, message: '' };

export interface DeskItemOption {
  readonly id: string;
  readonly label: string;
}

/** Choose which checklist item one file answers (or none). */
export function PlaceFileForm({
  fileId,
  fileName,
  itemId,
  items,
}: {
  readonly fileId: string;
  readonly fileName: string;
  readonly itemId: string | null;
  readonly items: readonly DeskItemOption[];
}) {
  const t = useT(collectCatalog);
  const [state, formAction, pending] = useActionState(placeFileAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const selectId = `place-${fileId}`;
  const messageId = `place-${fileId}-message`;
  return (
    <form ref={form} action={formAction} className="collect-place-form">
      <input type="hidden" name="fileId" value={fileId} />
      <label className="field-label" htmlFor={selectId}>
        {t('collect.collectGuestFiles.checklistItemForFilename', { fileName })}
      </label>
      <select
        id={selectId}
        name="itemId"
        className="input"
        defaultValue={itemId ?? ''}
        {...fieldProblem(state, 'itemId', messageId)}
      >
        <option value="">{t('collect.collectGuestFiles.notPlacedYet')}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <FieldError result={state} field="itemId" />
      <SubmitButton
        pending={pending}
        idle="Save"
        busy="Saving…"
        className="btn btn-secondary"
        label={t('collect.collectGuestFiles.saveTheItemForFilename', { fileName })}
      />
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Saving…" />
    </form>
  );
}

/** Remove one file from the list. */
export function RemoveFileForm({
  fileId,
  fileName,
}: {
  readonly fileId: string;
  readonly fileName: string;
}) {
  const t = useT(collectCatalog);
  const [state, formAction, pending] = useActionState(removeFileAction, INITIAL);
  return (
    <form action={formAction} className="collect-remove-form">
      <input type="hidden" name="fileId" value={fileId} />
      <SubmitButton
        pending={pending}
        idle="Remove"
        busy="Removing…"
        className="btn btn-secondary"
        label={t('collect.collectGuestFiles.removeFilename', { fileName })}
      />
      <FormMessage
        id={`remove-${fileId}-message`}
        result={state}
        pending={pending}
        pendingText="Removing…"
      />
    </form>
  );
}

/** Submit Documents: the guest confirms, then exactly the placed files go. */
export function SubmitDocumentsForm({
  agencyName,
  consentText,
  ready,
  again,
}: {
  readonly agencyName: string | null;
  readonly consentText: string;
  /** False while a file is still being checked or nothing is placed yet. */
  readonly ready: boolean;
  /** True when the guest sent documents before (a correction or an addition). */
  readonly again: boolean;
}) {
  const [state, formAction, pending] = useActionState(submitDocumentsAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const messageId = 'guest-submit-message';
  return (
    <form ref={form} action={formAction} className="field-list collect-submit">
      <div className="field-row">
        <label className="collect-consent" htmlFor="guest-consent">
          <input
            id="guest-consent"
            type="checkbox"
            name="consent"
            value="yes"
            required
            {...fieldProblem(state, 'consent', messageId)}
          />
          <span>{consentText}</span>
        </label>
        <FieldError result={state} field="consent" />
      </div>
      <SubmitButton
        pending={pending}
        idle={again ? 'Submit Documents Again' : 'Submit Documents'}
        busy="Sending…"
        unavailable={!ready}
      />
      <p className="muted u-fs-085">
        {agencyName ?? 'The agency'} receives exactly the files placed above, as they are now.
        Received does not mean reviewed: the agency tells you here if something needs correcting.
      </p>
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Sending…" />
    </form>
  );
}
