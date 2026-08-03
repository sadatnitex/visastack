'use client';

import { useActionState, useState } from 'react';
import { profileField } from '../../../../lib/profile-fields';
import { type ActionState, decideProposalAction, runAiExtractionAction } from './actions';

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

export interface AiProposalViewModel {
  readonly id: string;
  readonly type: string;
  readonly fieldKey: string | null;
  readonly value: string | null;
  /** 0-100. */
  readonly confidence: number;
  readonly rationale: string | null;
  readonly evidenceSnippets: readonly string[];
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
      {proposal.evidenceSnippets.length > 0 ? (
        <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.4rem' }}>
          Evidence: <q>{proposal.evidenceSnippets[0]}</q>
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
