'use client';

import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { documentTypeLabel } from '../../../../lib/labels';
import { profileField } from '../../../../lib/profile-fields';
import {
  type ActionState,
  decideClassificationProposalAction,
  decideInconsistencyFlagAction,
  decideProposalAction,
  runAiExtractionAction,
  runClassificationAction,
  runInconsistencyCheckAction,
  runOcrAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** Manually trigger AI extraction for one document (a pilot-budgeted, human-initiated spend). */
export function RunAiExtractionButton({
  applicantId,
  documentVersionId,
}: {
  readonly applicantId: string;
  readonly documentVersionId: string;
}) {
  const [state, formAction, pending] = useActionState(runAiExtractionAction, INITIAL);

  return (
    <div style={{ marginTop: '0.35rem' }}>
      <form action={formAction} style={{ display: 'inline' }}>
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="documentVersionId" value={documentVersionId} />
        <SubmitButton
          pending={pending}
          idle="Read details from this document"
          busy="Reading details…"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

/** Directive §9's own named review signals, given short human-readable labels. */
const REVIEW_ISSUE_LABELS: Record<string, string> = {
  low_quality: 'Low image quality',
  ambiguous_date: 'Ambiguous date',
  unsupported_script: 'Unsupported script',
  missing_text: 'No legible text found',
};

/** Manually trigger AI OCR for one document (image/scanned PDF) - a separate, larger disclosure than AI extraction, so its own explicit action. */
export function RunOcrButton({
  applicantId,
  documentVersionId,
}: {
  readonly applicantId: string;
  readonly documentVersionId: string;
}) {
  const [state, formAction, pending] = useActionState(runOcrAction, INITIAL);

  return (
    <div style={{ marginTop: '0.35rem' }}>
      <form action={formAction} style={{ display: 'inline' }}>
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="documentVersionId" value={documentVersionId} />
        <SubmitButton
          pending={pending}
          idle="Read text from this scan"
          busy="Reading text…"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}

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
            Fallback provider used
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
            fontSize: '0.8rem',
            whiteSpace: 'pre-wrap',
            maxHeight: '10rem',
            overflowY: 'auto',
          }}
        >
          {text}
        </p>
      ) : (
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          No legible text was found.
        </p>
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
  readonly value: string | null;
  /** 0-100. */
  readonly confidence: number;
  readonly rationale: string | null;
  readonly evidence: readonly AiEvidenceViewModel[];
}

/** A single PENDING AI field proposal awaiting an owner decision. */
export function AiProposalReview({
  applicantId,
  proposal,
  canApprove,
}: {
  readonly applicantId: string;
  readonly proposal: AiProposalViewModel;
  /**
   * Approving writes to the Master Profile (`approveProposal` →
   * `editFact`), which the service layer already refuses without CORE_PROCESSING
   * consent — this prop keeps the UI honest about that rather than showing an
   * editable value and an Approve button that would just error (Codex
   * review, PR #65). Rejecting never mutates the profile, so it stays
   * available regardless.
   */
  readonly canApprove: boolean;
}) {
  const [state, formAction, pending] = useActionState(decideProposalAction, INITIAL);
  const [editedValue, setEditedValue] = useState(proposal.value ?? '');
  const mappable = canApprove && proposal.type !== 'UNMAPPED' && Boolean(proposal.fieldKey);
  const label = proposal.fieldKey
    ? (profileField(proposal.fieldKey)?.label ?? proposal.fieldKey)
    : 'Unmapped (no matching field)';

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
      <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.4rem' }}>
        <span className="badge badge-neutral">
          {label} ({proposal.confidence}% confidence)
        </span>
        {proposal.rationale ? ` - ${proposal.rationale}` : ''}
      </p>
      {proposal.evidence.length > 0 ? (
        <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.4rem' }}>
          Evidence: <q>{proposal.evidence[0]?.snippet}</q>
          {proposal.evidence[0]?.verified === false ? (
            <span
              className="badge badge-warning"
              style={{ marginLeft: '0.4rem' }}
              title="This exact quote could not be confirmed in the source document text."
            >
              Unverified quote
            </span>
          ) : null}
        </p>
      ) : null}
      <form
        action={formAction}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="proposalId" value={proposal.id} />
        {mappable ? (
          <>
            <input
              type="text"
              name="correctedValue"
              aria-label="Value to save, edit it if it is not right"
              value={editedValue}
              onChange={(e) => setEditedValue(e.target.value)}
              className="input"
              style={{ flex: '1 1 260px', fontSize: '0.85rem', padding: '0.4rem 0.65rem' }}
            />
            <SubmitButton
              pending={pending}
              idle="Approve"
              busy="Saving…"
              className="btn btn-primary"
              style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}
              name="proposalAction"
              value="approve"
            />
          </>
        ) : (
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {proposal.value ?? '(no value)'}
          </span>
        )}
        <SubmitButton
          pending={pending}
          idle="Reject"
          busy="Reject"
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}
          name="proposalAction"
          value="reject"
        />
      </form>
      <FormMessage result={state} />
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
          style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
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
          idle="Look for mismatches in my details"
          busy="Looking for mismatches…"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
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
      <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.4rem' }}>
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
          style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}
          name="flagAction"
          value="acknowledge"
        />
        <SubmitButton
          pending={pending}
          idle="Dismiss"
          busy="Dismiss"
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}
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
      <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.4rem' }}>
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
            style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}
            name="proposalAction"
            value="approve"
          />
        ) : null}
        <SubmitButton
          pending={pending}
          idle="Reject"
          busy="Reject"
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}
          name="proposalAction"
          value="reject"
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}
