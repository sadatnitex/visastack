'use client';

import { useActionState, useRef } from 'react';
import {
  FieldError,
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../../components/form-feedback';
import {
  type ActionState,
  checkNowAction,
  deactivateSourceAction,
  registerSourceAction,
  reviewCandidateAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export const AUTHORITY_TIER_LABELS = {
  GOVERNMENT: 'Government',
  CONSULATE: 'Consulate or Embassy',
  OFFICIAL_APPLICATION: 'Official Application Site',
  AUTHORIZED_VAC: 'Authorized Visa Centre',
} as const;

export function RegisterSourceForm({
  packs,
}: {
  readonly packs: readonly { readonly id: string; readonly name: string }[];
}) {
  const [state, formAction, pending] = useActionState(registerSourceAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const messageId = 'register-source-message';
  return (
    <form ref={form} action={formAction} className="field-list form-narrow">
      <fieldset className="form-section">
        <legend>Official Page</legend>
        <div className="form-grid">
          <div className="field-row field-wide">
            <label className="field-label" htmlFor="source-url">
              Page Address
            </label>
            <input
              id="source-url"
              name="url"
              type="url"
              required
              className="input"
              placeholder="https://"
              inputMode="url"
              {...fieldProblem(state, 'url', messageId, 'source-url-hint')}
            />
            <p id="source-url-hint" className="muted u-fs-085">
              The full https address of a government, consulate or official application page, as it
              finally opens in a browser. A page that moves to another site is reported, not
              followed (only a move within the same site, with or without www., is followed).
            </p>
            <FieldError result={state} field="url" />
          </div>
          <div className="field-row field-wide">
            <label className="field-label" htmlFor="source-title">
              Page Title
            </label>
            <input
              id="source-title"
              name="title"
              type="text"
              required
              maxLength={200}
              className="input"
              {...fieldProblem(state, 'title', messageId)}
            />
            <FieldError result={state} field="title" />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="source-publisher">
              Publisher
            </label>
            <input
              id="source-publisher"
              name="publisher"
              type="text"
              required
              maxLength={200}
              className="input"
              {...fieldProblem(state, 'publisher', messageId)}
            />
            <FieldError result={state} field="publisher" />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="source-tier">
              Speaks For
            </label>
            <select
              id="source-tier"
              name="authorityTier"
              className="input"
              defaultValue="GOVERNMENT"
            >
              {Object.entries(AUTHORITY_TIER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>
      <fieldset className="form-section">
        <legend>Route</legend>
        <div className="form-grid">
          <div className="field-row">
            <label className="field-label" htmlFor="source-jurisdiction">
              Country Code
            </label>
            <input
              id="source-jurisdiction"
              name="jurisdiction"
              type="text"
              required
              maxLength={2}
              autoCapitalize="characters"
              className="input"
              placeholder="GB"
              {...fieldProblem(state, 'jurisdiction', messageId)}
            />
            <FieldError result={state} field="jurisdiction" />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="source-route">
              Route (Optional)
            </label>
            <input
              id="source-route"
              name="route"
              type="text"
              maxLength={100}
              className="input"
              placeholder="visit"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="source-purpose">
              Purpose (Optional)
            </label>
            <input
              id="source-purpose"
              name="purpose"
              type="text"
              maxLength={100}
              className="input"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="source-pack">
              Linked Pack (Optional)
            </label>
            <select id="source-pack" name="packId" className="input" defaultValue="">
              <option value="">No Linked Pack</option>
              {packs.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>
      <SubmitButton pending={pending} idle="Register Source" busy="Registering…" />
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

/** Check Now for every active source, or for one when `sourceId` is given. */
export function CheckNowButton({
  sourceId,
  sourceTitle,
}: {
  readonly sourceId?: string;
  readonly sourceTitle?: string;
}) {
  const [state, formAction, pending] = useActionState(checkNowAction, INITIAL);
  return (
    <div>
      <form action={formAction}>
        {sourceId ? <input type="hidden" name="sourceId" value={sourceId} /> : null}
        <SubmitButton
          pending={pending}
          idle={sourceId ? 'Check Now' : 'Check All Now'}
          busy="Checking…"
          className={sourceId ? 'btn btn-secondary' : 'btn btn-primary'}
          {...(sourceTitle ? { label: `Check Now: ${sourceTitle}` } : {})}
        />
      </form>
      <FormMessage result={state} pending={pending} pendingText="Checking the official pages…" />
    </div>
  );
}

export function DeactivateSourceButton({
  sourceId,
  sourceTitle,
}: {
  readonly sourceId: string;
  readonly sourceTitle: string;
}) {
  const [state, formAction, pending] = useActionState(deactivateSourceAction, INITIAL);
  return (
    <div>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!window.confirm('Stop checking this page? Its history is kept.')) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="sourceId" value={sourceId} />
        <SubmitButton
          pending={pending}
          idle="Stop Checking"
          busy="Stopping…"
          className="btn btn-secondary"
          label={`Stop Checking: ${sourceTitle}`}
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

/** Mark In Review, Dismiss or Accept For Draft, with an optional note. */
export function CandidateDecisionForm({
  candidateId,
  status,
  sourceTitle,
}: {
  readonly candidateId: string;
  readonly status: 'NEW' | 'IN_REVIEW';
  readonly sourceTitle: string;
}) {
  const [state, formAction, pending] = useActionState(reviewCandidateAction, INITIAL);
  const noteId = `candidate-note-${candidateId}`;
  return (
    <form action={formAction} className="field-list u-mt-050">
      <input type="hidden" name="candidateId" value={candidateId} />
      <div className="field-row">
        <label className="field-label" htmlFor={noteId}>
          Review Note (Optional)
        </label>
        <input id={noteId} name="note" type="text" maxLength={1000} className="input" />
      </div>
      <div className="action-bar-end">
        {status === 'NEW' ? (
          <SubmitButton
            pending={pending}
            idle="Mark in Review"
            busy="Saving…"
            className="btn btn-secondary"
            name="decision"
            value="IN_REVIEW"
            label={`Mark in Review: ${sourceTitle}`}
          />
        ) : null}
        <SubmitButton
          pending={pending}
          idle="Dismiss"
          busy="Saving…"
          className="btn btn-secondary"
          name="decision"
          value="DISMISSED"
          label={`Dismiss: ${sourceTitle}`}
        />
        <SubmitButton
          pending={pending}
          idle="Accept for Draft"
          busy="Saving…"
          className="btn btn-primary"
          name="decision"
          value="ACCEPTED_FOR_DRAFT"
          label={`Accept for Draft: ${sourceTitle}`}
        />
      </div>
      <FormMessage result={state} />
    </form>
  );
}
