'use client';

import { useActionState, useEffect, useRef } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { type RelationDecisionState, needsDecisionAction } from './needs-decision-actions';

/** One file needing one decision, as the documents page passes it (UMPE P3). */
export type NeedsDecisionItem =
  | {
      readonly kind: 'relation';
      readonly proposalId: string;
      readonly documentId: string;
      readonly title: string;
      readonly relatedDocumentId: string;
      readonly relatedTitle: string;
      readonly relation: 'EXACT_DUPLICATE' | 'CORRECTED_SCAN' | 'NEW_PERIOD' | 'RENEWED';
      readonly labels: { readonly newDocument: string; readonly relatedDocument: string };
    }
  | {
      readonly kind: 'unknown_type' | 'low_confidence';
      readonly documentId: string;
      readonly title: string;
    }
  /** UMPE G1: a kind the AI suggested in the background, waiting for the person. */
  | {
      readonly kind: 'suggested_kind';
      readonly documentId: string;
      readonly title: string;
      readonly suggestedLabel: string;
    }
  /** UMPE G1: found when the file was read. */
  | {
      readonly kind: 'expired_on_arrival' | 'no_readable_text';
      readonly exceptionId: string;
      readonly documentId: string;
      readonly title: string;
    };

/** UMPE G1: a file from a family batch waiting for Which Person? (private to this account). */
export interface HeldFileItem {
  readonly holdId: string;
  /** The file's own name, or null when it gave none. */
  readonly fileName: string | null;
  readonly basis: 'NAME_AND_BIRTH_DATE' | 'CLOSE_MATCHES' | 'NO_MATCH' | 'NOT_READ';
  readonly proposedApplicantId: string | null;
  /** When it was added, already written for people ("3 Nov 2026"). */
  readonly addedOn: string;
}

export interface PersonChoice {
  readonly applicantId: string;
  readonly displayName: string;
}

export interface LinkedCopy {
  readonly documentId: string;
  readonly title: string;
  readonly relatedDocumentId: string;
  readonly relatedTitle: string;
  readonly labels: { readonly newDocument: string; readonly relatedDocument: string };
}

const INITIAL: RelationDecisionState = { ok: true, message: '' };

/** What the suggestion says, in plain words. */
function relationLine(item: Extract<NeedsDecisionItem, { kind: 'relation' }>): string {
  switch (item.relation) {
    case 'EXACT_DUPLICATE':
      return `${item.title} is the same file as ${item.relatedTitle}.`;
    case 'CORRECTED_SCAN':
      return `${item.title} looks like a new copy of ${item.relatedTitle}.`;
    case 'RENEWED':
      return `${item.title} looks like a renewal of ${item.relatedTitle}.`;
    case 'NEW_PERIOD':
      return `${item.title} looks like another period of ${item.relatedTitle}.`;
  }
}

/** What Confirm will do, so nobody has to guess. */
function confirmLine(item: Extract<NeedsDecisionItem, { kind: 'relation' }>): string {
  if (item.relation === 'EXACT_DUPLICATE') {
    return 'Confirm only notes that they are the same. Both files are kept.';
  }
  if (item.relation === 'NEW_PERIOD') {
    return 'Confirm links them as statements for different periods. Both stay in use.';
  }
  return 'Confirm keeps both files and marks the older one as the Earlier Copy.';
}

/** Confirm or Keep Separate for one suggested link between two files. */
export function RelationDecisionForm({
  applicantId,
  proposalId,
  title,
  action,
  pending,
}: {
  readonly applicantId: string;
  readonly proposalId: string;
  /** The new file's name, so each button says which file it is about. */
  readonly title: string;
  /** The list's own action, so its answer outlives this form (the item goes once decided). */
  readonly action: (formData: FormData) => void;
  readonly pending: boolean;
}) {
  return (
    <form action={action} className="umpe-p3-decision-form">
      <input type="hidden" name="intent" value="relation" />
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <div className="umpe-p3-decision-actions">
        <SubmitButton
          pending={pending}
          name="decision"
          value="CONFIRM"
          idle="Confirm"
          busy="Saving"
          label={`Confirm: ${title}`}
          className="btn btn-primary"
        />
        <SubmitButton
          pending={pending}
          name="decision"
          value="KEEP_SEPARATE"
          idle="Keep Separate"
          busy="Saving"
          label={`Keep Separate: ${title}`}
          className="btn btn-secondary"
        />
      </div>
    </form>
  );
}

