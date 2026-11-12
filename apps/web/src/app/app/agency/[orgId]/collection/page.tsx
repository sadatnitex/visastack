import { formatNumber } from '@visastack/i18n';
import {
  COLLECTION_LIST_LIMIT,
  COLLECTION_STATUS_LABELS,
  type CollectionAnswerSummary,
  type CollectionDisplayStatus,
  agencyCollectionPrincipal,
  listCollectionRequests,
  summariseCollectionAnswers,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DestinationLabel } from '../../../../../components/destination-label';
import { EmptyState, PageHeader, StatusBadge } from '../../../../../components/ui';
import { appAgencyCatalog } from '../../../../../i18n/app-agency';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { withSession } from '../../../../../lib/session';
import { dayLabel } from '../day-label';
import { STATUS_TONES, destinationName } from './terms';

export const metadata: Metadata = { title: 'Document Requests' };
export const dynamic = 'force-dynamic';

/** The order the status filters appear in: what is out with someone first, what is over last. */
const FILTER_ORDER: readonly CollectionDisplayStatus[] = [
  'SENT',
  'DRAFT',
  'CLOSED',
  'EXPIRED',
  'REVOKED',
];

/** The one answers filter: requests with at least one answer nobody has decided on yet. */
const WAITING_FILTER = 'waiting';

