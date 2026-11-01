import {
  type ErasureJobReason,
  documentsPastRetention,
  getRetentionPolicies,
  listActiveLegalHolds,
  listAllApplicants,
  listErasureJobsNeedingAttention,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentTypeDatalist } from '../../../../components/catalogue-datalists';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, isPlatformAdmin, staffPrincipal } from '../../../../lib/admin';
import { formatDateOnly } from '../../../../lib/format-date';
import { documentTypeLabel } from '../../../../lib/labels';
import {
  type SearchParamsRecord,
  TEAM_LIST_STEP,
  firstParam,
  pagingHref,
  parseCursor,
} from '../../../../lib/paging';
import { withSession } from '../../../../lib/session';
import { tolerantReader } from '../../../../lib/tolerate';
import { ReleaseHoldButton, RetryErasureJobButton } from '../action-buttons';
import { LegalHoldForm, RetentionPolicyForm } from '../admin-forms';
import { AdminNotForRole, AdminRestricted } from '../admin-restricted';
import { FailedSectionsBanner } from '../failed-sections-banner';
import { PurgeButton } from '../purge-button';
import { searchApplicantsAction } from './actions';
import { ApplicantPicker } from './applicant-picker';
import { SectionTabs } from './section-tabs';

/** Why each erasure job exists. Exhaustive: a new reason does not compile until it has a label. */
const ERASURE_REASON_LABELS = {
  ACCOUNT_DELETION: 'Account Deletion',
  RETENTION_PURGE: 'Retention Purge',
  PROFILE_PHOTO_REMOVAL: 'Photo Removal',
  SAFE_COPY_REMOVAL: 'Safe Copy Removal',
  DOCUMENT_REMOVAL: 'Document Removal',
} as const satisfies Record<ErasureJobReason, string>;

const PATHNAME = '/app/admin/privacy';

/** The page's sections, one tab each (WP-SB7). The ids are the anchors other pages link to. */
const TABS = {
  retention: { label: 'Retention', id: 'admin-retention' },
  holds: { label: 'Legal Holds', id: 'admin-holds' },
  erasure: { label: 'Erasure', id: 'admin-deletion' },
  purge: { label: 'Purge', id: 'admin-purge' },
} as const;
type Tab = keyof typeof TABS;

function tabOf(value: string | undefined): Tab {
  return value !== undefined && Object.hasOwn(TABS, value) ? (value as Tab) : 'retention';
}

/** Legal holds per load: the staff list step. */
const HOLDS_PER_LOAD = TEAM_LIST_STEP;
/** The erasure read's own ceiling; a full read is shown as "50+". */
const ERASURE_READ_MAX = 50;

export const metadata: Metadata = { title: 'Platform Privacy' };

export const dynamic = 'force-dynamic';

/**
 * How long documents are kept, what is held back from deletion, and what erasure still needs a
 * person. One tab per section (WP-SB7), so the page opens short: the legal holds read 25 at a time
 * with older ones a link away, and the long lists scroll inside a fixed panel. The applicant picker
 * searches as you type instead of sending every applicant to the browser; names on screen are
 * looked up only for the rows shown, under the same applicant directory permission.
 */