/** The link to one document's own card, where its kind or details are decided. */
function documentHref(applicantId: string, documentId: string): string {
  return `/app/applicant/${applicantId}/documents?document=${documentId}#wallet-selected-document`;
}

/** Keep As It Is for one finding raised when a file was read (UMPE G1). */
function KeepForm({
  applicantId,
  exceptionId,
  title,
  action,
  pending,
}: {
  readonly applicantId: string;
  readonly exceptionId: string;
  readonly title: string;
  readonly action: (formData: FormData) => void;
  readonly pending: boolean;
}) {
  return (
    <form action={action} className="umpe-p3-decision-form">
      <input type="hidden" name="intent" value="keep" />
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="exceptionId" value={exceptionId} />
      <div className="umpe-p3-decision-actions">
        <SubmitButton
          pending={pending}
          idle="Keep As It Is"
          busy="Saving"
          label={`Keep As It Is: ${title}`}
          className="btn btn-secondary"
        />
      </div>
    </form>
  );
}

/** What we could tell about who a held file belongs to, in plain words. */
function basisLine(file: HeldFileItem, people: readonly PersonChoice[]): string {
  const proposed = people.find((person) => person.applicantId === file.proposedApplicantId);
  if (file.basis === 'NAME_AND_BIRTH_DATE' && proposed) {
    return `The name and date of birth in this file match ${proposed.displayName}. Check before you file it.`;
  }
  if (file.basis === 'CLOSE_MATCHES') {
    return 'This file could belong to more than one of your people, so we did not choose for you.';
  }
  return 'We could not tell who this file belongs to.';
}

/**
 * Which Person? for one held file (UMPE G1): choose a person and File It, or Remove This File.
 * The suggested person, when there is exactly one, is chosen to start with; nothing is filed until
 * the button is pressed.
 */
function WhichPersonForm({
  applicantId,
  file,
  people,
  action,
  pending,
}: {
  readonly applicantId: string;
  readonly file: HeldFileItem;
  readonly people: readonly PersonChoice[];
  readonly action: (formData: FormData) => void;
  readonly pending: boolean;
}) {
  const label = file.fileName ?? `File Added ${file.addedOn}`;
  const groupId = `which-person-${file.holdId}`;
  return (
    <form action={action} className="umpe-g1-person-form">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="holdId" value={file.holdId} />
      <fieldset className="umpe-g1-person-choices" aria-describedby={`${groupId}-basis`}>
        <legend>Which Person Is {label} For?</legend>
        <p className="muted" id={`${groupId}-basis`}>
          {basisLine(file, people)}
        </p>
        {people.map((person) => (
          <label key={person.applicantId} className="umpe-g1-person-choice">
            <input
              type="radio"
              name="personId"
              value={person.applicantId}
              defaultChecked={person.applicantId === file.proposedApplicantId}
            />
            <span>{person.displayName}</span>
          </label>
        ))}
      </fieldset>
      <div className="umpe-p3-decision-actions">
        <SubmitButton
          pending={pending}
          name="intent"
          value="file"
          idle="File It"
          busy="Saving"
          label={`File It: ${label}`}
          className="btn btn-primary"
        />
        <SubmitButton
          pending={pending}
          name="intent"
          value="discard"
          idle="Remove This File"
          busy="Saving"
          label={`Remove This File: ${label}`}
          className="btn btn-secondary"
        />
      </div>
    </form>
  );
}

/**
 * The person's files that need one decision (ledger I07, I11), and the files already linked.
 * Routine files never appear here. The answer to a decision is shown for the whole list, so it
 * stays on screen (and is announced, with focus moved to it) after the decided item goes.
 * Renders nothing when there is nothing to decide, show or report.
 */
