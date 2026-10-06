'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import {
  type ActionState,
  createContributorRequestAction,
  revokeContributorRequestAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'Pending', tone: 'badge-warning' },
  SUBMITTED: { label: 'Submitted', tone: 'badge-success' },
  REVOKED: { label: 'Revoked', tone: 'badge-neutral' },
};

export interface ContributorRequestRow {
  readonly id: string;
  readonly contributorEmail: string;
  readonly docType: string;
  readonly purpose: string;
  readonly status: string;
  readonly expiresAt: string;
}

/** CAS-08: ask a named third party (a sponsor, a family member) for exactly one piece of evidence, without giving them any other access to this case. */
export function ContributorRequestsPanel({
  missionId,
  requests,
}: {
  readonly missionId: string;
  readonly requests: readonly ContributorRequestRow[];
}) {
  const [state, formAction, pending] = useActionState(createContributorRequestAction, INITIAL);

  return (
    <>
      {requests.length > 0 ? (
        <div className="rows" style={{ marginBottom: '1.25rem' }}>
          {requests.map((r) => {
            const badge = STATUS_LABELS[r.status] ?? { label: r.status, tone: 'badge-neutral' };
            return (
              <div
                className="row"
                key={r.id}
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <span className="row-key">
                    {r.docType} · {r.contributorEmail}
                  </span>
                  <span className={`badge ${badge.tone}`}>{badge.label}</span>
                </div>
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  {r.purpose}
                  {r.status === 'PENDING'
                    ? ` · expires ${new Date(r.expiresAt).toLocaleDateString()}`
                    : ''}
                </span>
                {r.status === 'PENDING' ? (
                  <RevokeButton missionId={missionId} requestId={r.id} />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <form action={formAction} className="field-list">
        <input type="hidden" name="missionId" value={missionId} />
        <div className="field-row">
          <label className="field-label" htmlFor="contributorEmail">
            Contributor email
          </label>
          <input
            id="contributorEmail"
            name="contributorEmail"
            type="email"
            required
            className="input"
            placeholder="sponsor@example.com"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="docType">
            What's needed (exactly one document)
          </label>
          <input
            id="docType"
            name="docType"
            type="text"
            required
            className="input"
            placeholder="e.g. Sponsor bank statement"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="purpose">
            Why (the contributor will see this)
          </label>
          <input
            id="purpose"
            name="purpose"
            type="text"
            required
            className="input"
            placeholder="e.g. To support the financial sponsorship section of this case"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="message">
            Message (optional)
          </label>
          <input id="message" name="message" type="text" className="input" />
        </div>
        <div>
          <SubmitButton
            pending={pending}
            idle="Ask for this"
            busy="Creating…"
            className="btn btn-secondary"
          />
          <FormMessage result={state} style={{ wordBreak: 'break-all' }} />
        </div>
      </form>
    </>
  );
}

function RevokeButton({
  missionId,
  requestId,
}: {
  readonly missionId: string;
  readonly requestId: string;
}) {
  const [state, formAction, pending] = useActionState(revokeContributorRequestAction, INITIAL);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm('Revoke this request? The link will stop working immediately.')) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="missionId" value={missionId} />
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton
        pending={pending}
        idle="Revoke"
        busy="Revoking…"
        className="btn btn-danger"
        style={{ alignSelf: 'flex-start' }}
      />
      {state.message && !state.ok ? (
        <p className="field-msg field-msg-err">{state.message}</p>
      ) : null}
    </form>
  );
}
