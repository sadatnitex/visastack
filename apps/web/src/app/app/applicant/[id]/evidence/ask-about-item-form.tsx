'use client';

import { useActionState, useEffect, useId, useRef } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { SAVING_TEXT, saveResult } from '../../../../../lib/save-status';
import { type ActionState, askAboutRequestItemAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * A short question to the agency about one request (spec B09: item-specific clarification through
 * the existing comment mechanism, no separate chat). It becomes a shared note on the case, so the
 * form says who can read it before anything is sent, and it says Saving, Saved at or Not saved.
 */
export function AskAboutItemForm({
  applicantId,
  missionId,
  requestId,
  maxLength,
  timeZone = null,
  itemLabel,
}: {
  readonly applicantId: string;
  readonly missionId: string;
  readonly requestId: string;
  /** The longest question the service accepts (it is the source of the number). */
  readonly maxLength: number;
  readonly timeZone?: string | null;
  /** What the request is for, so several Send Question buttons on one page each say which item. */
  readonly itemLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(askAboutRequestItemAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  const fieldId = useId();
  const noteId = `${fieldId}-note`;

  // A saved question leaves the box empty for the next one; a failed one keeps the words.
  useEffect(() => {
    if (state.ok && state.savedAt) form.current?.reset();
  }, [state]);

  return (
    <form action={formAction} className="request-ask-form" ref={form}>
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="missionId" value={missionId} />
      <input type="hidden" name="requestId" value={requestId} />
      <div className="field-row">
        <label htmlFor={fieldId} className="field-label">
          Your Question
        </label>
        <textarea
          id={fieldId}
          name="question"
          rows={3}
          maxLength={maxLength}
          required
          aria-describedby={noteId}
          className="input"
        />
        <p id={noteId} className="muted u-fs-085 request-ask-note">
          Everyone who can read the shared notes on this case will see your question. Do not type
          passport, bank or card numbers. Up to {maxLength} characters.
        </p>
      </div>
      <div className="request-response-actions">
        <SubmitButton
          pending={pending}
          idle={state.ok ? 'Send Question' : 'Try Again'}
          {...(itemLabel
            ? { label: `${state.ok ? 'Send Question' : 'Try Again'} ${itemLabel}` }
            : {})}
          busy="Sending…"
          className="btn btn-secondary"
        />
        <FormMessage
          result={saveResult(state, timeZone)}
          pending={pending}
          pendingText={SAVING_TEXT}
        />
      </div>
    </form>
  );
}
