'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../components/form-feedback';
import { type ActionState, cancelDeletionAction, requestDeletionAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

interface DeletionImpactProps {
  readonly applicants: ReadonlyArray<{ readonly id: string; readonly displayName: string }>;
  readonly missionCount: number;
  readonly documentCount: number;
  readonly activePlatformRoleCount: number;
  readonly authoredMissionNoteCount: number;
}

interface AccountLegalHoldProps {
  readonly id: string;
  readonly applicantDisplayName: string;
  readonly reason: string;
  /** ISO date the hold was placed. */
  readonly placedAt: string;
  /** ISO date the hold is next due for compliance review, or null if none was set. */
  readonly reviewAt: string | null;
  /** Directive Part 7 §13 "who can access": every account/organization with genuinely current access right now. */
  readonly accessibleTo: readonly string[];
  /** Directive Part 7 §13 "exact scope": what the hold actually reaches. */
  readonly scope:
    | { readonly kind: 'applicant' }
    | { readonly kind: 'mission'; readonly missionTitle: string }
    | { readonly kind: 'document'; readonly documentName: string };
}

function scopeLabel(scope: AccountLegalHoldProps['scope']): string {
  switch (scope.kind) {
    case 'mission':
      return `case "${scope.missionTitle}" only`;
    case 'document':
      return `document "${scope.documentName}" only`;
    default:
      return 'this whole profile';
  }
}

interface DeletionPanelProps {
  /** ISO date the pending deletion is scheduled for, or null if none pending. */
  readonly scheduledFor: string | null;
  /** What deletion actually touches for this account (PRV-03, Part 7 §12 step 3). */
  readonly impact: DeletionImpactProps;
  /** Every currently active hold across this account's applicants, real detail, not a generic sentence (step 4). */
  readonly holds: readonly AccountLegalHoldProps[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function DeletionPanel({ scheduledFor, impact, holds }: DeletionPanelProps) {
  const [reqState, requestAction, reqPending] = useActionState(requestDeletionAction, INITIAL);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelDeletionAction, INITIAL);

  if (scheduledFor) {
    const when = formatDate(scheduledFor);
    return (
      <div>
        <div className="notice notice-warn u-mb-100">
          <strong>Deletion pending.</strong> Your account and all owned data are scheduled for
          permanent deletion on {when}. Cancel any time before then to keep your account.
        </div>
        <form action={cancelAction}>
          <SubmitButton
            pending={cancelPending}
            idle="Cancel deletion"
            busy="Cancelling…"
            className="btn btn-primary"
          />
        </form>
        <FormMessage result={cancelState} />
      </div>
    );
  }

  if (holds.length > 0) {
    return (
      <div className="notice notice-warn">
        <strong>Deletion is blocked.</strong> The following applicant record
        {holds.length > 1 ? 's have' : ' has'} an active legal hold and cannot be deleted until it
        is released:
        <ul style={{ margin: '0.6rem 0 0', paddingLeft: '1.2rem' }}>
          {holds.map((hold) => (
            <li key={hold.id} style={{ marginBottom: '0.35rem' }}>
              <strong>{hold.applicantDisplayName}</strong> - {hold.reason}, scoped to{' '}
              {scopeLabel(hold.scope)} (placed {formatDate(hold.placedAt)}, next review{' '}
              {hold.reviewAt ? formatDate(hold.reviewAt) : 'not yet scheduled'}, accessible to{' '}
              {hold.accessibleTo.length > 0 ? hold.accessibleTo.join(', ') : 'nobody right now'})
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const scopeItems = [
    `${impact.applicants.length} applicant${impact.applicants.length === 1 ? '' : 's'} (${impact.applicants.map((a) => a.displayName).join(', ') || 'none'})`,
    `${impact.missionCount} case${impact.missionCount === 1 ? '' : 's'}`,
    `${impact.documentCount} document${impact.documentCount === 1 ? '' : 's'}`,
  ];
  if (impact.activePlatformRoleCount > 0) {
    scopeItems.push(
      `${impact.activePlatformRoleCount} active platform-admin role grant${impact.activePlatformRoleCount === 1 ? '' : 's'} (will be revoked)`,
    );
  }
  if (impact.authoredMissionNoteCount > 0) {
    scopeItems.push(
      `${impact.authoredMissionNoteCount} note${impact.authoredMissionNoteCount === 1 ? '' : 's'} you left on other cases (kept, author cleared)`,
    );
  }

  return (
    <div>
      <div className="notice u-mb-100">
        <strong>This deletes your entire account.</strong> There is no partial deletion - every
        applicant you own goes with it.
        <ul style={{ margin: '0.6rem 0 0', paddingLeft: '1.2rem' }}>
          {scopeItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <p className="card-body" style={{ marginBottom: '0.85rem' }}>
        Want a copy first?{' '}
        <a href="/app/privacy/export" download>
          Download your export
        </a>{' '}
        before deleting - it will not be possible afterward.
      </p>
      <form
        action={requestAction}
        onSubmit={(e) => {
          if (
            !window.confirm(
              'Schedule permanent deletion of your account and all owned data? You will have a 7-day grace window to cancel.',
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <label
          className="field-label"
          htmlFor="del-reason"
          style={{ display: 'block', marginBottom: '0.4rem' }}
        >
          Reason (optional)
        </label>
        <input
          id="del-reason"
          name="reason"
          type="text"
          className="input"
          placeholder="Helps us improve - not required"
          style={{ marginBottom: '0.85rem' }}
        />
        <SubmitButton
          pending={reqPending}
          idle="Request account deletion"
          busy="Scheduling…"
          className="btn btn-danger"
        />
        <FormMessage result={reqState} />
      </form>
    </div>
  );
}
