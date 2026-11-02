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
  type CollectionActionState,
  choosePackAction,
  createRequestAction,
  editDraftAction,
  emailLinkAction,
  endRequestAction,
  issueRequestAction,
  newLinkAction,
} from './actions';
import { CollectionLinkPanel } from './collection-link-panel';

const INITIAL: CollectionActionState = { ok: true, message: '' };

/** The necessities an agency may give its own items, in plain words (from the shared module). */
export interface NecessityOption {
  readonly value: string;
  readonly label: string;
}

function Hidden({ organizationId, requestId }: { organizationId: string; requestId?: string }) {
  return (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
    </>
  );
}

export function NewRequestForm({
  organizationId,
  countries,
  purposeGroups,
}: {
  readonly organizationId: string;
  readonly countries: readonly { readonly iso2: string; readonly name: string }[];
  readonly purposeGroups: readonly {
    readonly label: string;
    readonly options: readonly { readonly key: string; readonly label: string }[];
  }[];
}) {
  const [state, formAction, pending] = useActionState(createRequestAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const messageId = 'new-collection-request-message';
  return (
    <form ref={form} action={formAction} className="field-list form-narrow">
      <Hidden organizationId={organizationId} />
      <fieldset className="form-section">
        <legend>Where and Why</legend>
        <div className="form-grid">
          <div className="field-row">
            <label className="field-label" htmlFor="collection-destination">
              Destination
            </label>
            <select
              id="collection-destination"
              name="destination"
              required
              className="input"
              defaultValue=""
              {...fieldProblem(state, 'destination', messageId)}
            >
              <option value="" disabled>
                Choose a Country
              </option>
              {countries.map((country) => (
                <option key={country.iso2} value={country.iso2}>
                  {country.name}
                </option>
              ))}
            </select>
            <FieldError result={state} field="destination" />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="collection-purpose">
              Purpose
            </label>
            <select
              id="collection-purpose"
              name="purpose"
              className="input"
              defaultValue=""
              {...fieldProblem(state, 'purpose', messageId, 'collection-purpose-hint')}
            >
              <option value="">Not Sure Yet</option>
              {purposeGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.key} value={option.label}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p id="collection-purpose-hint" className="muted u-fs-085">
              With a purpose, the published official checklist that fits is proposed. Not Sure Yet
              starts your agency's own checklist.
            </p>
            <FieldError result={state} field="purpose" />
          </div>
          <div className="field-row field-wide">
            <label className="field-label" htmlFor="collection-route">
              Specific Route (Optional)
            </label>
            <input
              id="collection-route"
              name="route"
              type="text"
              maxLength={200}
              className="input"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="collection-from">
              Travel from (Optional)
            </label>
            <input id="collection-from" name="travelFrom" type="date" className="input" />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="collection-to">
              Travel to (Optional)
            </label>
            <input id="collection-to" name="travelTo" type="date" className="input" />
          </div>
        </div>
      </fieldset>
      <fieldset className="form-section">
        <legend>What You Already Know (Optional)</legend>
        <div className="form-grid">
          <div className="field-row">
            <label className="field-label" htmlFor="collection-nationality">
              Nationality
            </label>
            <input
              id="collection-nationality"
              name="nationality"
              type="text"
              maxLength={100}
              className="input"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="collection-residence">
              Country of Residence
            </label>
            <input
              id="collection-residence"
              name="residence"
              type="text"
              maxLength={100}
              className="input"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="collection-place">
              Where They Apply
            </label>
            <input
              id="collection-place"
              name="applicationPlace"
              type="text"
              maxLength={100}
              className="input"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="collection-due">
              Due Date
            </label>
            <input
              id="collection-due"
              name="dueAt"
              type="date"
              className="input"
              {...fieldProblem(state, 'dueAt', messageId)}
            />
            <FieldError result={state} field="dueAt" />
          </div>
        </div>
      </fieldset>
      <fieldset className="form-section">
        <legend>Who It Is for (Optional)</legend>
        <p className="muted u-fs-085">
          For your own reference only. Nothing here is shown to anyone who opens the link.
        </p>
        <div className="form-grid">
          <div className="field-row">
            <label className="field-label" htmlFor="collection-name">
              Name
            </label>
            <input
              id="collection-name"
              name="recipientName"
              type="text"
              maxLength={200}
              className="input"
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="collection-email">
              Email
            </label>
            <input
              id="collection-email"
              name="recipientEmail"
              type="email"
              maxLength={320}
              className="input"
            />
          </div>
        </div>
      </fieldset>
      <SubmitButton pending={pending} idle="Create Request" busy="Creating…" />
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

export function AddItemForm({
  organizationId,
  requestId,
  necessities,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly necessities: readonly NecessityOption[];
}) {
  const [state, formAction, pending] = useActionState(editDraftAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const messageId = `add-item-message-${requestId}`;
  return (
    <form ref={form} action={formAction} className="field-list">
      <Hidden organizationId={organizationId} requestId={requestId} />
      <input type="hidden" name="edit" value="add" />
      <div className="form-grid">
        <div className="field-row field-wide">
          <label className="field-label" htmlFor={`add-item-label-${requestId}`}>
            Item Your Agency Needs
          </label>
          <input
            id={`add-item-label-${requestId}`}
            name="label"
            type="text"
            required
            maxLength={160}
            className="input"
            {...fieldProblem(state, 'label', messageId)}
          />
          <FieldError result={state} field="label" />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor={`add-item-necessity-${requestId}`}>
            How Necessary
          </label>
          <select
            id={`add-item-necessity-${requestId}`}
            name="necessity"
            className="input"
            defaultValue="MANDATORY"
          >
            {necessities.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row field-wide">
          <label className="field-label" htmlFor={`add-item-note-${requestId}`}>
            Note to the Person (Optional)
          </label>
          <input
            id={`add-item-note-${requestId}`}
            name="note"
            type="text"
            maxLength={500}
            className="input"
          />
        </div>
      </div>
      <SubmitButton
        pending={pending}
        idle="Add Item"
        busy="Adding…"
        className="btn btn-secondary"
      />
      <FormMessage id={messageId} result={state} />
    </form>
  );
}

/** Move, note, remove and (for the agency's own items) change how necessary one item is. */
export function ItemEditForm({
  organizationId,
  requestId,
  item,
  first,
  last,
  removable,
  necessities,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly item: {
    readonly id: string;
    readonly label: string;
    readonly note: string | null;
    readonly necessity: string;
    readonly agency: boolean;
  };
  readonly first: boolean;
  readonly last: boolean;
  readonly removable: boolean;
  readonly necessities: readonly NecessityOption[];
}) {
  const [state, formAction, pending] = useActionState(editDraftAction, INITIAL);
  const noteId = `item-note-${item.id}`;
  const necessityId = `item-necessity-${item.id}`;
  return (
    <form action={formAction} className="field-list collection-item-edit">
      <Hidden organizationId={organizationId} requestId={requestId} />
      <input type="hidden" name="itemId" value={item.id} />
      <div className="form-grid">
        <div className="field-row field-wide">
          <label className="field-label" htmlFor={noteId}>
            Note: {item.label}
          </label>
          <input
            id={noteId}
            name="note"
            type="text"
            maxLength={500}
            className="input"
            defaultValue={item.note ?? ''}
          />
        </div>
        {item.agency ? (
          <div className="field-row">
            <label className="field-label" htmlFor={necessityId}>
              How Necessary: {item.label}
            </label>
            <select
              id={necessityId}
              name="necessity"
              className="input"
              defaultValue={item.necessity}
            >
              {necessities.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="action-row">
        <SubmitButton
          pending={pending}
          name="edit"
          value="note"
          idle="Save Note"
          busy="Saving…"
          className="btn btn-secondary"
          label={`Save Note: ${item.label}`}
        />
        {item.agency ? (
          <SubmitButton
            pending={pending}
            name="edit"
            value="necessity"
            idle="Save Necessity"
            busy="Saving…"
            className="btn btn-secondary"
            label={`Save Necessity: ${item.label}`}
          />
        ) : null}
        {first ? null : (
          <SubmitButton
            pending={pending}
            name="edit"
            value="up"
            idle="Move Up"
            busy="Moving…"
            className="btn btn-secondary"
            label={`Move Up: ${item.label}`}
          />
        )}
        {last ? null : (
          <SubmitButton
            pending={pending}
            name="edit"
            value="down"
            idle="Move Down"
            busy="Moving…"
            className="btn btn-secondary"
            label={`Move Down: ${item.label}`}
          />
        )}
        {removable ? (
          <SubmitButton
            pending={pending}
            name="edit"
            value="remove"
            idle="Remove"
            busy="Removing…"
            className="btn btn-secondary"
            label={`Remove: ${item.label}`}
          />
        ) : null}
      </div>
      <FormMessage result={state} />
    </form>
  );
}

export function PackChoiceForm({
  organizationId,
  requestId,
  choices,
  current,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly choices: readonly {
    readonly packVersionId: string;
    readonly label: string;
  }[];
  readonly current: string | null;
}) {
  const [state, formAction, pending] = useActionState(choosePackAction, INITIAL);
  return (
    <form action={formAction} className="field-list">
      <Hidden organizationId={organizationId} requestId={requestId} />
      <fieldset className="form-section">
        <legend>Checklist to Follow</legend>
        {choices.map((choice) => (
          <label key={choice.packVersionId} className="check">
            <input
              type="radio"
              name="packVersionId"
              required
              value={choice.packVersionId}
              defaultChecked={current === choice.packVersionId}
            />{' '}
            {choice.label}
          </label>
        ))}
        <label className="check">
          <input
            type="radio"
            name="packVersionId"
            required
            value=""
            defaultChecked={current === null}
          />{' '}
          Your Agency's Own Checklist
        </label>
      </fieldset>
      <SubmitButton
        pending={pending}
        idle="Use This Checklist"
        busy="Applying…"
        className="btn btn-secondary"
      />
      <FormMessage result={state} />
    </form>
  );
}

/** Issue (or reissue) the checklist; the new link is shown once. */
export function IssueRequestForm({
  organizationId,
  requestId,
  reissue,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly reissue: boolean;
}) {
  const [state, formAction, pending] = useActionState(issueRequestAction, INITIAL);
  return (
    <div>
      <form action={formAction}>
        <Hidden organizationId={organizationId} requestId={requestId} />
        <SubmitButton
          pending={pending}
          idle={reissue ? 'Issue a New Revision' : 'Issue Request'}
          busy="Issuing…"
        />
      </form>
      <FormMessage result={state} pending={pending} pendingText="Issuing the checklist…" />
      {state.ok && state.linkUrl ? <CollectionLinkPanel url={state.linkUrl} /> : null}
    </div>
  );
}

export function NewLinkForm({
  organizationId,
  requestId,
}: {
  readonly organizationId: string;
  readonly requestId: string;
}) {
  const [state, formAction, pending] = useActionState(newLinkAction, INITIAL);
  return (
    <div>
      <form action={formAction}>
        <Hidden organizationId={organizationId} requestId={requestId} />
        <SubmitButton
          pending={pending}
          idle="Make a New Link"
          busy="Making…"
          className="btn btn-secondary"
        />
      </form>
      <FormMessage result={state} />
      {state.ok && state.linkUrl ? <CollectionLinkPanel url={state.linkUrl} /> : null}
    </div>
  );
}

export function EmailLinkForm({
  organizationId,
  requestId,
  defaultEmail,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly defaultEmail: string | null;
}) {
  const [state, formAction, pending] = useActionState(emailLinkAction, INITIAL);
  const form = useRef<HTMLFormElement>(null);
  useFocusInvalidField(form, state);
  const messageId = `email-link-message-${requestId}`;
  const inputId = `email-link-${requestId}`;
  return (
    <form ref={form} action={formAction} className="field-list">
      <Hidden organizationId={organizationId} requestId={requestId} />
      <div className="field-row">
        <label className="field-label" htmlFor={inputId}>
          Email Address
        </label>
        <input
          id={inputId}
          name="email"
          type="email"
          required
          maxLength={320}
          className="input"
          defaultValue={defaultEmail ?? ''}
          {...fieldProblem(state, 'email', messageId, `${inputId}-hint`)}
        />
        <p id={`${inputId}-hint`} className="muted u-fs-085">
          The email names your agency only once VisaStack has reviewed it, and never the route, the
          documents or the person.
        </p>
        <FieldError result={state} field="email" />
      </div>
      <SubmitButton
        pending={pending}
        idle="Send by Email"
        busy="Sending…"
        className="btn btn-secondary"
      />
      <FormMessage id={messageId} result={state} pending={pending} pendingText="Sending…" />
    </form>
  );
}

export function EndRequestForm({
  organizationId,
  requestId,
}: {
  readonly organizationId: string;
  readonly requestId: string;
}) {
  const [state, formAction, pending] = useActionState(endRequestAction, INITIAL);
  return (
    <div>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!window.confirm('End this request? Every link to it stops working.')) {
            event.preventDefault();
          }
        }}
      >
        <Hidden organizationId={organizationId} requestId={requestId} />
        <div className="action-row">
          <SubmitButton
            pending={pending}
            name="outcome"
            value="CLOSED"
            idle="Close Request"
            busy="Closing…"
            className="btn btn-secondary"
          />
          <SubmitButton
            pending={pending}
            name="outcome"
            value="REVOKED"
            idle="Revoke Request"
            busy="Revoking…"
            className="btn btn-danger"
          />
        </div>
      </form>
      <FormMessage result={state} />
    </div>
  );
}
