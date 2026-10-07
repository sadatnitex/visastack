import type { ConsentType } from '@visastack/core';
import {
  getDeletionImpactSummary,
  getPendingDeletion,
  listAccountExportJobsForAccount,
  listActiveLegalHoldsForAccount,
  listConsentHistory,
} from '@visastack/services';
import type { Metadata } from 'next';
import { EmptyState, PageHeader } from '../../../components/ui';
import { withSession } from '../../../lib/session';
import { DeletionPanel } from './deletion-panel';
import { LargeExportPanel } from './large-export-panel';

export const metadata: Metadata = { title: 'Privacy' };

export const dynamic = 'force-dynamic';

const CONSENT_LABELS: Record<ConsentType, string> = {
  CORE_PROCESSING: 'Core processing',
  AI_EXTRACTION: 'AI extraction',
  AI_OCR: 'AI OCR',
  SHARING: 'Sharing',
  MARKETING: 'Marketing',
  ISSUER_CONTACT: 'Issuer contact',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function PrivacyPage() {
  const data = await withSession(async ({ db, accountId }) => {
    const [history, pending, impact, holds, exportJobs] = await Promise.all([
      listConsentHistory(db, accountId),
      getPendingDeletion(db, accountId),
      getDeletionImpactSummary(db, accountId),
      listActiveLegalHoldsForAccount(db, accountId),
      listAccountExportJobsForAccount(db, accountId),
    ]);
    return {
      history: history.map((row) => ({
        type: row.type as ConsentType,
        granted: row.grantedAt !== null && row.revokedAt === null,
        at: (row.grantedAt ?? row.revokedAt ?? row.createdAt).toISOString(),
      })),
      scheduledFor: pending ? pending.scheduledFor.toISOString() : null,
      impact,
      holds: holds.map((h) => ({
        ...h,
        placedAt: h.placedAt.toISOString(),
        reviewAt: h.reviewAt ? h.reviewAt.toISOString() : null,
      })),
      exportJobs: exportJobs.map((job) => ({
        id: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        readyAt: job.readyAt ? job.readyAt.toISOString() : null,
        expiresAt: job.expiresAt ? job.expiresAt.toISOString() : null,
        lastError: job.lastError,
      })),
    };
  });

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Privacy"
        title="Your data rights"
        description="Export everything, review your consent history, or delete your account."
      />

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Portability</p>
          <h2 className="card-title">Export your data</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Download a complete, structured snapshot of your account: identity, consents,
            applicants, Master Profile facts with full history, document metadata, and your audit
            trail.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <a href="/app/privacy/export" className="btn btn-primary" download>
              Download export (JSON)
            </a>
            <a href="/app/privacy/export?format=csv" className="btn btn-secondary" download>
              Download export (CSV/ZIP)
            </a>
          </div>
          <LargeExportPanel jobs={data.exportJobs} />
        </article>

        <article className="card">
          <p className="card-kicker">Erasure</p>
          <h2 className="card-title">Delete your account</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Deletion is reversible during a 7-day grace window, then permanent. Your audit trail is
            preserved and anonymized. An active legal hold blocks deletion until released.
          </p>
          <DeletionPanel scheduledFor={data.scheduledFor} impact={data.impact} holds={data.holds} />
        </article>
      </div>

      <article className="card" style={{ marginTop: '1.5rem' }}>
        <p className="card-kicker">Transparency</p>
        <h2 className="card-title">Consent history</h2>
        {data.history.length === 0 ? (
          <EmptyState title="No changes yet">
            Each time you turn a permission on or off, it is recorded here with the date.
          </EmptyState>
        ) : (
          <div className="rows" style={{ marginTop: '0.5rem' }}>
            {data.history.map((entry, i) => (
              <div className="row" key={`${entry.type}-${entry.at}-${i}`}>
                <span className="row-key">{CONSENT_LABELS[entry.type] ?? entry.type}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span className={`badge ${entry.granted ? 'badge-success' : 'badge-neutral'}`}>
                    {entry.granted ? 'Granted' : 'Revoked'}
                  </span>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {formatDateTime(entry.at)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
