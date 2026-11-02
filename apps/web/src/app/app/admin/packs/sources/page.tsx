import {
  type OfficialSourceView,
  type SourceChangeCandidateView,
  listPacks,
  sourceMonitorOverview,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CollapsibleGroup } from '../../../../../components/collapsible-group';
import { PageHeader } from '../../../../../components/ui';
import { hasPlatformPermission } from '../../../../../lib/admin';
import { formatTimestamp, formatTimestampDate } from '../../../../../lib/format-date';
import { withSession } from '../../../../../lib/session';
import {
  AUTHORITY_TIER_LABELS,
  CandidateDecisionForm,
  CheckNowButton,
  DeactivateSourceButton,
  RegisterSourceForm,
} from './source-forms';

export const metadata: Metadata = { title: 'Official Sources' };

export const dynamic = 'force-dynamic';
/** Check Now runs here as a server action and may take up to the check's 50 second budget. */
export const maxDuration = 60;

/** How the latest attempt went, in plain words. Only a read or an unchanged page counts as checked. */
const OUTCOME_LABELS = {
  FETCHED: 'Read',
  NOT_MODIFIED: 'Unchanged',
  BLOCKED: 'Blocked by the Site',
  TIMEOUT: 'Timed Out',
  REDIRECT_REFUSED: 'Redirect Refused',
  TOO_LARGE: 'Too Large',
  UNSUPPORTED_FORMAT: 'Unsupported Format',
  ERROR: 'Could Not Be Read',
} as const;

const STATUS_LABELS = { NEW: 'New', IN_REVIEW: 'In Review' } as const;

function SourceRow({ source }: { readonly source: OfficialSourceView }) {
  const exception =
    source.lastOutcome !== null &&
    source.lastOutcome !== 'FETCHED' &&
    source.lastOutcome !== 'NOT_MODIFIED';
  return (
    <div className="row">
      <div className="stack-sm">
        <p className="row-key u-m-0">
          {source.title} {source.active ? null : <span className="badge">Stopped</span>}
          {exception && source.lastOutcome ? (
            <span className="badge badge-warning">{OUTCOME_LABELS[source.lastOutcome]}</span>
          ) : null}
        </p>
        <p className="muted u-fs-085 u-m-0">
          {source.jurisdiction}
          {source.route ? ` · ${source.route}` : ''}
          {source.purpose ? ` · ${source.purpose}` : ''} · {source.publisher} ·{' '}
          {AUTHORITY_TIER_LABELS[source.authorityTier]}
          {source.packName ? ` · ${source.packName}` : ''}
        </p>
        <p className="u-m-0">
          <a className="row-val" href={source.url} target="_blank" rel="noreferrer">
            {source.url} ↗
          </a>
        </p>
        <dl className="rows rows-grid u-m-0">
          <div className="row">
            <dt className="row-key">Last Fetched</dt>
            <dd className="row-val">
              {source.lastFetchedAt ? formatTimestamp(source.lastFetchedAt) : 'Not Fetched Yet'}
            </dd>
          </div>
          <div className="row">
            <dt className="row-key">Last Verified by a Person</dt>
            <dd className="row-val">
              {source.lastVerifiedAt
                ? formatTimestampDate(source.lastVerifiedAt)
                : 'Not Verified Yet'}
            </dd>
          </div>
        </dl>
      </div>
      {source.active ? (
        <div className="action-bar-end">
          <CheckNowButton sourceId={source.id} sourceTitle={source.title} />
          <DeactivateSourceButton sourceId={source.id} sourceTitle={source.title} />
        </div>
      ) : null}
    </div>
  );
}

function CandidateCard({ candidate }: { readonly candidate: SourceChangeCandidateView }) {
  const packHref = candidate.packId ? `/app/admin/packs/${candidate.packId}` : '/app/admin/packs';
  const status = candidate.status === 'IN_REVIEW' ? 'IN_REVIEW' : 'NEW';
  return (
    <article className="card" aria-label={`Change on ${candidate.sourceTitle}`}>
      <p className="card-kicker">
        {candidate.jurisdiction} · Detected {formatTimestamp(candidate.detectedAt)}
      </p>
      <h3 className="card-title">
        {candidate.sourceTitle} <span className="badge">{STATUS_LABELS[status]}</span>
      </h3>
      <div className="form-grid u-mt-050">
        <section aria-label="Earlier Text">
          <h4 className="field-label">Earlier Text</h4>
          <p className="row-val muted">
            {candidate.oldExcerpt ??
              'The earlier text at this point was not kept. Open the official page to compare.'}
          </p>
        </section>
        <section aria-label="New Text">
          <h4 className="field-label">New Text</h4>
          <p className="row-val">{candidate.newExcerpt ?? ''}</p>
        </section>
      </div>
      <p className="u-fs-085 u-mt-050">
        <a href={candidate.sourceUrl} target="_blank" rel="noreferrer">
          Open Official Page ↗
        </a>{' '}
        · <Link href={packHref}>Open Pack Studio</Link>
      </p>
      <CandidateDecisionForm
        candidateId={candidate.id}
        status={status}
        sourceTitle={candidate.sourceTitle}
      />
    </article>
  );
}

