import type { ConsentType } from '@visastack/core';
import { AI_DAY_BOUNDARY_NOTE } from '@visastack/core/ai-features';
import {
  getDeletionImpactSummary,
  getPendingDeletion,
  listAccountExportJobsForAccount,
  listActiveLegalHoldsForAccount,
  listConsentHistory,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ActivityLog, type ActivityLogEntry } from '../../../components/activity-log';
import { DepthScope, atLevel } from '../../../components/depth';
import { DepthSwitch } from '../../../components/depth-switch';
import { EmptyState, PageHeader } from '../../../components/ui';
import { readAiUsage, usageBadge, usageLine } from '../../../lib/ai-usage';
import { depthCopyFor } from '../../../lib/ccd/depth-copy';
import { readDepth } from '../../../lib/ccd/depth.server';
import { consentName } from '../../../lib/labels';
import { type SearchParamsRecord, pagingHref, parseCursor } from '../../../lib/paging';
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

/** Consent changes per load (the log budget), older ones through Show Older Entries. */
const CONSENT_PAGE_SIZE = 50;
const CONSENT_LOG_ID = 'consent-history-log';
const PATHNAME = '/app/privacy';

/** The address parameters this page reads. */
interface PrivacyPageProps {
  readonly searchParams?: Promise<
    SearchParamsRecord & { readonly consentBefore?: string | string[] }
  >;
}

// Next.js reads the props type from the last signature; the bare call serves older tests.
export default async function PrivacyPage(): Promise<React.JSX.Element>;
export default async function PrivacyPage(props: PrivacyPageProps): Promise<React.JSX.Element>;
export default async function PrivacyPage({
  searchParams,
}: PrivacyPageProps = {}): Promise<React.JSX.Element> {
  const query = (await searchParams) ?? {};
  const consentBefore = parseCursor(query.consentBefore);
  const data = await withSession(async ({ db, accountId }) => {
    const [history, pending, impact, holds, exportJobs, aiUsage] = await Promise.all([
      listConsentHistory(db, accountId, {
        limit: CONSENT_PAGE_SIZE,
        ...(consentBefore ? { before: consentBefore } : {}),
      }),
      getPendingDeletion(db, accountId),
      getDeletionImpactSummary(db, accountId),
      listActiveLegalHoldsForAccount(db, accountId),
      listAccountExportJobsForAccount(db, accountId),
      readAiUsage(db, accountId),
    ]);
    return {
      aiUsage,
      historyOlder: history.nextCursor,
      history: history.items.map((row): ActivityLogEntry => {
        const type = row.type as ConsentType;
        const granted = row.grantedAt !== null && row.revokedAt === null;
        const at = (row.grantedAt ?? row.revokedAt ?? row.createdAt).toISOString();
        return {
          id: row.id,
          what: CONSENT_LABELS[type] ?? type,
          outcome: granted
            ? { label: 'Granted', tone: 'success' }
            : { label: 'Revoked', tone: 'neutral' },
          at,
          when: formatDateTime(at),
        };
      }),
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
          {data.history.length === 0 && !consentBefore ? (
            <EmptyState icon="activity" title="No Changes Yet">
              Each time you turn a permission on or off, it is recorded here with the date.
            </EmptyState>
          ) : (
            <div className="u-mt-050">
              <ActivityLog
                id={CONSENT_LOG_ID}
                label="Consent History Entries"
                entries={data.history}
                {...(data.historyOlder
                  ? {
                      olderHref: pagingHref(
                        PATHNAME,
                        query,
                        { consentBefore: data.historyOlder },
                        CONSENT_LOG_ID,
                      ),
                    }
                  : {})}
                {...(consentBefore
                  ? {
                      newestHref: pagingHref(
                        PATHNAME,
                        query,
                        { consentBefore: null },
                        CONSENT_LOG_ID,
                      ),
                    }
                  : {})}
              />
            </div>
          )}
        </article>

        {data.aiUsage ? (
          <article
            className="card u-mt-150"
            id="ai-use-today"
            aria-labelledby="ai-use-today-title"
            {...atLevel('browse')}
          >
            <p className="card-kicker">Transparency</p>
            <h2 className="card-title" id="ai-use-today-title">
              AI Use Today
            </h2>
            <p className="card-body">
              How much you used each AI feature today. Only the number is kept, never what was read.
              Everything in VisaStack works without these features.
            </p>
            <div className="rows u-mt-050">
              {data.aiUsage.map((feature) => {
                const badge = usageBadge(feature);
                return (
                  <div className="row" key={feature.feature}>
                    <span className="row-key">{feature.name}</span>
                    <span className="row-end">
                      <span className={`badge ${badge.tone}`}>{badge.label}</span>
                      <span className="muted u-fs-085">{usageLine(feature)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="muted u-fs-085 u-mt-050">{AI_DAY_BOUNDARY_NOTE}</p>
          </article>
        ) : null}

        <p className="muted u-mt-150" {...atLevel('everything')}>
          Turn each permission on or off under{' '}
          <Link href="/app#permissions">Permissions You Control on Home</Link>.
        </p>
      </DepthScope>
    </section>
  );
}
