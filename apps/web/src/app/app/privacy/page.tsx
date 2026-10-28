import type { ConsentType } from '@visastack/core';
import {
  getDeletionImpactSummary,
  getPendingDeletion,
  listAccountExportJobsForAccount,
  listActiveLegalHoldsForAccount,
  listConsentHistory,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DepthScope, atLevel } from '../../../components/depth';
import { DepthSwitch } from '../../../components/depth-switch';
import { EmptyState, PageHeader } from '../../../components/ui';
import { depthCopyFor } from '../../../lib/ccd/depth-copy';
import { readDepth } from '../../../lib/ccd/depth.server';
import { consentName } from '../../../lib/labels';
import { withSession } from '../../../lib/session';
import { DeletionPanel } from './deletion-panel';
import { LargeExportPanel } from './large-export-panel';

export const metadata: Metadata = { title: 'Privacy & Consent' };

export const dynamic = 'force-dynamic';

const CONSENT_LABELS: Record<ConsentType, string> = {
  CORE_PROCESSING: consentName('CORE_PROCESSING'),
  AI_EXTRACTION: consentName('AI_EXTRACTION'),
  AI_OCR: consentName('AI_OCR'),
  SHARING: consentName('SHARING'),
  MARKETING: consentName('MARKETING'),
  ISSUER_CONTACT: consentName('ISSUER_CONTACT'),
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

  const depth = await readDepth('privacy');
  const exportInProgress = data.exportJobs.some(
    (job) => job.status === 'PENDING' || job.status === 'CLAIMED' || job.status === 'READY',
  );

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Account"
        title="Privacy & Consent"
        description="Export everything, review your consent history, or delete your account."
      />

      <DepthScope family="privacy" depth={depth}>
        <DepthSwitch family="privacy" initial={depth} copy={depthCopyFor('privacy')} />

        {/* The three rights, each one tap from where it is used (the link opens its level). */}
        <nav className="card rows u-mb-150" aria-label="Your rights">
          <a className="row row-link" href="#export-data">
            <span className="row-key">Export Your Data</span>
            <span className="muted" aria-hidden="true">
              →
            </span>
          </a>
          <a className="row row-link" href="#consent-history">
            <span className="row-key">Review Your Consent History</span>
            <span className="muted" aria-hidden="true">
              →
            </span>
          </a>
          <a className="row row-link" href="#delete-account">
            <span className="row-key">Delete Your Account</span>
            <span className="muted" aria-hidden="true">
              →
            </span>
          </a>
        </nav>

        <div className="grid">
          <article className="card" id="export-data">
            <p className="card-kicker">Portability</p>
            <h2 className="card-title">Export Your Data</h2>
            <p className="card-body u-mb-125" {...atLevel('browse')}>
              Download a complete, structured snapshot of your account: identity, consents,
              travellers, Master Profile facts with full history, document metadata, and your audit
              trail.
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <a href="/app/privacy/export" className="btn btn-primary" download>
                Download Export (JSON)
              </a>
              <a href="/app/privacy/export?format=csv" className="btn btn-secondary" download>
                Download Export (CSV/ZIP)
              </a>
            </div>
            {/* An export on its way or ready to download is never hidden; otherwise Everything. */}
            <div id="large-export" {...(exportInProgress ? {} : atLevel('everything'))}>
              <LargeExportPanel jobs={data.exportJobs} />
            </div>
          </article>

          {/* A deletion already on its way is never hidden: cancelling it must stay one look away. */}
          <article
            className="card"
            id="delete-account"
            {...(data.scheduledFor ? {} : atLevel('everything'))}
          >
            <p className="card-kicker">Erasure</p>
            <h2 className="card-title">Delete Your Account</h2>
            <p className="card-body u-mb-125">
              Deletion is reversible during a 7-day grace window, then permanent. Your audit trail
              is preserved and anonymized. An active legal hold blocks deletion until released.
            </p>
            <DeletionPanel
              scheduledFor={data.scheduledFor}
              impact={data.impact}
              holds={data.holds}
            />
          </article>
        </div>

        <article className="card u-mt-150" id="consent-history" {...atLevel('browse')}>
          <p className="card-kicker">Transparency</p>
          <h2 className="card-title">Consent History</h2>
          {data.history.length === 0 ? (
            <EmptyState icon="activity" title="No Changes Yet">
              Each time you turn a permission on or off, it is recorded here with the date.
            </EmptyState>
          ) : (
            <div className="rows u-mt-050">
              {data.history.map((entry, i) => (
                <div className="row" key={`${entry.type}-${entry.at}-${i}`}>
                  <span className="row-key">{CONSENT_LABELS[entry.type] ?? entry.type}</span>
                  <span className="row-end">
                    <span className={`badge ${entry.granted ? 'badge-success' : 'badge-neutral'}`}>
                      {entry.granted ? 'Granted' : 'Revoked'}
                    </span>
                    <span className="muted u-fs-085">{formatDateTime(entry.at)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <p className="muted u-mt-150" {...atLevel('everything')}>
          Turn each permission on or off under{' '}
          <Link href="/app#permissions">Permissions You Control on Home</Link>.
        </p>
      </DepthScope>
    </section>
  );
}
