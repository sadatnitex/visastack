import {
  COLLECTION_LIST_LIMIT,
  COLLECTION_STATUS_LABELS,
  type CollectionDisplayStatus,
  agencyCollectionPrincipal,
  listCollectionRequests,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader, StatusBadge } from '../../../../../components/ui';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { withSession } from '../../../../../lib/session';
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

/**
 * Document Requests (UMPE P6): an agency asks for documents before it has a client, case or
 * account for the person. Owners and admins see every request; a member with May Request Documents
 * sees only their own (UMPE G3). Only while the switch is on; anyone else, or with the switch off,
 * gets not found.
 */
export default async function CollectionRequestsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orgId: string }>;
  readonly searchParams?: Promise<{ status?: string | string[] }>;
}) {
  const { orgId } = await params;
  const asked = (await searchParams)?.status;
  const requests = await withSession(async ({ db, accountId }) => {
    const scope = await agencyCollectionPrincipal(db, accountId, orgId);
    if (!scope.ok) return null;
    const listed = await listCollectionRequests(db, scope.value);
    return listed.ok ? listed.value : null;
  });
  if (!requests) notFound();
  const base = `/app/agency/${orgId}/collection`;
  // Only statuses that have a request get a filter; a value that is not one is ignored.
  const counts = FILTER_ORDER.map((status) => ({
    status,
    count: requests.filter((request) => request.status === status).length,
  })).filter((entry) => entry.count > 0);
  const wanted = counts.find((entry) => entry.status === asked)?.status ?? null;
  const shown = wanted ? requests.filter((request) => request.status === wanted) : requests;

  return (
    <div className="stack">
      <PageHeader
        title="Document Requests"
        description="Ask someone for documents before they are your client. Nothing is shared until they choose to respond."
        actions={
          <Link className="btn btn-primary" href={`${base}/new`}>
            New Request
          </Link>
        }
      />
      {requests.length >= COLLECTION_LIST_LIMIT ? (
        <p className="notice notice-warn">
          Showing your newest {COLLECTION_LIST_LIMIT} requests, and the filters and counts below
          cover only these. Close requests you no longer need.
        </p>
      ) : null}
      {requests.length === 0 ? (
        <EmptyState title="No Document Requests Yet">
          Start one with New Request. You can issue it as a private link or by email.
        </EmptyState>
      ) : (
        <>
          <nav className="request-filters" aria-label="Show requests by status">
            <Link
              className="request-filter"
              href={base}
              {...(wanted === null ? { 'aria-current': 'page' as const } : {})}
            >
              All <span className="request-filter-count">{requests.length}</span>
            </Link>
            {counts.map((entry) => (
              <Link
                key={entry.status}
                className="request-filter"
                href={`${base}?status=${entry.status}`}
                {...(wanted === entry.status ? { 'aria-current': 'page' as const } : {})}
              >
                {COLLECTION_STATUS_LABELS[entry.status]}{' '}
                <span className="request-filter-count">{entry.count}</span>
              </Link>
            ))}
          </nav>
          <table className="data-table request-table">
            <caption className="sr-only">Document Requests, Newest First</caption>
            <thead>
              <tr>
                <th scope="col">For</th>
                <th scope="col">Destination</th>
                <th scope="col">Purpose</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((request) => (
                <tr key={request.id}>
                  <td data-label="For">
                    <Link className="request-link" href={`${base}/request?id=${request.id}`}>
                      {request.recipientNameHint ?? 'Not Named Yet'}
                    </Link>
                  </td>
                  <td data-label="Destination">{destinationName(request.destination)}</td>
                  <td data-label="Purpose">{request.purpose ?? 'Not Sure Yet'}</td>
                  <td data-label="Status">
                    <StatusBadge tone={STATUS_TONES[request.status]}>
                      {COLLECTION_STATUS_LABELS[request.status]}
                    </StatusBadge>
                  </td>
                  <td data-label="Created">{formatTimestampDate(request.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
