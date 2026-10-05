'use client';

import { type Locale, fill, pluralForm } from '@visastack/i18n/client';
import { useActionState } from 'react';
import { Rich } from '../../../components/rich';
import { type ActionState, cancelDeletionAction, requestDeletionAction } from './actions';
import type { DeletionPanelMessages } from './deletion-panel.messages';

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
  /** The date the hold was placed, already written in the reader's language by the server. */
  readonly placedLabel: string;
  /** The date the hold is next due for compliance review, written the same way, or null if none was set. */
  readonly reviewLabel: string | null;
  /** Directive Part 7 §13 "who can access": every account/organization with genuinely current access right now. */
  readonly accessibleTo: readonly string[];
  /** Directive Part 7 §13 "exact scope": what the hold actually reaches. */
  readonly scope:
    | { readonly kind: 'applicant' }
    | { readonly kind: 'mission'; readonly missionTitle: string }
    | { readonly kind: 'document'; readonly documentName: string };
}

interface DeletionPanelProps {
  /** The date the pending deletion is scheduled for, already written in the reader's language by the server, or null if none pending. */
  readonly scheduledLabel: string | null;
  /** What deletion actually touches for this account (PRV-03, Part 7 §12 step 3). */
  readonly impact: DeletionImpactProps;
  /** Every currently active hold across this account's applicants, real detail, not a generic sentence (step 4). */
  readonly holds: readonly AccountLegalHoldProps[];
  readonly messages: DeletionPanelMessages;
  readonly locale: Locale;
}

type CountedKey = 'applicants' | 'cases' | 'documents' | 'roles' | 'notes';

export function DeletionPanel({
  scheduledLabel,
  impact,
  holds,
  messages: m,
  locale,
}: DeletionPanelProps) {
  const [reqState, requestAction, reqPending] = useActionState(requestDeletionAction, INITIAL);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelDeletionAction, INITIAL);

  /** "1 case" / "2 cases" in the reader's plural rules. */
  const counted = (kind: CountedKey, count: number, extra?: Record<string, string>) => {
    const form = pluralForm(locale, count);
    const template = m[`privacy.deletion.impact.${kind}.${form}`];
    return fill(template, { count, ...extra }, locale);
  };

  const scopeLabel = (scope: AccountLegalHoldProps['scope']): string => {
    switch (scope.kind) {
      case 'mission':
        return fill(m['privacy.deletion.scope.case'], { title: scope.missionTitle }, locale);
      case 'document':
        return fill(m['privacy.deletion.scope.document'], { name: scope.documentName }, locale);
      default:
        return m['privacy.deletion.scope.profile'];
    }
  };

  if (scheduledLabel) {
    const when = scheduledLabel;
    return (
      <div>
        <div className="notice notice-warn" style={{ marginBottom: '1rem' }}>
          <Rich template={m['privacy.deletion.pending']} locale={locale} params={{ when }} />
        </div>
        <form action={cancelAction}>
          <button type="submit" className="btn btn-primary" disabled={cancelPending}>
            {cancelPending ? m['privacy.deletion.cancelling'] : m['privacy.deletion.cancel']}
          </button>
        </form>
        {cancelState.message ? (
          <p className={`field-msg ${cancelState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
            {cancelState.message}
          </p>
        ) : null}
      </div>
    );
  }

  if (holds.length > 0) {
    const heading =
      pluralForm(locale, holds.length) === 'one'
        ? m['privacy.deletion.blocked.one']
        : m['privacy.deletion.blocked.other'];
    return (
      <div className="notice notice-warn">
        <Rich template={heading} locale={locale} />
        <ul style={{ margin: '0.6rem 0 0', paddingLeft: '1.2rem' }}>
          {holds.map((hold) => (
            <li key={hold.id} style={{ marginBottom: '0.35rem' }}>
              <Rich
                template={m['privacy.deletion.hold']}
                locale={locale}
                params={{
                  name: hold.applicantDisplayName,
                  reason: hold.reason,
                  scope: scopeLabel(hold.scope),
                  placed: hold.placedLabel,
                  review: hold.reviewLabel ?? m['privacy.deletion.review.none'],
                  accessible:
                    hold.accessibleTo.length > 0
                      ? hold.accessibleTo.join(', ')
                      : m['privacy.deletion.access.none'],
                }}
              />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const scopeItems = [
    counted('applicants', impact.applicants.length, {
      names:
        impact.applicants.map((a) => a.displayName).join(', ') || m['privacy.deletion.impact.none'],
    }),
    counted('cases', impact.missionCount),
    counted('documents', impact.documentCount),
  ];
  if (impact.activePlatformRoleCount > 0) {
    scopeItems.push(counted('roles', impact.activePlatformRoleCount));
  }
  if (impact.authoredMissionNoteCount > 0) {
    scopeItems.push(counted('notes', impact.authoredMissionNoteCount));
  }

  return (
    <div>
      <div className="notice" style={{ marginBottom: '1rem' }}>
        <Rich template={m['privacy.deletion.warning']} locale={locale} />
        <ul style={{ margin: '0.6rem 0 0', paddingLeft: '1.2rem' }}>
          {scopeItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <p className="card-body" style={{ marginBottom: '0.85rem' }}>
        <Rich
          template={m['privacy.deletion.copy']}
          locale={locale}
          link={(text) => (
            <a href="/app/privacy/export" download>
              {text}
            </a>
          )}
        />
      </p>
      <form
        action={requestAction}
        onSubmit={(e) => {
          if (!window.confirm(m['privacy.deletion.confirm'])) {
            e.preventDefault();
          }
        }}
      >
        <label
          className="field-label"
          htmlFor="del-reason"
          style={{ display: 'block', marginBottom: '0.4rem' }}
        >
          {m['privacy.deletion.reason']}
        </label>
        <input
          id="del-reason"
          name="reason"
          type="text"
          className="input"
          placeholder={m['privacy.deletion.reasonPlaceholder']}
          style={{ marginBottom: '0.85rem' }}
        />
        <button type="submit" className="btn btn-danger" disabled={reqPending}>
          {reqPending ? m['privacy.deletion.requesting'] : m['privacy.deletion.request']}
        </button>
        {reqState.message ? (
          <p className={`field-msg ${reqState.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
            {reqState.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
