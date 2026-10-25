'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../components/form-feedback';
import { type ActionState, createApplicantAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * Adds an applicant. With `firstRun`, the same action and values are presented as the first-run
 * question "Who is this record for?" (Me, or Someone I manage, which then asks Family member or
 * Minor and the authority confirmation). The page moves on by itself once the applicant exists.
 */
export function AddApplicantForm({ firstRun = false }: { readonly firstRun?: boolean } = {}) {
  return firstRun ? <FirstRunApplicantForm /> : <ApplicantForm />;
}

function FirstRunApplicantForm() {
  const [state, formAction, pending] = useActionState(createApplicantAction, INITIAL);
  const [relationship, setRelationship] = useState('SELF');
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  // The choice lives in this component's state, so Continue waits until the page is ready: a tap
  // before then would otherwise send the default (Me) for someone looking after a relative.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  useFocusInvalidField(formRef, state);
  const managed = relationship !== 'SELF';
  return (
    <form ref={formRef} action={formAction} className="first-run-form">
      <fieldset className="first-run-choice">
        <legend className="field-label">Who is this record for?</legend>
        <label>
          <input
            type="radio"
            name="whoFor"
            value="SELF"
            checked={!managed}
            onChange={() => setRelationship('SELF')}
          />
          <span>
            <b>Me</b>
            <small>My own papers</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="whoFor"
            value="MANAGED"
            checked={managed}
            onChange={() => setRelationship('FAMILY_MEMBER')}
          />
          <span>
            <b>Someone I manage</b>
            <small>A family member</small>
          </span>
        </label>
      </fieldset>
      {managed ? (
        <fieldset className="first-run-choice">
          <legend className="field-label">How are they related to you?</legend>
          <label>
            <input
              type="radio"
              name="managedKind"
              value="FAMILY_MEMBER"
              checked={relationship === 'FAMILY_MEMBER'}
              onChange={() => setRelationship('FAMILY_MEMBER')}
            />
            <span>
              <b>Family member</b>
              <small>Adult relative</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="managedKind"
              value="MINOR_GUARDIAN"
              checked={relationship === 'MINOR_GUARDIAN'}
              onChange={() => setRelationship('MINOR_GUARDIAN')}
            />
            <span>
              <b>Minor (guardian)</b>
              <small>A child in my care</small>
            </span>
          </label>
        </fieldset>
      ) : null}
      <input type="hidden" name="relationship" value={relationship} />
      <div>
        <label className="field-label" htmlFor="displayName">
          Name as on the passport
        </label>
        <input
          id="displayName"
          name="displayName"
          required
          autoComplete={managed ? 'off' : 'name'}
          className="input"
          {...fieldProblem(state, 'displayName', messageId)}
        />
      </div>
      {managed ? (
        <label className="first-run-authority">
          <input
            type="checkbox"
            name="authorityConfirmed"
            value="true"
            required
            {...fieldProblem(state, 'authorityConfirmed', messageId)}
          />
          <span>
            I confirm I have authority to create and manage this record on their behalf. This is
            never assumed from a shared name or address.
          </span>
        </label>
      ) : null}
      <SubmitButton
        pending={pending}
        unavailable={!ready}
        idle="Continue"
        busy="Saving…"
        className="btn btn-primary"
      />
      <FormMessage id={messageId} result={state} />
      <p className="muted first-run-note">
        You can change this later. Nothing is shared with anyone.
      </p>
    </form>
  );
}

function ApplicantForm() {
  const [state, formAction, pending] = useActionState(createApplicantAction, INITIAL);
  const [relationship, setRelationship] = useState('SELF');
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  useFocusInvalidField(formRef, state);
  const needsAuthority = relationship !== 'SELF';

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}
    >
      <div>
        <label className="field-label" htmlFor="displayName">
          Full name
        </label>
        <input
          id="displayName"
          name="displayName"
          placeholder="Full name"
          required
          className="input"
          {...fieldProblem(state, 'displayName', messageId)}
          style={{ width: '100%', marginTop: '0.35rem' }}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="relationship">
          Relationship
        </label>
        <select
          id="relationship"
          name="relationship"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          className="input"
          style={{ width: '100%', marginTop: '0.35rem' }}
        >
          <option value="SELF">Myself</option>
          <option value="FAMILY_MEMBER">Family member</option>
          <option value="MINOR_GUARDIAN">Minor (guardian)</option>
        </select>
      </div>
      {needsAuthority ? (
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            fontSize: 'var(--text-small)',
          }}
        >
          <input
            type="checkbox"
            name="authorityConfirmed"
            value="true"
            required
            {...fieldProblem(state, 'authorityConfirmed', messageId)}
          />
          <span>
            I confirm I have authority to create and manage this record on their behalf. This is
            never assumed from a shared name or address.
          </span>
        </label>
      ) : null}
      <SubmitButton
        pending={pending}
        idle="Add applicant"
        busy="Adding…"
        className="btn btn-primary"
      />
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
