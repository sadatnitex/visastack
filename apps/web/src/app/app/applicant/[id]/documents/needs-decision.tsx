'use client';

import { useActionState, useEffect, useRef } from 'react';
import { SubmitButton } from '../../../../../components/form-feedback';
import { type RelationDecisionState, decideRelationAction } from './needs-decision-actions';

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
    };

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
}: {
  readonly applicantId: string;
  readonly items: readonly NeedsDecisionItem[];
  readonly linked: readonly LinkedCopy[];
}) {
  const [state, formAction, pending] = useActionState(decideRelationAction, INITIAL);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.message) statusRef.current?.focus();
  }, [state]);
  if (items.length === 0 && linked.length === 0 && !state.message) return null;
  return (
    <section className="card u-mb-150 umpe-p3-needs-decision" aria-labelledby="needs-decision">
      <p className="card-kicker">Check</p>
      <h2 className="card-title" id="needs-decision">
        Needs One Decision
      </h2>
      <div ref={statusRef} tabIndex={-1} className="umpe-p3-decision-status">
        {state.message ? (
          state.ok ? (
            <output className="umpe-p3-decision-note" aria-live="polite">
              {state.message}
            </output>
          ) : (
            <p className="umpe-p3-decision-note" role="alert">
              {state.message}
            </p>
          )
        ) : null}
      </div>
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
              ) : (
                <li key={item.documentId} className="umpe-p3-decision-item">
                  <p>
                    {item.kind === 'unknown_type'
                      ? `We could not tell what ${item.title} is.`
                      : `We are not sure what ${item.title} is.`}
                  </p>
                  <a
                    className="btn btn-secondary"
                    href={`/app/applicant/${applicantId}/documents?document=${item.documentId}#wallet-selected-document`}
                    aria-label={`Choose What It Is: ${item.title}`}
                  >
                    Choose What It Is
                  </a>
                </li>
              ),
            )}
          </ul>
        </>
      ) : (
        <p className="card-body">Nothing needs a decision right now.</p>
      )}
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
