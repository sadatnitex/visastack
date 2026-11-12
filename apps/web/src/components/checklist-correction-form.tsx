'use client';

import { useActionState, useId, useRef } from 'react';
import { componentsCatalog } from '../i18n/components';
import {
  FieldError,
  FormMessage,
  type FormResult,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from './form-feedback';
import { useT } from './i18n-provider';

/** One choice in a list: the stored value and its plain words. */
export interface CorrectionOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Suggest a Checklist Correction (UMPE P11): what looks wrong, an optional official link and an
 * optional detail. Used on a case checklist line (the item is fixed) and on an agency request (the
 * agency picks the item). Sending it changes nothing in the checklist: pack editors check it
 * against the official source first.
 */
export function ChecklistCorrectionForm({
  action,
  hidden,
  categories,
  items,
  itemName,
}: {
  readonly action: (prev: FormResult, formData: FormData) => Promise<FormResult>;
  /** Fields the form sends as they are (the case or request, and a fixed item). */
  readonly hidden: Readonly<Record<string, string>>;
  readonly categories: readonly CorrectionOption[];
  /** When given, the person chooses the item (an empty value means the whole checklist). */
  readonly items?: readonly CorrectionOption[];
  /** The fixed item's plain name, so each form on a page says which item it is for. */
  readonly itemName?: string;
}) {
  const t = useT(componentsCatalog);
  const [state, formAction, pending] = useActionState<FormResult, FormData>(action, NO_RESULT);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  const linkHint = `${id}-link-hint`;
  const detailHint = `${id}-detail-hint`;
  const forItem = itemName ? ` for ${itemName}` : '';
  return (
    <form ref={form} action={formAction} className="field-list correction-form">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {items ? (
        <div className="field-row">
          <label className="field-label" htmlFor={`${id}-item`}>
            {t.node('components.checklistCorrectionForm.checklistItem')}
          </label>
          <select
            id={`${id}-item`}
            name="packRequirementId"
            className="input"
            defaultValue=""
            {...fieldProblem(state, 'packRequirementId', messageId)}
          >
            <option value="">
              {t.node('components.checklistCorrectionForm.somethingMissingFromTheChecklist')}
            </option>
            {items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <FieldError result={state} field="packRequirementId" />
        </div>
      ) : null}
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-category`}>
          {t.node('components.checklistCorrectionForm.whatLooksWrongForitem', { forItem })}
        </label>
        <select
          id={`${id}-category`}
          name="category"
          className="input"
          required
          defaultValue=""
          {...fieldProblem(state, 'category', messageId)}
        >
          <option value="" disabled>
            {t.node('components.checklistCorrectionForm.chooseOne')}
          </option>
          {categories.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
        <FieldError result={state} field="category" />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-link`}>
          {t.node('components.checklistCorrectionForm.officialPageOptional')}
        </label>
        <input
          id={`${id}-link`}
          name="officialUrl"
          type="url"
          inputMode="url"
          maxLength={2048}
          placeholder={t('components.checklistCorrectionForm.https')}
          className="input"
          {...fieldProblem(state, 'officialUrl', messageId, linkHint)}
        />
        <p id={linkHint} className="muted u-fs-085 u-m-0">
          {t.node('components.checklistCorrectionForm.theGovernmentEmbassyOrOfficialApplication')}
        </p>
        <FieldError result={state} field="officialUrl" />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor={`${id}-detail`}>
          {t.node('components.checklistCorrectionForm.whatShouldItSayOptional')}
        </label>
        <textarea
          id={`${id}-detail`}
          name="detail"
          rows={3}
          maxLength={1000}
          className="input"
          {...fieldProblem(state, 'detail', messageId, detailHint)}
        />
        <p id={detailHint} className="muted u-fs-085 u-m-0">
          {t.node('components.checklistCorrectionForm.doNotIncludeNamesPassportNumbers')}
        </p>
        <FieldError result={state} field="detail" />
      </div>
      <div className="action-bar-end">
        <SubmitButton
          pending={pending}
          idle="Send Suggestion"
          busy="Sending…"
          className="btn btn-secondary"
          {...(itemName ? { label: `Send Suggestion for ${itemName}` } : {})}
        />
      </div>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
