import {
  COLLECTION_LIST_LIMIT,
  COLLECTION_STATUS_LABELS,
  agencyCollectionPrincipal,
  listCollectionRequests,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, StatusBadge } from '../../../../../components/ui';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { withSession } from '../../../../../lib/session';
import { STATUS_TONES, destinationName } from './terms';

export const metadata: Metadata = { title: 'Document Requests' };
export const dynamic = 'force-dynamic';

/**
 * Document Requests (UMPE P6): an agency asks for documents before it has a client, case or
 * account for the person. Owners and admins see every request; a member with May Request Documents
 * sees only their own (UMPE G3). Only while the switch is on; anyone else, or with the switch off,
 * gets not found.
 */
export default async function CollectionRequestsPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const requests = await withSession(async ({ db, accountId }) => {
    const scope = await agencyCollectionPrincipal(db, accountId, orgId);
    if (!scope.ok) return null;
    const listed = await listCollectionRequests(db, scope.value);
    return listed.ok ? listed.value : null;
  });
  if (!requests) notFound();
  const base = `/app/agency/${orgId}/collection`;

  return (
    <div className="stack">
      <header className="section-header">
        <h1 className="page-title">Document Requests</h1>
        <p className="page-description">
          Ask someone for documents before they are your client. Nothing is shared until they choose
          to respond.
        </p>
        <Link className="btn btn-primary" href={`${base}/new`}>
          New Request
        </Link>
      </header>
      {requests.length >= COLLECTION_LIST_LIMIT ? (
        <p className="notice notice-warn">
          Showing your newest {COLLECTION_LIST_LIMIT} requests. Close requests you no longer need.
        </p>
      ) : null}
      {requests.length === 0 ? (
        <EmptyState title="No Document Requests Yet">
          Start one with New Request. You can issue it as a private link or by email.
        </EmptyState>
      ) : (
        <table className="data-table">
          <caption className="sr-only">Document Requests, Newest First</caption>
          <thead>
            <tr>
              <th scope="col">Destination</th>
              <th scope="col">Purpose</th>
              <th scope="col">For</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>
                  <Link href={`${base}/request?id=${request.id}`}>
                    {destinationName(request.destination)}
                  </Link>
                </td>
                <td>{request.purpose ?? 'Not Sure Yet'}</td>
                <td>{request.recipientNameHint ?? 'Not Given'}</td>
                <td>
                  <StatusBadge tone={STATUS_TONES[request.status]}>
                    {COLLECTION_STATUS_LABELS[request.status]}
                  </StatusBadge>
                </td>
                <td>{formatTimestampDate(request.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
