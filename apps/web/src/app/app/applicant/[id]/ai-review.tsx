'use client';

import type { ReadingSource } from '@visastack/services';
import { useActionState, useCallback, useId, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { StatusBadge } from '../../../../components/ui';
import { humanizeFieldKey } from '../../../../lib/field-key-label';
import { documentTypeLabel } from '../../../../lib/labels';
import { profileField } from '../../../../lib/profile-fields';
import {
  type ActionState,
  acceptClearDetailsAction,
  decideClassificationProposalAction,
  decideInconsistencyFlagAction,
  decideProposalAction,
  readAgainAction,
  runClassificationAction,
  runInconsistencyCheckAction,
} from './actions';
import { ReadingSourceNote } from './reading-status';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * Read a file again (S6, ADR 0019): the retry for a reading that found nothing, or found less than
 * was there. It does what the automatic reading does, on request: read the picture first when the
 * file has no text, then read details from the text. The person asked for it, so it works for
 * kinds of document the automatic reading leaves alone.
 */
export function ReadAgainButton({
  applicantId,
  documentVersionId,
}: {
  readonly applicantId: string;
  readonly documentVersionId: string;
}) {
  const [state, formAction, pending] = useActionState(readAgainAction, INITIAL);

  return (
    <div className="read-again">
      <form action={formAction}>
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="documentVersionId" value={documentVersionId} />
        <SubmitButton
          pending={pending}
          idle="Read Again"
          busy="Reading…"
          className="btn btn-secondary"
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

/** Directive §9's own named review signals, given short human-readable labels. */
const REVIEW_ISSUE_LABELS: Record<string, string> = {
  low_quality: 'Low Image Quality',
  ambiguous_date: 'Ambiguous Date',
  unsupported_script: 'Unsupported Script',
  missing_text: 'No Legible Text Found',
};

/**
 * Directive §9: "show low quality; ambiguous date; unsupported script;
 * missing text as review issues" - a plain, read-only display of the most
 * recent successful OCR run for one document. Manual entry from the
 * extracted text into the profile still goes through the normal Master
 * Profile fields; this view does not attempt to auto-map OCR'd text into
 * field proposals (that would mean re-running text extraction over it via
 * runExtraction, a separate, later action, not this one).
 */
export function OcrResultView({
  text,
  reviewIssues,
  usedFallback,
}: {
  readonly text: string;
  readonly reviewIssues: readonly string[];
  /** Part 8 §13 ("visible in UI"): true when this run's own `triggeredByRunId` is set -- it exists only because an earlier attempt against the primary provider recoverably failed (timeout/rate-limited) and this run is the fallback that actually succeeded. */
  readonly usedFallback?: boolean;
}) {
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
      {usedFallback ? (
        <p style={{ marginBottom: '0.4rem' }}>
          <span
            className="badge badge-neutral"
            title="The first reader timed out or was too busy, so a backup reader was used. Please check the result."
          >
            Fallback Provider Used
          </span>
        </p>
      ) : null}
      {reviewIssues.length > 0 ? (
        <p style={{ marginBottom: '0.4rem' }}>
          {reviewIssues.map((issue) => (
            <span key={issue} className="badge badge-warning" style={{ marginRight: '0.35rem' }}>
              {REVIEW_ISSUE_LABELS[issue] ?? issue}
            </span>
          ))}
        </p>
      ) : null}
      {text ? (
        <p
          className="muted"
          style={{
            fontSize: 'var(--text-small)',
            whiteSpace: 'pre-wrap',
            maxHeight: '10rem',
            overflowY: 'auto',
          }}
        >
          {text}
        </p>
      ) : (
        <p className="muted u-fs-085">No legible text was found.</p>
      )}
    </div>
  );
}

export interface AiEvidenceViewModel {
  readonly snippet: string;
  /** null = never checked (predates AI-04's verification); true/false = a real, computed answer. */
  readonly verified: boolean | null;
}

export interface AiProposalViewModel {
  readonly id: string;
  readonly type: string;
  readonly fieldKey: string | null;
  /** The plain name of the field, resolved on the server so added fields are named too. */
  readonly fieldLabel?: string;
  readonly value: string | null;
  /** 0-100. */
  readonly confidence: number;
  readonly rationale: string | null;
  readonly evidence: readonly AiEvidenceViewModel[];
  /** Confident, and every quoted phrase was found word for word in the document (decided on the server). */
  readonly clear?: boolean;
  /** An ID number, income, health detail and the like: always decided one at a time. */
  readonly sensitive?: boolean;
  /**
   * What the profile already holds for this detail when it differs from the reading: the value,
   * or null when a value exists but is protected and not shown here.
   */
  readonly difference?: { readonly current: string | null };
  /** A detail that never changes over time (a date of birth): "it changed" is not offered. */
  readonly fixed?: boolean;
  /** Part of a repeating record (one address among several): always decided one at a time. */
  readonly repeating?: boolean;
  /** Where the reading came from, decided on the server from the records. */
  readonly source?: ReadingSource;
}

/** A reading still waiting for the person: accept, change, settle a difference, or skip. */
export function AiProposalReview({
  applicantId,
  proposal,
  canApprove,
  onEditedChange,
  onResult,
  locked = false,
}: {
  readonly applicantId: string;
  readonly proposal: AiProposalViewModel;
  /** Accepting all clear details is running: this card's buttons refuse clicks until it finishes (focus stays put). */
  readonly locked?: boolean;
  /** Tells the list when the value was changed, so it is no longer accepted in bulk as read. */
  readonly onEditedChange?: (id: string, edited: boolean) => void;
  /** Hands the outcome to the list, which stays on screen after this card is gone. */
  readonly onResult?: (result: ActionState) => void;
  /**
   * Approving writes to the Master Profile, which the service layer refuses without
   * CORE_PROCESSING consent; this keeps the screen honest about that. Skipping never changes the
   * profile, so it stays available.
   */
  readonly canApprove: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await decideProposalAction(previous, formData);
      // A success removes this card; the list keeps the message. A refusal stays on the card.
      if (result.ok) onResult?.(result);
      return result;
    },
    INITIAL,
  );
  const [editedValue, setEditedValue] = useState(proposal.value ?? '');
  const [choice, setChoice] = useState('');
  const headingId = useId();
  const valueId = useId();
  const dateId = useId();
  const mappable = proposal.type !== 'UNMAPPED' && Boolean(proposal.fieldKey);
  const label = mappable
    ? (proposal.fieldLabel ??
      profileField(proposal.fieldKey as string)?.label ??
      humanizeFieldKey(proposal.fieldKey as string))
    : 'Detail We Could Not Place';
  const quote = proposal.evidence[0];
  const unverified = quote?.verified === false;
  const clear = proposal.clear === true && !unverified;
  const difference = canApprove && mappable ? proposal.difference : undefined;

  return (
    <article
      className="finding-card"
      data-clarity={clear ? 'clear' : 'check'}
      aria-labelledby={headingId}
    >
      <header className="finding-card-head">
        <h4 id={headingId}>{label}</h4>
        <StatusBadge tone={clear ? 'success' : 'warning'}>
          {clear ? 'Clear' : 'Please Check'}
        </StatusBadge>
        {proposal.sensitive ? <StatusBadge tone="neutral">Sensitive</StatusBadge> : null}
      </header>
      {quote ? (
        <p className="finding-source">
          Found as <q>{quote.snippet}</q>
        </p>
      ) : null}
      {proposal.source ? (
        <ReadingSourceNote
          source={proposal.source}
          detail={proposal.source === 'machine_readable' ? proposal.rationale : null}
        />
      ) : null}
      {unverified ? (
        <p className="muted u-fs-085">
          We could not find these exact words in the document. Look at the document before you
          accept.
        </p>
      ) : null}
      {!mappable ? (
        <p className="muted u-fs-085">
          We found {proposal.value ? <q>{proposal.value}</q> : 'this'}, but it does not match a
          detail in your profile, so it cannot be saved.
        </p>
      ) : null}
      {mappable && !canApprove ? (
        <p className="muted u-fs-085">
          Found: <q>{proposal.value ?? ''}</q>. Turn on processing on Home to save details to your
          profile.
        </p>
      ) : null}
      <form action={formAction} className="finding-form">
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="proposalId" value={proposal.id} />
        {mappable && canApprove ? (
          <div className="finding-value">
            <label className="field-label" htmlFor={valueId}>
              Value to Save
            </label>
            <input
              id={valueId}
              type="text"
              name="correctedValue"
              className="input"
              value={editedValue}
              onChange={(event) => {
                setEditedValue(event.target.value);
                onEditedChange?.(proposal.id, event.target.value !== (proposal.value ?? ''));
              }}
            />
            <small className="muted">Change it if it is not right before you accept.</small>
          </div>
        ) : null}
        {difference ? (
          <fieldset className="finding-difference">
            <legend>
              {difference.current === null ? (
                'Your profile already has a different value for this, hidden here to keep it private. Which is right?'
              ) : (
                <>
                  Your profile has <q>{difference.current}</q>. Which is right?
                </>
              )}
            </legend>
            <label>
              <input
                type="radio"
                name="resolution"
                value="use_document"
                required
                checked={choice === 'use_document'}
                onChange={() => setChoice('use_document')}
              />
              Use This Document&rsquo;s Value
            </label>
            {proposal.fixed ? null : (
              <label>
                <input
                  type="radio"
                  name="resolution"
                  value="changed"
                  checked={choice === 'changed'}
                  onChange={() => setChoice('changed')}
                />
                Both Are Right, It Changed
              </label>
            )}
            {choice === 'changed' && !proposal.fixed ? (
              <div className="finding-value">
                <label className="field-label" htmlFor={dateId}>
                  Date It Changed
                </label>
                <input
                  id={dateId}
                  type="date"
                  name="effectiveFrom"
                  className="input"
                  max={new Date().toISOString().slice(0, 10)}
                  required
                />
              </div>
            ) : null}
            <label>
              <input
                type="radio"
                name="resolution"
                value="keep"
                checked={choice === 'keep'}
                onChange={() => setChoice('keep')}
              />
              Keep My Current Value
            </label>
          </fieldset>
        ) : null}
        {mappable && canApprove ? (
          <SubmitButton
            pending={pending || locked}
            idle={difference ? 'Save My Choice' : 'Accept'}
            busy={pending ? 'Saving…' : difference ? 'Save My Choice' : 'Accept'}
            className="btn btn-primary"
            name="proposalAction"
            value="approve"
            label={`${difference ? 'Save My Choice' : 'Accept'}: ${label}`}
          />
        ) : null}
      </form>
      {/* Skipping has its own form, so a choice the main form requires never blocks it. */}
      <form action={formAction} className="finding-skip">
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="proposalId" value={proposal.id} />
        <SubmitButton
          pending={pending || locked}
          idle="Skip"
          busy={pending ? 'Skipping…' : 'Skip'}
          className="btn btn-secondary"
          name="proposalAction"
          value="reject"
          label={`Skip: ${label}`}
        />
      </form>
      <FormMessage result={state.ok ? INITIAL : state} />
    </article>
  );
}

/**
 * Everything read from one document, in the order a person should look at it: differences with
 * the profile first, then readings to check, then clear ones. Nothing is saved until accepted.
 */
export function DocumentFindings({
  applicantId,
  proposals,
  canApprove,
}: {
  readonly applicantId: string;
  readonly proposals: readonly AiProposalViewModel[];
  readonly canApprove: boolean;
}) {
  // The latest outcome, kept here: a card disappears once decided, and its message with it.
  const [lastResult, setLastResult] = useState<ActionState>(INITIAL);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await acceptClearDetailsAction(previous, formData);
      setLastResult(result);
      return result;
    },
    INITIAL,
  );
  const markEdited = useCallback((id: string, isEdited: boolean) => {
    setEdited((previous) => {
      if (previous.has(id) === isEdited) return previous;
      const next = new Set(previous);
      if (isEdited) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  if (proposals.length === 0) {
    return lastResult === INITIAL ? null : (
      <div className="document-findings">
        <FormMessage result={lastResult} />
      </div>
    );
  }
  const rank = (proposal: AiProposalViewModel) =>
    proposal.difference ? 0 : proposal.clear ? 2 : 1;
  const ordered = [...proposals].sort((a, b) => rank(a) - rank(b));
  const clearIds = proposals
    .filter(
      (proposal) =>
        proposal.clear &&
        !proposal.sensitive &&
        !proposal.difference &&
        !proposal.repeating &&
        !edited.has(proposal.id),
    )
    .map((proposal) => proposal.id);
  const count = proposals.length;
  return (
    // Not a landmark: several documents on one page each have one, all with this heading.
    <div className="document-findings">
      <h3>Check What We Found</h3>
      <p className="muted">
        We read this document and found {count === 1 ? 'one detail' : `${count} details`}. Nothing
        is saved to your profile until you accept it.
      </p>
      {canApprove && clearIds.length >= 2 ? (
        <form action={formAction} className="document-findings-bulk">
          <input type="hidden" name="applicantId" value={applicantId} />
          {clearIds.map((id) => (
            <input key={id} type="hidden" name="proposalId" value={id} />
          ))}
          <SubmitButton
            pending={pending}
            idle={`Accept ${clearIds.length} Clear Details`}
            busy="Saving…"
            className="btn btn-primary"
          />
          <small className="muted">
            Sensitive details, anything you changed, and anything that differs from your profile
            stay here for you to check one by one.
          </small>
        </form>
      ) : null}
      <FormMessage result={lastResult} />
      {ordered.map((proposal) => (
        <AiProposalReview
          key={proposal.id}
          applicantId={applicantId}
          proposal={proposal}
          canApprove={canApprove}
          onEditedChange={markEdited}
          onResult={setLastResult}
          locked={pending}
        />
      ))}
    </div>
  );
}

/** Manually trigger AI document-type classification (Part 8 AI-01 item 2) -- shown only when the deterministic classifier itself left a genuine gap. */
export function RunClassificationButton({
  applicantId,
  documentVersionId,
}: {
  readonly applicantId: string;
  readonly documentVersionId: string;
}) {
  const [state, formAction, pending] = useActionState(runClassificationAction, INITIAL);

  return (
    <div style={{ marginTop: '0.35rem' }}>
      <form action={formAction} style={{ display: 'inline' }}>
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="documentVersionId" value={documentVersionId} />
        <SubmitButton
          pending={pending}
          idle="Suggest what kind of document this is"
          busy="Looking at the document…"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.9rem', fontSize: 'var(--text-small)' }}
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

/** Manually trigger an AI possible-inconsistency check (Part 8 AI-01 item 4) -- compares this document against the applicant's own already-confirmed profile facts. */
export function RunInconsistencyCheckButton({
  applicantId,
  documentVersionId,
}: {
  readonly applicantId: string;
  readonly documentVersionId: string;
}) {
  const [state, formAction, pending] = useActionState(runInconsistencyCheckAction, INITIAL);

  return (
    <div style={{ marginTop: '0.35rem' }}>
      <form action={formAction} style={{ display: 'inline' }}>
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="documentVersionId" value={documentVersionId} />
        <SubmitButton
          pending={pending}
          idle="Look for Mismatches in My Details"
          busy="Looking for mismatches…"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.9rem', fontSize: 'var(--text-small)' }}
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

export interface InconsistencyFlagViewModel {
  readonly id: string;
  readonly description: string;
  /** 0-100. */
  readonly confidence: number;
  readonly rationale: string | null;
}

/**
 * A PENDING AI possible-inconsistency flag awaiting a human decision (Part 8
 * AI-01 item 4). Purely advisory: neither acknowledging nor dismissing ever
 * writes to the Master Profile or the document, so unlike `AiProposalReview`/
 * `DocumentTypeProposalReview` there is no `canApprove`/CORE_PROCESSING gate
 * here -- the flag never implies which side (document or profile) is wrong,
 * only that a human should look.
 */
export function InconsistencyFlagReview({
  applicantId,
  flag,
}: {
  readonly applicantId: string;
  readonly flag: InconsistencyFlagViewModel;
}) {
  const [state, formAction, pending] = useActionState(decideInconsistencyFlagAction, INITIAL);

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
      <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.4rem' }}>
        <span className="badge badge-warning">
          Possible inconsistency ({flag.confidence}% confidence)
        </span>{' '}
        {flag.description}
        {flag.rationale ? ` - ${flag.rationale}` : ''}
      </p>
      <form
        action={formAction}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="flagId" value={flag.id} />
        <SubmitButton
          pending={pending}
          idle="Acknowledge"
          busy="Saving…"
          className="btn btn-primary"
          style={{ padding: '0.35rem 0.9rem', fontSize: 'var(--text-small)' }}
          name="flagAction"
          value="acknowledge"
        />
        <SubmitButton
          pending={pending}
          idle="Dismiss"
          busy="Dismiss"
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.9rem', fontSize: 'var(--text-small)' }}
          name="flagAction"
          value="dismiss"
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

export interface DocumentTypeProposalViewModel {
  readonly id: string;
  readonly suggestedType: string;
  readonly confidence: number;
  readonly rationale: string | null;
}

/**
 * A PENDING AI document-type suggestion awaiting a human decision (Part 8
 * AI-01 item 2). No edit-before-approve field, unlike `AiProposalReview` --
 * a document type is a single suggested value, not a free-text field value,
 * so the only choices are approve-as-suggested or reject. Approving reuses
 * the exact same downstream naming-proposal trigger the deterministic path
 * already has (`approveDocumentTypeProposal`).
 */
export function DocumentTypeProposalReview({
  applicantId,
  proposal,
  canApprove,
}: {
  readonly applicantId: string;
  readonly proposal: DocumentTypeProposalViewModel;
  /** Same CORE_PROCESSING gate `AiProposalReview`'s own `canApprove` documents -- approving writes `documents.docType` and a naming proposal. */
  readonly canApprove: boolean;
}) {
  const [state, formAction, pending] = useActionState(decideClassificationProposalAction, INITIAL);

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
      <p className="muted" style={{ fontSize: 'var(--text-caption)', marginBottom: '0.4rem' }}>
        <span className="badge badge-neutral">
          AI thinks this is a {documentTypeLabel(proposal.suggestedType).toLowerCase()} (
          {proposal.confidence}% sure). Please check it.
        </span>
        {proposal.rationale ? ` - ${proposal.rationale}` : ''}
      </p>
      <form
        action={formAction}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="proposalId" value={proposal.id} />
        {canApprove ? (
          <SubmitButton
            pending={pending}
            idle="Approve"
            busy="Saving…"
            className="btn btn-primary"
            style={{ padding: '0.35rem 0.9rem', fontSize: 'var(--text-small)' }}
            name="proposalAction"
            value="approve"
          />
        ) : null}
        <SubmitButton
          pending={pending}
          idle="Reject"
          busy="Reject"
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.9rem', fontSize: 'var(--text-small)' }}
          name="proposalAction"
          value="reject"
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}
