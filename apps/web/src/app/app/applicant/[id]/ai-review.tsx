'use client';

import { useActionState, useState } from 'react';
import { profileField } from '../../../../lib/profile-fields';
import {
  type ActionState,
  decideProposalAction,
  runAiExtractionAction,
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
        <button
          type="submit"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
          disabled={pending}
        >
          {pending ? 'Running AI extraction…' : 'Run AI extraction'}
        </button>
      </form>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
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
        <button
          type="submit"
          className="btn btn-secondary"
          style={{ padding: '0.3rem 0.9rem', fontSize: '0.8rem' }}
          disabled={pending}
        >
          {pending ? 'Running OCR…' : 'Run OCR'}
        </button>
      </form>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
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
}: {
  readonly text: string;
  readonly reviewIssues: readonly string[];
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
        {proposal.rationale ? ` — ${proposal.rationale}` : ''}
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
              value={editedValue}
              onChange={(e) => setEditedValue(e.target.value)}
              className="input"
              style={{ flex: '1 1 260px', fontSize: '0.85rem', padding: '0.4rem 0.65rem' }}
            />
            <button
              type="submit"
              name="proposalAction"
              value="approve"
              className="btn btn-primary"
              style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}
              disabled={pending}
            >
              {pending ? 'Saving…' : 'Approve'}
            </button>
          </>
        ) : (
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {proposal.value ?? '(no value)'}
          </span>
        )}
        <button
          type="submit"
          name="proposalAction"
          value="reject"
          className="btn btn-secondary"
          style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}
          disabled={pending}
        >
          Reject
        </button>
      </form>
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