export function NeedsDecision({
  applicantId,
  items,
  linked,
  held = [],
  people = [],
}: {
  readonly applicantId: string;
  readonly items: readonly NeedsDecisionItem[];
  readonly linked: readonly LinkedCopy[];
  /** UMPE G1: this account's files waiting for Which Person?. */
  readonly held?: readonly HeldFileItem[];
  /** UMPE G1: the account's own people, to choose from. */
  readonly people?: readonly PersonChoice[];
}) {
  const [state, formAction, pending] = useActionState(needsDecisionAction, INITIAL);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.message) statusRef.current?.focus();
  }, [state]);
  if (items.length === 0 && linked.length === 0 && held.length === 0 && !state.message) {
    return null;
  }
  return (
    <section className="card u-mb-150 umpe-p3-needs-decision" aria-labelledby="needs-decision">
      <p className="card-kicker">Check</p>
      <h2 className="card-title" id="needs-decision">
        Needs One Decision
      </h2>
      <div ref={statusRef} tabIndex={-1} className="umpe-p3-decision-status">
        <FormMessage result={state} />
      </div>
      {held.length > 0 ? (
        <>
          <h3 className="umpe-p3-linked-title">Which Person?</h3>
          <p className="card-body">
            These files were added for several people at once. Each one waits here, seen only by
            you, until you choose who it belongs to.
          </p>
          <ul className="umpe-p3-decision-list">
            {held.map((file) => (
              <li key={file.holdId} className="umpe-p3-decision-item">
                <WhichPersonForm
                  applicantId={applicantId}
                  file={file}
                  people={people}
                  action={formAction}
                  pending={pending}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {items.length > 0 ? (
        <>
          <p className="card-body">
            Most files are sorted on their own. These need one answer from you. Nothing changes
            until you choose.
          </p>
          <ul className="umpe-p3-decision-list">
            {items.map((item) =>
              item.kind === 'relation' ? (
                <li key={item.proposalId} className="umpe-p3-decision-item">
                  <p className="umpe-p3-decision-badges">
                    <span className="badge badge-neutral">{item.labels.newDocument}</span>
                  </p>
                  <p>{relationLine(item)}</p>
                  <p className="muted">{confirmLine(item)}</p>
                  <RelationDecisionForm
                    applicantId={applicantId}
                    proposalId={item.proposalId}
                    title={item.title}
                    action={formAction}
                    pending={pending}
                  />
                </li>
              ) : item.kind === 'expired_on_arrival' || item.kind === 'no_readable_text' ? (
                <li key={item.exceptionId} className="umpe-p3-decision-item">
                  <p>
                    {item.kind === 'expired_on_arrival'
                      ? `${item.title} had already expired on the day it was added.`
                      : `We could not find any readable text in ${item.title}. It may be blank, blurred or turned sideways.`}
                  </p>
                  <p className="muted">
                    {item.kind === 'expired_on_arrival'
                      ? 'Add a newer copy if you have one, or keep this one as it is.'
                      : 'Add a clearer copy if you can, or keep this one as it is and add its details yourself.'}
                  </p>
                  <div className="umpe-p3-decision-actions">
                    <a
                      className="btn btn-secondary"
                      href={documentHref(applicantId, item.documentId)}
                      aria-label={`Open Document: ${item.title}`}
                    >
                      Open Document
                    </a>
                  </div>
                  <KeepForm
                    applicantId={applicantId}
                    exceptionId={item.exceptionId}
                    title={item.title}
                    action={formAction}
                    pending={pending}
                  />
                </li>
              ) : (
                <li key={item.documentId} className="umpe-p3-decision-item">
                  <p>
                    {item.kind === 'suggested_kind'
                      ? `We think ${item.title} is a ${item.suggestedLabel}. Nothing is saved until you accept it.`
                      : item.kind === 'unknown_type'
                        ? `We could not tell what ${item.title} is.`
                        : `We are not sure what ${item.title} is.`}
                  </p>
                  <a
                    className="btn btn-secondary"
                    href={documentHref(applicantId, item.documentId)}
                    aria-label={`${item.kind === 'suggested_kind' ? 'Review Suggestion' : 'Choose What It Is'}: ${item.title}`}
                  >
                    {item.kind === 'suggested_kind' ? 'Review Suggestion' : 'Choose What It Is'}
                  </a>
                </li>
              ),
            )}
          </ul>
        </>
      ) : held.length === 0 ? (
        <p className="card-body">Nothing needs a decision right now.</p>
      ) : null}
      {linked.length > 0 ? (
        <>
          <h3 className="umpe-p3-linked-title">Linked Copies</h3>
          <ul className="umpe-p3-linked-list">
            {linked.map((link) => (
              <li key={`${link.documentId}-${link.relatedDocumentId}`}>
                {link.title}: <span className="badge badge-neutral">{link.labels.newDocument}</span>
                {' · '}
                {link.relatedTitle}:{' '}
                <span className="badge badge-neutral">{link.labels.relatedDocument}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
