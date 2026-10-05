'use client';

import { type Locale, fill } from '@visastack/i18n/client';
import { useActionState } from 'react';
import { type ActionState, requestLargeExportAction } from './actions';
import type { LargeExportMessages } from './large-export-panel.messages';

const INITIAL: ActionState = { ok: true, message: '' };

export interface LargeExportJobProps {
  readonly id: string;
  readonly status: 'PENDING' | 'CLAIMED' | 'READY' | 'FAILED' | 'EXPIRED';
  readonly createdAt: string;
  readonly readyAt: string | null;
  readonly expiresAt: string | null;
  /** When the download expires, already written in the reader's language by the server. */
  readonly expiresLabel: string | null;
  readonly lastError: string | null;
}

interface LargeExportPanelProps {
  /** Newest first, matching `listAccountExportJobsForAccount`'s own order. */
  readonly jobs: readonly LargeExportJobProps[];
  readonly messages: LargeExportMessages;
  readonly locale: Locale;
}

function StatusLine({
  job,
  messages,
  locale,
}: {
  readonly job: LargeExportJobProps;
  readonly messages: LargeExportMessages;
  readonly locale: Locale;
}) {
  switch (job.status) {
    case 'PENDING':
    case 'CLAIMED':
      return <span className="badge badge-neutral">{messages['privacy.large.preparing']}</span>;
    case 'READY':
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <a
            href={`/app/privacy/large-export/${job.id}/download`}
            className="btn btn-secondary"
            download
          >
            {messages['privacy.large.download']}
          </a>
          {job.expiresLabel ? (
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {fill(messages['privacy.large.expires'], { when: job.expiresLabel }, locale)}
            </span>
          ) : null}
        </span>
      );
    case 'FAILED':
      return <span className="badge badge-danger">{messages['privacy.large.failed']}</span>;
    case 'EXPIRED':
      return <span className="badge badge-neutral">{messages['privacy.large.expired']}</span>;
    default:
      return null;
  }
}

/** Only the current job matters to a returning visitor - a terminal (FAILED/EXPIRED) history entry is still shown, but never crowds out requesting a fresh one. */
export function LargeExportPanel({ jobs, messages, locale }: LargeExportPanelProps) {
  const [state, action, pending] = useActionState(requestLargeExportAction, INITIAL);
  const active = jobs.find(
    (j) => j.status === 'PENDING' || j.status === 'CLAIMED' || j.status === 'READY',
  );

  return (
    <div
      style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border, #333)' }}
    >
      <p className="card-body" style={{ marginBottom: '0.75rem' }}>
        {messages['privacy.large.body']}
      </p>
      {active ? (
        <StatusLine job={active} messages={messages} locale={locale} />
      ) : (
        <form action={action}>
          <button type="submit" className="btn btn-secondary" disabled={pending}>
            {pending ? messages['privacy.large.requesting'] : messages['privacy.large.request']}
          </button>
        </form>
      )}
      {state.message ? (
        <p className={`field-msg ${state.ok ? 'field-msg-ok' : 'field-msg-err'}`}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