/** A list address that keeps whichever filters are on (they compose). */
function listHref(base: string, status: CollectionDisplayStatus | null, waiting: boolean): string {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (waiting) query.set('review', WAITING_FILTER);
  const text = query.toString();
  return text.length > 0 ? `${base}?${text}` : base;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What came back on one request, in the agency's words. Received is not a state here: an answer
 * nobody has decided on, or only marked Received, is Waiting for Review. Nothing at all shows a
 * dash with a spoken label.
 */
function AnswerChips({ summary }: { readonly summary: CollectionAnswerSummary | undefined }) {
  const t = getServerT(appAgencyCatalog);
  if (!summary || summary.answers === 0) {
    return (
      <>
        <span aria-hidden="true">-</span>
        <span className="sr-only">{t('appAgency.appAgencyOrgidCollectionPage.noAnswersYet')}</span>
      </>
    );
  }
  return (
    <span className="request-answers">
      <span className="request-answers-total">{plural(summary.answers, 'Answer', 'Answers')}</span>
      {summary.waiting > 0 ? (
        <StatusBadge tone="warning">
          {t('appAgency.appAgencyOrgidCollectionPage.waitingWaitingForReview', {
            waiting: summary.waiting,
          })}
        </StatusBadge>
      ) : null}
      {summary.needsCorrection > 0 ? (
        <StatusBadge tone="danger">
          {t('appAgency.appAgencyOrgidCollectionPage.needscorrectionNeedsCorrection', {
            needsCorrection: summary.needsCorrection,
          })}
        </StatusBadge>
      ) : null}
      {summary.accepted > 0 ? (
        <StatusBadge tone="success">
          {t('appAgency.appAgencyOrgidCollectionPage.acceptedAccepted', {
            accepted: summary.accepted,
          })}
        </StatusBadge>
      ) : null}
    </span>
  );
}

/**
 * Document Requests (UMPE P6): an agency asks for documents before it has a client, case or
 * account for the person. Owners and admins see every request; a member with May Request Documents
 * sees only their own (UMPE G3). Only while the switch is on; anyone else, or with the switch off,
 * gets not found. Owners and admins also see how many answers each request has and how many wait
 * for their review (UMPE UX5); a member never does, because answers are not theirs to see.
 */
export default async function CollectionRequestsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orgId: string }>;
  readonly searchParams?: Promise<{ status?: string | string[]; review?: string | string[] }>;
}) {
  const locale = await primeLocale();
  const t = getServerT(appAgencyCatalog);
  const { orgId } = await params;
  const query = await searchParams;
  const asked = query?.status;
  const loaded = await withSession(async ({ db, accountId }) => {
    const scope = await agencyCollectionPrincipal(db, accountId, orgId);
    if (!scope.ok) return null;
    const listed = await listCollectionRequests(db, scope.value);
    if (!listed.ok) return null;
    // Answers are for owners and admins only: for a member the read is not even made.
    const answers =
      scope.value.authority === 'ADMIN'
        ? await summariseCollectionAnswers(
            db,
            scope.value,
            listed.value.map((request) => request.id),
          )
        : null;
    return { requests: listed.value, answers };
  });
  if (!loaded) notFound();
  const { requests, answers } = loaded;
  const base = `/app/agency/${orgId}/collection`;
  // Only statuses that have a request get a filter; a value that is not one is ignored.
  const counts = FILTER_ORDER.map((status) => ({
    status,
    count: requests.filter((request) => request.status === status).length,
  })).filter((entry) => entry.count > 0);
  const wanted = counts.find((entry) => entry.status === asked)?.status ?? null;
  // The answers filter exists only for an owner or admin, and only while something is waiting.
  const waitingCount = answers
    ? requests.filter((request) => (answers.get(request.id)?.waiting ?? 0) > 0).length
    : 0;
  const waiting = waitingCount > 0 && query?.review === WAITING_FILTER;
  const shown = requests
    .filter((request) => !wanted || request.status === wanted)
    .filter((request) => !waiting || (answers?.get(request.id)?.waiting ?? 0) > 0);

  return (
    <div className="stack">
      <PageHeader
        title={t('appAgency.appAgencyOrgidCollectionNewPage.documentRequests')}
        description={t('appAgency.appAgencyOrgidCollectionPage.forPeopleWhoAreNotYour')}
        actions={
          <Link className="btn btn-primary" href={`${base}/new`}>
            {t('appAgency.appAgencyOrgidCollectionPage.newRequest')}
          </Link>
        }
      />
      {requests.length >= COLLECTION_LIST_LIMIT ? (
        <p className="notice notice-warn">
          {t('appAgency.appAgencyOrgidCollectionPage.showingYourNewestCollectionListLimit', {
            COLLECTION_LIST_LIMIT,
          })}
        </p>
      ) : null}
      {requests.length === 0 ? (
        <EmptyState title={t('appAgency.appAgencyOrgidCollectionPage.noDocumentRequestsYet')}>
          {t('appAgency.appAgencyOrgidCollectionPage.startOneWithNewRequestYou')}
        </EmptyState>
      ) : (
        <>
          <nav
            className="request-filters"
            aria-label={t('appAgency.appAgencyOrgidCollectionPage.showRequestsByStatus')}
          >
            <Link
              className="request-filter"
              href={listHref(base, null, waiting)}
              {...(wanted === null ? { 'aria-current': 'page' as const } : {})}
            >
              {t('appAgency.appAgencyOrgidClientsPage.all')}{' '}
              <span className="request-filter-count">{formatNumber(requests.length, locale)}</span>
            </Link>
            {counts.map((entry) => (
              <Link
                key={entry.status}
                className="request-filter"
                href={listHref(base, entry.status, waiting)}
                {...(wanted === entry.status ? { 'aria-current': 'page' as const } : {})}
              >
                {COLLECTION_STATUS_LABELS[entry.status]}{' '}
                <span className="request-filter-count">{entry.count}</span>
              </Link>
            ))}
          </nav>
          {waitingCount > 0 ? (
            <nav
              className="request-filters"
              aria-label={t('appAgency.appAgencyOrgidCollectionPage.showRequestsByAnswers')}
            >
              <Link
                className="request-filter"
                href={listHref(base, wanted, false)}
                {...(!waiting ? { 'aria-current': 'page' as const } : {})}
              >
                {t('appAgency.appAgencyOrgidCollectionPage.allAnswers')}
              </Link>
              <Link
                className="request-filter"
                href={listHref(base, wanted, true)}
                {...(waiting ? { 'aria-current': 'page' as const } : {})}
              >
                {t('appAgency.appAgencyOrgidCollectionPage.waitingForReview')}{' '}
                <span className="request-filter-count">{formatNumber(waitingCount, locale)}</span>
              </Link>
            </nav>
          ) : null}
          <table className="data-table request-table">
            <caption className="sr-only">
              {t('appAgency.appAgencyOrgidCollectionPage.documentRequestsNewestFirst')}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('appAgency.appAgencyOrgidCollectionPage.for')}</th>
                <th scope="col">
                  {t('appAgency.appAgencyOrgidCollectionCollectionForms.destination')}
                </th>
                <th scope="col">
                  {t('appAgency.appAgencyOrgidCollectionCollectionForms.purpose')}
                </th>
                <th scope="col">{t('appAgency.appAgencyOrgidCollectionPage.status')}</th>
                {answers ? (
                  <th scope="col">
                    {t('appAgency.appAgencyOrgidCollectionCollectionResponsePanel.answers')}
                  </th>
                ) : null}
                <th scope="col">{t('appAgency.appAgencyOrgidCollectionPage.created')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((request) => (
                <tr key={request.id}>
                  <td data-label={t('appAgency.appAgencyOrgidCollectionPage.for')}>
                    <Link className="request-link" href={`${base}/request?id=${request.id}`}>
                      {request.recipientNameHint ??
                        t('appAgency.appAgencyOrgidCollectionPage.notNamedYet')}
                    </Link>
                  </td>
                  <td
                    data-label={t('appAgency.appAgencyOrgidCollectionCollectionForms.destination')}
                  >
                    <DestinationLabel destination={destinationName(request.destination)} />
                  </td>
                  <td data-label={t('appAgency.appAgencyOrgidCollectionCollectionForms.purpose')}>
                    {request.purpose ??
                      t('appAgency.appAgencyOrgidCollectionCollectionForms.notSureYet')}
                  </td>
                  <td data-label={t('appAgency.appAgencyOrgidCollectionPage.status')}>
                    <StatusBadge tone={STATUS_TONES[request.status]}>
                      {COLLECTION_STATUS_LABELS[request.status]}
                    </StatusBadge>
                  </td>
                  {answers ? (
                    <td
                      data-label={t(
                        'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.answers',
                      )}
                    >
                      <AnswerChips summary={answers.get(request.id)} />
                    </td>
                  ) : null}
                  <td data-label={t('appAgency.appAgencyOrgidCollectionPage.created')}>
                    {dayLabel(request.createdAt, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {query?.review === WAITING_FILTER && answers && waitingCount === 0 ? (
            <p className="notice">
              {t('appAgency.appAgencyOrgidCollectionPage.nothingIsWaitingForReviewNow')}
            </p>
          ) : null}
          {shown.length === 0 ? (
            <p className="notice">
              {t('appAgency.appAgencyOrgidCollectionPage.noRequestsMatchBothFiltersTurn')}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
