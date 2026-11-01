import { listComplaintsForQualityReview, listFeedbackForQualityReview } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, hasPlatformPermission } from '../../../../lib/admin';
import { formatTimestampDate } from '../../../../lib/format-date';
import { complaintStatusLabel } from '../../../../lib/labels';
import {
  type SearchParamsRecord,
  firstParam,
  pagingHref,
  parseCursor,
} from '../../../../lib/paging';
import { withSession } from '../../../../lib/session';
import { QueuePaging, QueuePastEnd } from '../email/queue-paging';
import { QueuePanel } from '../email/queue-panel';
import { AssignComplaintForm, UpdateComplaintStatusForm } from './forms';

export const metadata: Metadata = { title: 'Complaints' };

export const dynamic = 'force-dynamic';

/**
 * QUALITY_ADMIN triage console (TRU-04 §9): every case complaint and piece of
 * private post-case feedback, platform-wide. Structurally never reachable by
 * an organization member - `listComplaintsForQualityReview`/
 * `listFeedbackForQualityReview` are gated entirely on the QUALITY_ADMIN
 * platform role, a concern with zero overlap with SECURITY_ADMIN/
 * COMPLIANCE_ADMIN/SUPPORT_ADMIN. A dedicated sub-page (mirroring
 * `admin/organizations/[orgId]`) rather than a card on the main admin page,
 * since this is its own growing concern, not per-organization.
 */

const STATUS_TONE: Record<string, string> = {
  OPEN: 'badge-warning',
  IN_PROGRESS: 'badge-warning',
  RESOLVED: 'badge-success',
  CLOSED: 'badge-neutral',
};

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['RESOLVED', 'CLOSED']);

