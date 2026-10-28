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
 * question "Who is this record for?" (Me, or Someone I Manage, which then asks Family Member or
 * Minor and the authority confirmation). The page moves on by itself once the applicant exists.
 *
 * `selfAdded`: the account already has a record for the person themselves. The form then starts
 * on Family Member and marks Myself as already added. Myself stays a choice, because the service
 * accepts a second record for yourself (createApplicant sets no limit); the form only says what
 * that choice will do.
 */
export function AddApplicantForm({
  firstRun = false,
  selfAdded = false,
}: { readonly firstRun?: boolean; readonly selfAdded?: boolean } = {}) {
  return firstRun ? <FirstRunApplicantForm /> : <ApplicantForm selfAdded={selfAdded} />;
}

/** The authority statement both forms ask for: one sentence, so a wording change reaches both. */
const AUTHORITY_SENTENCE =
  'I confirm I have authority to create and manage this record on their behalf. This is never assumed from a shared name or address.';

type WhoFor = 'SELF' | 'MANAGED';
type ManagedKind = 'FAMILY_MEMBER' | 'MINOR_GUARDIAN';

/**
 * The first-run form sends what the person chose with the radios themselves (whoFor, and
 * managedKind for someone they manage), so it works the same before the page has finished
 * loading or without scripts; the server works out the relationship from them. The second
 * question and the authority confirmation show only for Someone I Manage, by style alone.
 */
function FirstRunApplicantForm() {
  const [state, formAction, pending] = useActionState(createApplicantAction, INITIAL);
  const [whoFor, setWhoFor] = useState<WhoFor>('SELF');
  const [managedKind, setManagedKind] = useState<ManagedKind | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  useFocusInvalidField(formRef, state);
  const managed = whoFor === 'MANAGED';
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
            onChange={() => setWhoFor('SELF')}
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
            onChange={() => {
              setWhoFor('MANAGED');
              setManagedKind((kind) => kind ?? 'FAMILY_MEMBER');
            }}
          />
          <span>
            <b>Someone I Manage</b>
            <small>A family member</small>
          </span>
        </label>
      </fieldset>
      <div className="first-run-managed">
        <fieldset className="first-run-choice">
          <legend className="field-label">How are they related to you?</legend>
          <label>
            <input
              type="radio"
              name="managedKind"
              value="FAMILY_MEMBER"
              checked={managedKind === 'FAMILY_MEMBER'}
              onChange={() => setManagedKind('FAMILY_MEMBER')}
              {...fieldProblem(state, 'managedKind', messageId)}
            />
            <span>
              <b>Family Member</b>
              <small>Adult relative</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="managedKind"
              value="MINOR_GUARDIAN"
              checked={managedKind === 'MINOR_GUARDIAN'}
              onChange={() => setManagedKind('MINOR_GUARDIAN')}
            />
            <span>
              <b>Minor (Guardian)</b>
              <small>A child in my care</small>
            </span>
          </label>
        </fieldset>
      </div>
      <div>
        <label className="field-label" htmlFor="displayName">
          Name as on the Passport
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
      <div className="first-run-managed">
        <label className="first-run-authority">
          <input
            type="checkbox"
            name="authorityConfirmed"
            value="true"
            required={managed}
            {...fieldProblem(state, 'authorityConfirmed', messageId)}
          />
          <span>{AUTHORITY_SENTENCE}</span>
        </label>
      </div>
      <SubmitButton pending={pending} idle="Continue" busy="Saving…" className="btn btn-primary" />
      <FormMessage id={messageId} result={state} />
      <p className="muted first-run-note">
        You can change this later. Nothing is shared with anyone.
      </p>
    </form>
  );
}

function ApplicantForm({ selfAdded }: { readonly selfAdded: boolean }) {
  const [state, formAction, pending] = useActionState(createApplicantAction, INITIAL);
  const [relationship, setRelationship] = useState(selfAdded ? 'FAMILY_MEMBER' : 'SELF');
  // Once a record for yourself exists (for example the one just added), the next one is for
  // someone else, without waiting for a full page reload.
  useEffect(() => {
    if (selfAdded) setRelationship((current) => (current === 'SELF' ? 'FAMILY_MEMBER' : current));
  }, [selfAdded]);
  const formRef = useRef<HTMLFormElement>(null);
  const messageId = useId();
  const selfNoteId = useId();
  useFocusInvalidField(formRef, state);
  const needsAuthority = relationship !== 'SELF';
  const secondSelf = selfAdded && relationship === 'SELF';

  return (
    <form
      ref={formRef}
      action={formAction}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}
    >
      <div>
        <label className="field-label" htmlFor="displayName">
          Full Name
        </label>
        <input
          id="displayName"
          name="displayName"
          placeholder="Full Name"
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
          aria-describedby={secondSelf ? selfNoteId : undefined}
        >
          <option value="SELF">{selfAdded ? 'Myself (Already Added)' : 'Myself'}</option>
          <option value="FAMILY_MEMBER">Family Member</option>
          <option value="MINOR_GUARDIAN">Minor (Guardian)</option>
        </select>
        {secondSelf ? (
          <p className="field-hint" id={selfNoteId}>
            You already have a record for yourself. Choosing Myself again adds a second, separate
            record; your details and documents are not copied into it.
          </p>
        ) : null}
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
          <span>{AUTHORITY_SENTENCE}</span>
        </label>
      ) : null}
      <SubmitButton
        pending={pending}
        idle="Add Traveller"
        busy="Adding…"
        className="btn btn-primary"
      />
      <FormMessage id={messageId} result={state} />
    </form>
  );
}
