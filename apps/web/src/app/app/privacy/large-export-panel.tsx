'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../components/form-feedback';
import { type ActionState, requestLargeExportAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export interface LargeExportJobProps {
  readonly id: string;
  readonly status: 'PENDING' | 'CLAIMED' | 'READY' | 'FAILED' | 'EXPIRED';
  readonly createdAt: string;
  readonly readyAt: string | null;
  readonly expiresAt: string | null;
  readonly lastError: string | null;
}

interface LargeExportPanelProps {
  /** Newest first, matching `listAccountExportJobsForAccount`'s own order. */
  readonly jobs: readonly LargeExportJobProps[];
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusLine({ job }: { readonly job: LargeExportJobProps }) {
  switch (job.status) {
    case 'PENDING':
    case 'CLAIMED':
      return <span className="badge badge-neutral">Preparing…</span>;
    case 'READY':
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <a
            href={`/app/privacy/large-export/${job.id}/download`}
            className="btn btn-secondary"
            download
          >
            Download ZIP
          </a>
          {job.expiresAt ? (
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              expires {formatDateTime(job.expiresAt)}
            </span>
          ) : null}
        </span>
      );
    case 'FAILED':
      return (
        <span className="export-failed">
          <span className="badge badge-danger">Could not be made</span>
          <span className="muted">
            Your data is safe and nothing was changed. Request it again below. If it fails twice,{' '}
            <a href="/app/help">get help</a>.
          </span>
        </span>
      );
    case 'EXPIRED':
      return <span className="badge badge-neutral">Expired</span>;
    default:
      return null;
  }
}

/** Only the current job matters to a returning visitor - a terminal (FAILED/EXPIRED) history entry is still shown, but never crowds out requesting a fresh one. */
export function LargeExportPanel({ jobs }: LargeExportPanelProps) {
  const [state, action, pending] = useActionState(requestLargeExportAction, INITIAL);
  const active = jobs.find(
    (j) => j.status === 'PENDING' || j.status === 'CLAIMED' || j.status === 'READY',
  );

  return (
    <div
      style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border, #333)' }}
    >
      <p className="card-body" style={{ marginBottom: '0.75rem' }}>
        Need the actual document files too, not just their metadata? Request a large export - a ZIP
        containing every current, safe document file alongside the same manifest and CSV tables
        above. It takes a few minutes to prepare and stays downloadable for 24 hours.
      </p>
      {active ? (
        <StatusLine job={active} />
      ) : (
        <form action={action}>
          <SubmitButton
            pending={pending}
            idle="Request large export (with files)"
            busy="Requesting…"
            className="btn btn-secondary"
          />
        </form>
      )}
      <FormMessage result={state} />
    </div>
  );
}