/** The status tabs, open first (WP-SB6): what still needs someone comes before what has ended. */
const TABS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
type Tab = (typeof TABS)[number];
const TAB_PARAM: Record<Tab, string> = {
  OPEN: 'open',
  IN_PROGRESS: 'in-progress',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

/** Complaints per page; each one carries its forms, so a page is shorter than a log. */
const COMPLAINTS_PAGE_SIZE = 20;
/** Feedback entries per load into the fixed box. */
const FEEDBACK_PAGE_SIZE = 50;
const COMPLAINTS_PATH = '/app/admin/complaints';
const COMPLAINTS_LIST = 'complaints-list';
const FEEDBACK_PANEL = 'feedback-panel';

/** What an empty tab says, one written sentence per tab. */
const EMPTY_TAB: Record<Tab, string> = {
  OPEN: 'No open complaints platform-wide.',
  IN_PROGRESS: 'No complaints are being handled right now.',
  RESOLVED: 'No complaints have been resolved yet.',
  CLOSED: 'No complaints have been closed yet.',
};

function tabFrom(value: string | readonly string[] | undefined): Tab {
  const raw = firstParam(value);
  return TABS.find((tab) => TAB_PARAM[tab] === raw) ?? 'OPEN';
}

export default async function AdminComplaintsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
} = {}) {
  const search = (await searchParams) ?? {};
  const param = (name: string) => search[name];
  const tab = tabFrom(param('status'));
  const before = parseCursor(param('before'));
  const feedbackBefore = parseCursor(param('feedbackBefore'));
  // After a status change the action opens the complaint's new tab and names it (fixed words only).
  const movedRaw = firstParam(param('moved'));
  const moved = TABS.find((status) => TAB_PARAM[status] === movedRaw && status === tab);
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'COMPLAINT_MANAGE'))) {
      return { authorized: false as const };
    }
    const actor = { accountId, email, bootstrapEmails: bootstrapAdminEmails() };
    const canViewFeedback = await hasPlatformPermission(db, { accountId, email }, 'FEEDBACK_VIEW');
    const [complaints, feedback] = await Promise.all([
      listComplaintsForQualityReview(db, actor, {
        status: tab,
        limit: COMPLAINTS_PAGE_SIZE,
        ...(before ? { before } : {}),
      }),
      canViewFeedback
        ? listFeedbackForQualityReview(db, actor, {
            limit: FEEDBACK_PAGE_SIZE,
            ...(feedbackBefore ? { before: feedbackBefore } : {}),
          })
        : Promise.resolve(null),
    ]);
    return {
      authorized: true as const,
      complaints: complaints.ok ? complaints.value.items : [],
      complaintsNext: complaints.ok ? complaints.value.nextCursor : null,
      counts: complaints.ok ? complaints.value.counts : null,
      feedback: feedback?.ok ? feedback.value.items : [],
      feedbackNext: feedback?.ok ? feedback.value.nextCursor : null,
      feedbackTotal: feedback?.ok ? feedback.value.total : 0,
      canViewFeedback,
    };
  });

  if (!data.authorized) {
    return (
      <section className="section container">
        <article className="card">
          <p className="card-body">
            This area is restricted to quality admins. If you should have access, ask an existing
            platform owner to grant you the QUALITY_ADMIN role.
          </p>
        </article>
      </section>
    );
  }

  return (
    <section className="section container">
      <div className="u-mb-150">
        <Link href="/app/admin" className="muted u-fs-085">
          ← Admin
        </Link>
      </div>
      <PageHeader eyebrow="Quality" title={<>Complaint &amp; Feedback Triage</>} />

      <article className="card u-mb-150">
        <p className="card-kicker">Oversight</p>
        <h2 className="card-title">Complaints</h2>
        <nav aria-label="Complaints by Status" className="pill-list complaint-tabs u-mb-100">
          {TABS.map((status) => (
            <a
              key={status}
              className="pill"
              href={pagingHref(COMPLAINTS_PATH, search, {
                status: TAB_PARAM[status],
                before: null,
              })}
              aria-current={status === tab ? 'page' : undefined}
            >
              {complaintStatusLabel(status)}
              {data.counts ? ` (${data.counts[status]})` : ''}
            </a>
          ))}
        </nav>
        {moved ? (
          <output className="notice notice-ok u-mb-100">
            {`Complaint moved to ${complaintStatusLabel(moved)}. It is listed on this tab now.`}
          </output>
        ) : null}
        {data.complaints.length === 0 ? (
          before ? (
            <QueuePastEnd
              pathname={COMPLAINTS_PATH}
              search={search}
              param="before"
              landOn={COMPLAINTS_LIST}
              what="No older complaints here."
            />
          ) : (
            <p className="card-body">
              {data.counts === null
                ? 'Complaints could not be loaded. Try again in a moment.'
                : EMPTY_TAB[tab]}
            </p>
          )
        ) : (
          <>
            <QueuePanel
              id={COMPLAINTS_LIST}
              label="Complaints"
              pageKey={`${tab}:${before ?? 'first'}`}
              items={data.complaints.map((c) => ({
                id: c.id,
                className: 'complaint-row',
                find: `Case ${c.missionId} ${c.description} ${c.resolution ?? ''}`,
                node: (
                  <>
                    <div className="complaint-row-head">
                      <span className="row-key">Case {c.missionId}</span>
                      <span className={`badge ${STATUS_TONE[c.status] ?? 'badge-neutral'}`}>
                        {complaintStatusLabel(c.status)}
                      </span>
                    </div>
                    <p className="muted complaint-row-text">{c.description}</p>
                    {c.resolution ? (
                      <p className="muted complaint-row-text">Resolution: {c.resolution}</p>
                    ) : null}
                    <p className="muted u-fs-075-m0">
                      Filed {formatTimestampDate(c.createdAt)}
                      {c.ownerAccountId ? ` · Assigned to ${c.ownerAccountId}` : ' · Unassigned'}
                    </p>
                    {!TERMINAL_STATUSES.has(c.status) ? (
                      <details className="complaint-actions">
                        <summary>Assign or Update</summary>
                        <div className="stack-sm">
                          <AssignComplaintForm complaintId={c.id} />
                          <UpdateComplaintStatusForm complaintId={c.id} currentStatus={c.status} />
                        </div>
                      </details>
                    ) : null}
                  </>
                ),
              }))}
            />
            <QueuePaging
              pathname={COMPLAINTS_PATH}
              search={search}
              param="before"
              cursor={data.complaintsNext}
              later={before !== undefined}
              landOn={COMPLAINTS_LIST}
              shown={data.complaints.length}
              total={data.counts?.[tab] ?? data.complaints.length}
              noun={{ one: 'complaint', other: 'complaints' }}
            />
          </>
        )}
      </article>

      {data.canViewFeedback ? (
        <article className="card">
          <p className="card-kicker">Oversight</p>
          <h2 className="card-title">Private Feedback</h2>
          <p className="card-body u-mb-100">
            Never visible to the agency being reviewed, and never a public review or ranking.
          </p>
          {data.feedback.length === 0 ? (
            feedbackBefore ? (
              <QueuePastEnd
                pathname={COMPLAINTS_PATH}
                search={search}
                param="feedbackBefore"
                landOn={FEEDBACK_PANEL}
                what="No older feedback."
              />
            ) : (
              <p className="card-body">No feedback submitted platform-wide.</p>
            )
          ) : (
            <>
              <QueuePanel
                id={FEEDBACK_PANEL}
                label="Private Feedback Entries"
                pageKey={feedbackBefore ?? 'first'}
                items={data.feedback.map((f) => ({
                  id: f.id,
                  className: 'feedback-row',
                  find: `Case ${f.missionId} ${f.comments}`,
                  node: (
                    <>
                      <span className="row-key">Case {f.missionId}</span>
                      <span className="u-fs-085">{f.comments}</span>
                      <span className="muted u-fs-075">{formatTimestampDate(f.createdAt)}</span>
                    </>
                  ),
                }))}
              />
              <QueuePaging
                pathname={COMPLAINTS_PATH}
                search={search}
                param="feedbackBefore"
                cursor={data.feedbackNext}
                later={feedbackBefore !== undefined}
                landOn={FEEDBACK_PANEL}
                shown={data.feedback.length}
                total={data.feedbackTotal}
                noun={{ one: 'feedback entry', other: 'feedback entries' }}
              />
            </>
          )}
        </article>
      ) : null}
    </section>
  );
}