/**
 * Official Sources (UMPE P10): the official pages registered per route, when each was last
 * fetched (kept apart from when a person last verified it), the latest check's counts, and the
 * changes waiting for review. Pack management rights only. Nothing here changes a pack.
 */
export default async function OfficialSourcesPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) {
      return { allowed: false as const };
    }
    const overview = await sourceMonitorOverview(db);
    const packs = overview.ready
      ? (await listPacks(db)).map((pack) => ({ id: pack.id, name: pack.name }))
      : [];
    return { allowed: true as const, overview, packs };
  });

  return (
    <section className="section container">
      <div className="u-mb-150">
        <Link href="/app/admin/packs" className="muted u-fs-085">
          ← Pack Studio
        </Link>
      </div>
      <PageHeader
        eyebrow="Pack Studio"
        title="Official Sources"
        description="Official pages for supported routes, checked every Saturday at 09:00 Bangladesh time. A fetched page is not a verified rule: a person reviews every change before it reaches a pack."
      />

      {!data.allowed ? (
        <article className="card">
          <p className="card-body">This area is restricted to people who manage packs.</p>
        </article>
      ) : !data.overview.ready ? (
        <article className="card">
          <p className="card-body">Source monitoring can be used once the database is updated.</p>
        </article>
      ) : (
        <div className="grid">
          <article className="card">
            <p className="card-kicker">Latest Check</p>
            <h2 className="card-title">Saturday Check</h2>
            {data.overview.lastRun ? (
              <>
                <p className="muted u-fs-085 u-mt-050">
                  {data.overview.lastRun.trigger === 'MANUAL' ? 'Check Now' : 'Scheduled'},{' '}
                  {formatTimestamp(data.overview.lastRun.startedAt)}
                  {data.overview.lastRun.finishedAt ? '' : ' (not finished)'}
                </p>
                <dl className="rows rows-grid u-mt-050">
                  {(
                    [
                      ['Pages Due', data.overview.lastRun.sourcesDue],
                      ['Checked', data.overview.lastRun.checked],
                      ['Changed', data.overview.lastRun.changed],
                      ['Blocked', data.overview.lastRun.blocked],
                      ['Could Not Be Read', data.overview.lastRun.failed],
                      ['Unsupported Format', data.overview.lastRun.unsupported],
                      ['Left for Later', data.overview.lastRun.deferred],
                    ] as const
                  ).map(([label, value]) => (
                    <div className="row" key={label}>
                      <dt className="row-key">{label}</dt>
                      <dd className="row-val">{value}</dd>
                    </div>
                  ))}
                  <div className="row">
                    <dt className="row-key">Changes Reviewed</dt>
                    <dd className="row-val">{data.overview.reviewedCount}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="card-body">No check has run yet.</p>
            )}
            <div className="u-mt-050">
              <CheckNowButton />
            </div>
          </article>

          <article className="card grid-span-all">
            <p className="card-kicker">Review</p>
            <h2 className="card-title">Changes to Review</h2>
            <p className="muted u-fs-085 u-mt-050">
              Accept for Draft records your decision only. Write the change as a draft version in
              Pack Studio, where a second person approves it.
            </p>
            {data.overview.openCandidates.length === 0 ? (
              <p className="card-body u-mt-050">Nothing waiting for review.</p>
            ) : (
              <div className="grid u-mt-050">
                {data.overview.openCandidates.map((candidate) => (
                  <CandidateCard key={candidate.id} candidate={candidate} />
                ))}
              </div>
            )}
          </article>

          <article className="card grid-span-all">
            <p className="card-kicker">Register</p>
            <h2 className="card-title">Registered Sources</h2>
            {data.overview.sources.length === 0 ? (
              <p className="card-body u-mt-050">No sources registered yet.</p>
            ) : (
              <div className="rows u-mt-050">
                {data.overview.sources.map((source) => (
                  <SourceRow key={source.id} source={source} />
                ))}
              </div>
            )}
            <div className="u-mt-100">
              <CollapsibleGroup title="Register a Source">
                <RegisterSourceForm packs={data.packs} />
              </CollapsibleGroup>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
