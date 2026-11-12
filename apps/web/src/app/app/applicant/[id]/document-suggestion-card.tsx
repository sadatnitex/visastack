'use client';

import { isOtherDocumentType } from '@visastack/core';
import { useActionState, useId, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { StatusBadge } from '../../../../components/ui';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import type { ChoiceGroup } from '../../../../lib/master-profile-types';
import { type ActionState, decideDocumentSuggestionAction } from './actions';
import type { DocumentSuggestionView } from './document-suggestion';

const INITIAL: ActionState = { ok: true, message: '' };

/** "a Bank Statement", "an Employment Certificate". */
function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;
}

/**
 * What we think a document is and what to call it, decided together (owner request 2026-10-25).
 * Accept saves the kind and the name at once; Edit lets the person choose another kind from the
 * catalogue and change the name, then save; Skip changes nothing. Shows no document content: only
 * the kind, the suggested name and where the Record will list it.
 */
/** Said before Accept whenever accepting would take away the fresh sign-in check (owner decision 2026-10-25). */
export const REMOVES_FRESH_SIGN_IN =
  'After you accept, this file will open without the extra sign-in check.';

export function DocumentSuggestionCard({
  applicantId,
  suggestion,
  groups,
  protectedKinds,
}: {
  readonly applicantId: string;
  readonly suggestion: DocumentSuggestionView;
  /** The catalogue's kinds, grouped, for Edit (built on the server). */
  readonly groups: readonly ChoiceGroup[];
  /** The kinds that need a fresh sign-in check under the live settings (built on the server). */
  readonly protectedKinds: readonly string[];
}) {
  const t = useT(appApplicantCatalog);
  const [state, formAction, pending] = useActionState(decideDocumentSuggestionAction, INITIAL);
  const [editing, setEditing] = useState(suggestion.kind === null);
  const [kind, setKind] = useState(suggestion.kind ?? '');
  const [name, setName] = useState(suggestion.proposedName);
  const [nameEdited, setNameEdited] = useState(false);
  const labelOf = (key: string): string | undefined =>
    groups.flatMap((group) => group.choices).find((choice) => choice.key === key)?.label;
  const formRef = useRef<HTMLFormElement>(null);
  const headingId = useId();
  const kindId = useId();
  const nameId = useId();
  const subjectId = useId();
  const messageId = useId();
  useFocusInvalidField(formRef, state);

  const heading = suggestion.kindLabel
    ? `We think this is ${withArticle(suggestion.kindLabel)}`
    : 'We could not tell what kind of document this is';

  return (
    <div className="document-findings document-suggestion">
      <h3>{t('appApplicant.appApplicantIdDocumentSuggestionCard.checkTheKindAndName')}</h3>
      <article
        className="finding-card"
        data-clarity={suggestion.clear ? 'clear' : 'check'}
        aria-labelledby={headingId}
      >
        <header className="finding-card-head">
          <h4 id={headingId}>{heading}</h4>
          <StatusBadge tone={suggestion.clear ? 'success' : 'warning'}>
            {suggestion.clear
              ? t('appApplicant.appApplicantIdDocumentSuggestionCard.clear')
              : t('appApplicant.appApplicantIdDocumentSuggestionCard.pleaseCheck')}
          </StatusBadge>
          {suggestion.source === 'ai' ? (
            <StatusBadge tone="neutral">
              {t('appApplicant.appApplicantIdDocumentSuggestionCard.readByAi')}
            </StatusBadge>
          ) : null}
        </header>
        {editing ? null : (
          <dl className="document-suggestion-facts">
            <div>
              <dt>{t('appApplicant.appApplicantIdDocumentSuggestionCard.name')}</dt>
              <dd>{suggestion.proposedName}</dd>
            </div>
            {suggestion.recordGroup ? (
              <div>
                <dt>{t('appApplicant.appApplicantIdDocumentSuggestionCard.listedUnder')}</dt>
                <dd>
                  {t('appApplicant.appApplicantIdDocumentSuggestionCard.recordgroupOnYourRecord', {
                    recordGroup: suggestion.recordGroup,
                  })}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
        {(
          editing
            ? suggestion.protectedNow && kind !== '' && !protectedKinds.includes(kind)
            : suggestion.removesFreshSignIn
        ) ? (
          <p className="notice notice-warn u-fs-085">{REMOVES_FRESH_SIGN_IN}</p>
        ) : null}
        <p className="muted u-fs-085">
          {t('appApplicant.appApplicantIdDocumentSuggestionCard.nothingIsSavedUntilYouAccept')}
        </p>
        <form ref={formRef} action={formAction} className="finding-form">
          <input type="hidden" name="applicantId" value={applicantId} />
          <input type="hidden" name="documentId" value={suggestion.documentId} />
          <input type="hidden" name="nameVersionId" value={suggestion.nameVersionId ?? ''} />
          <input type="hidden" name="typeProposalId" value={suggestion.typeProposalId ?? ''} />
          {editing ? (
            <>
              <div className="finding-value">
                <label className="field-label" htmlFor={kindId}>
                  {t('appApplicant.appApplicantIdDocumentSuggestionCard.kindOfDocument')}
                </label>
                <select
                  id={kindId}
                  name="docType"
                  className="input"
                  value={kind}
                  onChange={(event) => {
                    const next = event.target.value;
                    setKind(next);
                    // Until the person types their own name, the name follows the kind.
                    const label = labelOf(next);
                    if (!nameEdited && label) setName(`${label}${suggestion.nameAfterKind}`);
                  }}
                  {...fieldProblem(state, 'docType', messageId)}
                >
                  <option value="">
                    {t('appApplicant.appApplicantIdDocumentSuggestionCard.chooseAKind')}
                  </option>
                  {groups.map((group) => (
                    <optgroup key={group.key} label={group.label}>
                      {group.choices.map((choice) => (
                        <option key={choice.key} value={choice.key}>
                          {choice.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              {isOtherDocumentType(kind) ? (
                <div className="finding-value">
                  <label className="field-label" htmlFor={subjectId}>
                    {t('appApplicant.appApplicantIdDocumentSuggestionCard.whatIsIt')}
                  </label>
                  <input
                    id={subjectId}
                    name="subject"
                    type="text"
                    maxLength={120}
                    className="input"
                  />
                </div>
              ) : null}
              <div className="finding-value">
                <label className="field-label" htmlFor={nameId}>
                  {t('appApplicant.appApplicantIdDocumentSuggestionCard.name')}
                </label>
                <input
                  id={nameId}
                  name="name"
                  type="text"
                  maxLength={200}
                  className="input"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameEdited(true);
                  }}
                  {...fieldProblem(state, 'name', messageId)}
                />
              </div>
              <div className="document-suggestion-actions">
                <SubmitButton
                  pending={pending}
                  idle="Save"
                  busy="Saving…"
                  className="btn btn-primary"
                  name="suggestionAction"
                  value="accept"
                />
                {suggestion.kind ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setKind(suggestion.kind ?? '');
                      setName(suggestion.proposedName);
                      setNameEdited(false);
                      setEditing(false);
                    }}
                  >
                    {t('appApplicant.appApplicantIdDocumentSuggestionCard.cancel')}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <input type="hidden" name="docType" value={suggestion.kind ?? ''} />
              <input type="hidden" name="name" value={suggestion.proposedName} />
              <div className="document-suggestion-actions">
                <SubmitButton
                  pending={pending}
                  idle="Accept"
                  busy="Saving…"
                  className="btn btn-primary"
                  name="suggestionAction"
                  value="accept"
                  label={`Accept: ${suggestion.kindLabel ?? 'Document'}, ${suggestion.proposedName}`}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditing(true)}
                >
                  {t('appApplicant.appApplicantIdDocumentSuggestionCard.edit')}
                </button>
              </div>
            </>
          )}
        </form>
        {/* Skipping has its own form, so a choice the main form requires never blocks it. */}
        <form action={formAction} className="finding-skip">
          <input type="hidden" name="applicantId" value={applicantId} />
          <input type="hidden" name="documentId" value={suggestion.documentId} />
          <input type="hidden" name="nameVersionId" value={suggestion.nameVersionId ?? ''} />
          <input type="hidden" name="typeProposalId" value={suggestion.typeProposalId ?? ''} />
          <SubmitButton
            pending={pending}
            idle="Skip"
            busy="Skipping…"
            className="btn btn-secondary"
            name="suggestionAction"
            value="skip"
          />
        </form>
        <FormMessage id={messageId} result={state} />
      </article>
    </div>
  );
}