export default async function AdminPrivacyPage({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
} = {}) {
  const query: SearchParamsRecord = (await searchParams) ?? {};
  const { tab: tabParam, before: cursorParam } = query;
  const tab = tabOf(firstParam(tabParam));
  const before = tab === 'holds' ? parseCursor(cursorParam) : undefined;

  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    const { read: t, failed: failedSections } = tolerantReader();
    // Names, file names and hold reasons identify travellers, so the page is a compliance view.
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'APPLICANT_DIRECTORY_VIEW',
    );
    if (!staff.ok) return { admin: true as const, allowed: false as const };
    // Only the open tab's list is read. Erasure jobs needing a person are read on every tab (a
    // bounded read of at most 50), so the tab count shows waiting work wherever the admin is.
    const noHolds = { items: [], nextCursor: null };
    const [policies, holds, erasureJobs, purgeEligible] = await Promise.all([
      tab === 'retention' ? t('retention policies', () => getRetentionPolicies(db), []) : [],
      tab === 'holds'
        ? t(
            'legal holds',
            () =>
              listActiveLegalHolds(db, { limit: HOLDS_PER_LOAD, ...(before ? { before } : {}) }),
            noHolds,
          )
        : noHolds,
      t('erasure jobs', () => listErasureJobsNeedingAttention(db, ERASURE_READ_MAX), []),
      tab === 'purge' ? t('documents past retention', () => documentsPastRetention(db), []) : [],
    ]);
    // Only the names the open tab shows are looked up.
    const shownApplicantIds =
      tab === 'holds'
        ? holds.items.map((hold) => hold.applicantId)
        : tab === 'purge'
          ? purgeEligible.map((doc) => doc.applicantId)
          : [];
    const names = await t(
      'applicant names',
      async () => {
        if (shownApplicantIds.length === 0) return [];
        const listed = await listAllApplicants(db, staff.value, { ids: shownApplicantIds });
        if (!listed.ok) throw new Error(listed.error.message);
        return listed.value;
      },
      [],
    );
    return {
      admin: true as const,
      allowed: true as const,
      policies,
      holds: holds.items,
      holdsNextCursor: holds.nextCursor,
      erasureJobs,
      names: Object.fromEntries(names.map((entry) => [entry.id, entry.displayName])),
      purgeEligible,
      failedSections,
    };
  });

  const applicantName = (applicantId: string): string =>
    (data.admin && data.allowed ? data.names[applicantId] : undefined) ?? applicantId;

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform"
        title="Privacy"
        description="Retention policies, legal holds, erasure and purge."
      />

      {!data.admin ? (
        <AdminRestricted />
      ) : !data.allowed ? (
        <AdminNotForRole />
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />

          <SectionTabs
            label="Privacy Sections"
            active={tab}
            tabs={(Object.keys(TABS) as Tab[]).map((key) => ({
              key,
              label: TABS[key].label,
              href: key === 'retention' ? PATHNAME : `${PATHNAME}?tab=${key}`,
              ...(key === 'erasure'
                ? {
                    count: data.erasureJobs.length,
                    more: data.erasureJobs.length >= ERASURE_READ_MAX,
                  }
                : {}),
            }))}
          />

          {tab === 'retention' ? (
            <article className="card" id={TABS.retention.id}>
              <p className="card-kicker">Retention</p>
              <h2 className="card-title">Document Retention Policies</h2>
              {data.policies.length === 0 ? (
                <p className="card-body u-mb-125">
                  No retention policies configured. Without a policy, documents of a type are never
                  auto-purged.
                </p>
              ) : (
                <div className="rows rows-grid u-mb-125">
                  {data.policies.map((p) => (
                    <div className="row" key={p.id}>
                      <span className="row-key">{documentTypeLabel(p.docType)}</span>
                      <span className="row-val">{p.retentionDays} days</span>
                    </div>
                  ))}
                </div>
              )}
              <DocumentTypeDatalist />
              <RetentionPolicyForm />
            </article>
          ) : null}

          {tab === 'holds' ? (
            <article className="card" id={TABS.holds.id}>
              <p className="card-kicker">Legal Holds</p>
              <h2 className="card-title">Active Holds</h2>
              {data.holds.length === 0 ? (
                <p className="card-body u-mb-125">
                  {before
                    ? 'No older active holds.'
                    : 'No active legal holds. A hold blocks deletion and retention purge for an applicant until released.'}
                </p>
              ) : (
                <section
                  className="activity-log-scroll u-mb-125"
                  aria-label="Active holds"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take keyboard focus to scroll.
                  tabIndex={0}
                  id="holds-list"
                >
                  <div className="rows">
                    {data.holds.map((h) => (
                      <div className="row sb7-stack-row" key={h.id}>
                        <div className="sb7-stack-head">
                          <span className="row-key sb7-break">{applicantName(h.applicantId)}</span>
                          <ReleaseHoldButton holdId={h.id} />
                        </div>
                        <span className="muted u-fs-085">{h.reason}</span>
                        <span className="u-fs-085">
                          {h.reviewAt === null ? (
                            <span className="badge badge-danger">no review date set</span>
                          ) : h.reviewAt.getTime() < Date.now() ? (
                            <span className="badge badge-danger">
                              review overdue since {formatDateOnly(h.reviewAt)}
                            </span>
                          ) : (
                            <span className="badge badge-neutral">
                              review by {formatDateOnly(h.reviewAt)}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {data.holdsNextCursor || before ? (
                <nav className="show-more u-mb-125" aria-label="More holds">
                  {data.holdsNextCursor ? (
                    <Link
                      className="btn btn-secondary u-btn-sm show-more-link"
                      href={pagingHref(
                        PATHNAME,
                        query,
                        { before: data.holdsNextCursor },
                        TABS.holds.id,
                      )}
                    >
                      Show Older Holds
                    </Link>
                  ) : (
                    <p className="muted u-fs-085 u-m-0">These are the oldest active holds.</p>
                  )}
                  {before ? (
                    <Link href={pagingHref(PATHNAME, query, { before: null }, TABS.holds.id)}>
                      Back to the Newest Holds
                    </Link>
                  ) : null}
                </nav>
              ) : null}
              <h3 className="card-title">Place a Legal Hold</h3>
              <LegalHoldForm
                applicantPicker={<ApplicantPicker search={searchApplicantsAction} />}
              />
            </article>
          ) : null}

          {tab === 'erasure' ? (
            <article className="card" id={TABS.erasure.id}>
              <p className="card-kicker">Erasure</p>
              <h2 className="card-title">Erasure Jobs Needing Attention</h2>
              {data.erasureJobs.length === 0 ? (
                <p className="card-body">
                  No erasure jobs are failed or blocked. A job parks here only after it exhausts
                  every retry attempt, or while it's waiting on a legal hold to clear.
                </p>
              ) : (
                <section
                  className="activity-log-scroll u-mt-050"
                  aria-label="Erasure jobs needing attention"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take keyboard focus to scroll.
                  tabIndex={0}
                >
                  <div className="rows">
                    {data.erasureJobs.map((job) => (
                      <div className="row sb7-stack-row" key={job.id}>
                        <div className="sb7-stack-head">
                          <span className="row-key sb7-break">{job.objectKey}</span>
                          <span className="row-end">
                            <span
                              className={`badge ${job.status === 'BLOCKED_BY_HOLD' ? 'badge-warning' : 'badge-danger'}`}
                            >
                              {job.status === 'BLOCKED_BY_HOLD'
                                ? 'Blocked by Hold'
                                : `${job.attempts}/${job.maxAttempts} attempts`}
                            </span>
                            <RetryErasureJobButton jobId={job.id} />
                          </span>
                        </div>
                        <span className="muted u-fs-085">{ERASURE_REASON_LABELS[job.reason]}</span>
                        {job.lastError ? (
                          <span className="muted sb7-mono">{job.lastError}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </article>
          ) : null}

          {tab === 'purge' ? (
            <article className="card" id={TABS.purge.id}>
              <p className="card-kicker">Retention</p>
              <h2 className="card-title">Documents Eligible for Purge</h2>
              {data.purgeEligible.length === 0 ? (
                <p className="card-body">
                  No documents are currently past their retention policy (or all are under an active
                  legal hold).
                </p>
              ) : (
                <>
                  <section
                    className="activity-log-scroll u-mb-125"
                    aria-label="Documents eligible for purge"
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take keyboard focus to scroll.
                    tabIndex={0}
                  >
                    <div className="rows">
                      {data.purgeEligible.map((doc) => (
                        <div className="row" key={doc.id}>
                          <span className="row-key sb7-break">{doc.originalName}</span>
                          <span className="muted u-fs-085">{applicantName(doc.applicantId)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                  <PurgeButton eligibleCount={data.purgeEligible.length} />
                </>
              )}
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}
