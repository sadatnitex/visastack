'use client';

import { useActionState, useId, useRef } from 'react';
import {
  FieldError,
  FormMessage,
  type FormResult,
  NO_RESULT,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { appTripInvitationsCatalog } from '../../../../i18n/app-trip-invitations';
import { acceptTripInvitationAction, declineTripInvitationAction } from './actions';

/** One level a person may share, with the one plain line that says what the organiser then sees. */
export interface ShareChoice {
  readonly value: string;
  readonly label: string;
  readonly line: string;
}

/**
 * Join the Trip: confirm the name shown (as the organiser typed it, editable) and choose what to
 * share. Name Only is chosen already; the other two sit behind one quiet Share More choice. Only the
 * button press joins: the page itself, and the link that opened it, never do.
 */
export function AcceptTripInvitationForm({
  token,
  defaultName,
  first,
  more,
}: {
  readonly token: string;
  readonly defaultName: string;
  readonly first: ShareChoice;
  readonly more: readonly ShareChoice[];
}) {
  const t = useT(appTripInvitationsCatalog);
  const [state, action, pending] = useActionState<FormResult, FormData>(
    acceptTripInvitationAction,
    NO_RESULT,
  );
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const id = useId();
  const messageId = `${id}-msg`;
  const hintId = `${id}-hint`;
  const choice = (item: ShareChoice, checked: boolean) => (
    <label key={item.value} className="companion-choice">
      <input
        type="radio"
        name="shareLevel"
        value={item.value}
        defaultChecked={checked}
        {...fieldProblem(state, 'shareLevel', messageId)}
      />
      <span>
        <span className="companion-choice-label">{item.label}</span>
        <span className="muted u-fs-085">{item.line}</span>
      </span>
    </label>
  );
  return (
    <form ref={form} action={action} className="companion-accept-form">
      <input type="hidden" name="token" value={token} />
      <div className="companion-field">
        <label className="label" htmlFor={`${id}-name`}>
          {t('appTripInvitations.appTripInvitationsAcceptAcceptForm.yourName')}
        </label>
        <input
          id={`${id}-name`}
          name="displayName"
          required
          maxLength={120}
          autoComplete="off"
          defaultValue={defaultName}
          className="input"
          {...fieldProblem(state, 'displayName', messageId, hintId)}
        />
        <p id={hintId} className="muted u-fs-085 u-m-0">
          {t('appTripInvitations.appTripInvitationsAcceptAcceptForm.thisIsTheNameOthersOn')}
        </p>
        <FieldError result={state} field="displayName" />
      </div>
      <fieldset className="companion-share">
        <legend className="label">
          {t('appTripInvitations.appTripInvitationsIdJoinedTripForms.whatYouShareWithTheOrganiser')}
        </legend>
        {choice(first, true)}
        <details className="companion-more">
          <summary>{t('appTripInvitations.appTripInvitationsAcceptAcceptForm.shareMore')}</summary>
          {more.map((item) => choice(item, false))}
        </details>
        <FieldError result={state} field="shareLevel" />
      </fieldset>
      <p className="muted u-fs-085 u-m-0">
        {t('appTripInvitations.appTripInvitationsAcceptAcceptForm.youCanChangeThisOrLeave')}
      </p>
      <div className="companion-actions">
        <SubmitButton
          pending={pending}
          idle="Join the Trip"
          busy="Joining…"
          name="intent"
          value="join"
        />
      </div>
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

/** Decline: a quiet button of its own, so the name box is never needed to say no. */
export function DeclineTripInvitationForm({ token }: { readonly token: string }) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    declineTripInvitationAction,
    NO_RESULT,
  );
  return (
    <form action={action} className="companion-decline-form">
      <input type="hidden" name="token" value={token} />
      <SubmitButton
        pending={pending}
        idle="Decline"
        busy="Declining…"
        name="intent"
        value="decline"
        className="btn btn-secondary"
      />
      <FormMessage result={state} />
    </form>
  );
}
