'use client';

import { useActionState, useId, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { type ActionState, decideDocumentNameAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const TYPE_LABELS: Record<string, string> = {
  PASSPORT: 'Passport',
  BANK_STATEMENT: 'Bank Statement',
  EMPLOYMENT_CERTIFICATE: 'Employment Certificate',
};

export function NameReview({
  applicantId,
  nameVersionId,
  originalName,
  proposedName,
  classification,
}: {
  readonly applicantId: string;
  readonly nameVersionId: string;
  readonly originalName: string;
  readonly proposedName: string;
  readonly classification: {
    readonly classifiedType: string | null;
    readonly confidence: number;
    readonly reviewRequired: boolean;
  } | null;
}) {
  const [state, formAction, pending] = useActionState(decideDocumentNameAction, INITIAL);
  const [editedName, setEditedName] = useState(proposedName);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  useFocusInvalidField(formRef, state);

  return (
    <div
      className="card"
      style={{
        padding: '0.85rem',
        marginTop: '0.5rem',
        background: 'var(--bg-subtle)',
        border: '1px solid var(--hairline-soft)',
      }}
    >
      <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.4rem' }}>
        Original: {originalName}
        {classification?.classifiedType ? (
          <>
            {' · '}
            <span className="badge badge-neutral">
              {TYPE_LABELS[classification.classifiedType] ?? classification.classifiedType} (
              {classification.confidence}% confidence)
            </span>
          </>
        ) : null}
      </p>
      <form
        ref={formRef}
        action={formAction}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="nameVersionId" value={nameVersionId} />
        <input type="hidden" name="originalProposal" value={proposedName} />
        <input
          type="text"
          name="finalName"
          aria-label="Proposed filename"
          value={editedName}
          onChange={(e) => setEditedName(e.target.value)}
          className="input"
          {...fieldProblem(state, 'finalName', messageId)}
          style={{ flex: '1 1 260px', fontSize: '0.85rem', padding: '0.4rem 0.65rem' }}
        />
        <SubmitButton
          pending={pending}
          idle="Approve"
          busy="Saving…"
          className="btn btn-primary"
          style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}
          name="nameAction"
          value="accept"
        />
        <SubmitButton
          pending={pending}
          idle="Reject"
          busy="Reject"
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}
          name="nameAction"
          value="reject"
        />
      </form>
      <FormMessage id={messageId} result={state} />
    </div>
  );
}
