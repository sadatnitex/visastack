'use client';

import { useActionState, useId, useRef } from 'react';
import {
  FieldError,
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../../components/form-feedback';
import {
  type ReviewActionState,
  guestHoldAction,
  reviewAnswerAction,
} from './collection-review-actions';

const INITIAL: ReviewActionState = { ok: true, message: '' };

/**
 * One review decision on one answer (UMPE P9): Received, Needs Correction or Accepted, with an
 * optional note per item (needed for Needs Correction) and a general note. The same form for an
 * answer from a signed-in traveller and from a guest.
 */
export function ReviewAnswerForm({
  organizationId,
  requestId,
  source,
  answerId,
  items,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly source: 'account' | 'guest';
  readonly answerId: string;
  readonly items: readonly { readonly id: string; readonly label: string }[];
}) {
  const [state, formAction, pending] = useActionState(reviewAnswerAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const base = useId();
  const messageId = `${base}-message`;
  const invalid = !state.ok && state.field === 'decision';
  return (
    <form ref={form} action={formAction} className="field-list collection-review-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="answerId" value={answerId} />
      <fieldset
        className="form-section"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? messageId : undefined}
      >
        <legend>Your Decision</legend>
        <div className="collection-review-options">
          {(
            [
              ['RECEIVED', 'Received'],
              ['NEEDS_CORRECTION', 'Needs Correction'],
              ['ACCEPTED', 'Accepted'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="collection-review-option" htmlFor={`${base}-${value}`}>
              <input id={`${base}-${value}`} type="radio" name="decision" value={value} required />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <details className="collection-review-notes">
        <summary>Add Notes for the Person</summary>
        {items.map((item) => (
          <div key={item.id} className="field-row">
            <label className="field-label" htmlFor={`${base}-note-${item.id}`}>
              Note on {item.label}
            </label>
            <textarea
              id={`${base}-note-${item.id}`}
              name={`note:${item.id}`}
              className="input"
              rows={2}
              maxLength={500}
            />
          </div>
        ))}
        <div className="field-row">
          <label className="field-label" htmlFor={`${base}-note`}>
            General Note
          </label>
          <textarea id={`${base}-note`} name="note" className="input" rows={2} maxLength={1000} />
        </div>
      </details>
      <SubmitButton
        pending={pending}
        idle="Save Decision"
        busy="Saving…"
        className="btn btn-secondary"
      />
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Saving…" />
    </form>
  );
}

/** Place or release the legal hold that keeps this request's guest files past their period. */
export function GuestHoldForm({
  organizationId,
  requestId,
  held,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly held: boolean;
}) {
  const [state, formAction, pending] = useActionState(guestHoldAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const messageId = 'guest-hold-message';
  return (
    <form ref={form} action={formAction} className="field-list">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="intent" value={held ? 'release' : 'place'} />
      {held ? null : (
        <div className="field-row">
          <label className="field-label" htmlFor="guest-hold-reason">
            Reason for the Hold
          </label>
          <textarea
            id="guest-hold-reason"
            name="reason"
            className="input"
            rows={2}
            maxLength={500}
            required
            {...fieldProblem(state, 'reason', messageId)}
          />
          <FieldError result={state} field="reason" />
        </div>
      )}
      <SubmitButton
        pending={pending}
        idle={held ? 'Release the Hold' : 'Place a Legal Hold'}
        busy="Saving…"
        className="btn btn-secondary"
      />
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Saving…" />
    </form>
  );
}
