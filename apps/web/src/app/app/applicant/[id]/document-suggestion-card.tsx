'use client';

import { useActionState, useId, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { StatusBadge } from '../../../../components/ui';
import type { ChoiceGroup } from '../../../../lib/master-profile-types';
import { type ActionState, decideDocumentSuggestionAction } from './actions';
import type { DocumentSuggestionView } from './document-suggestion';

const INITIAL: ActionState = { ok: true, message: '' };

/** "a Bank Statement", "an Employment Certificate". */
function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;
}

/** An "Other" kind can carry a short name for what the document is (the same rule the kind setting uses). */
function isOtherKind(key: string): boolean {
  return key === 'OTHER' || key.startsWith('OTHER_');
}

/**
 * What we think a document is and what to call it, decided together (owner request 2026-10-25).
 * Accept saves the kind and the name at once; Edit lets the person choose another kind from the
 * catalogue and change the name, then save; Skip changes nothing. Shows no document content: only
 * the kind, the suggested name and where the Record will list it.
 */
export function DocumentSuggestionCard({
  applicantId,
  suggestion,
  groups,
}: {
  readonly applicantId: string;
  readonly suggestion: DocumentSuggestionView;
  /** The catalogue's kinds, grouped, for Edit (built on the server). */
  readonly groups: readonly ChoiceGroup[];
}) {
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
      <h3>Check the Kind and Name</h3>
      <article
        className="finding-card"
        data-clarity={suggestion.clear ? 'clear' : 'check'}
        aria-labelledby={headingId}
      >
        <header className="finding-card-head">
          <h4 id={headingId}>{heading}</h4>
          <StatusBadge tone={suggestion.clear ? 'success' : 'warning'}>
            {suggestion.clear ? 'Clear' : 'Please Check'}
          </StatusBadge>
          {suggestion.source === 'ai' ? <StatusBadge tone="neutral">Read by AI</StatusBadge> : null}
        </header>
        {editing ? null : (
          <dl className="document-suggestion-facts">
            <div>
              <dt>Name</dt>
              <dd>{suggestion.proposedName}</dd>
            </div>
            {suggestion.recordGroup ? (
              <div>
                <dt>Listed Under</dt>
                <dd>{suggestion.recordGroup} on your Record</dd>
              </div>
            ) : null}
          </dl>
        )}
        <p className="muted u-fs-085">Nothing is saved until you accept.</p>
        <form ref={formRef} action={formAction} className="finding-form">
          <input type="hidden" name="applicantId" value={applicantId} />
          <input type="hidden" name="documentId" value={suggestion.documentId} />
          <input type="hidden" name="nameVersionId" value={suggestion.nameVersionId ?? ''} />
          <input type="hidden" name="typeProposalId" value={suggestion.typeProposalId ?? ''} />
          {editing ? (
            <>
              <div className="finding-value">
                <label className="field-label" htmlFor={kindId}>
                  Kind of Document
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
                  <option value="">Choose a Kind</option>
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
              {isOtherKind(kind) ? (
                <div className="finding-value">
                  <label className="field-label" htmlFor={subjectId}>
                    What Is It?
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
                  Name
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
                    Cancel
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
                  Edit
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
