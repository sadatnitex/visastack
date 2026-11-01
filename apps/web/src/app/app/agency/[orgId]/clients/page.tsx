import { isAcceptableInvitationContact } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CollapsibleGroup } from '../../../../../components/collapsible-group';
import { ReferenceCode } from '../../../../../components/reference-code';
import { ShowMore } from '../../../../../components/show-more';
import { EmptyState } from '../../../../../components/ui';
import { formatDateOnly, formatTimestampDate } from '../../../../../lib/format-date';
import { evidenceDocumentGroups, evidenceFieldGroups } from '../../../../../lib/master-profile';
import {
  type SearchParamsRecord,
  firstParam,
  pagingHref,
  parseCursor,
} from '../../../../../lib/paging';
import { withSession } from '../../../../../lib/session';
import { ClientInvitationForm } from '../client-invitation-form';
import { ClientInvitationRevokeButton } from '../client-invitation-revoke-button';
import {
  REQUEST_VIEWS,
  type RequestViewKey,
  loadApplicants,
  loadEvidenceRequestPage,
  loadMembers,
  loadOrgAccess,
  loadPendingClientInvitationPage,
  loadVisibleCaseList,
} from '../console-data';
import { EVIDENCE_DECIDABLE_STATUSES, REQ_STATUS } from '../console-format';
import { requestItemLabel } from '../do-next';
import { EvidenceRequestActions } from '../evidence-request-actions';
import { RequestEvidenceForm } from '../request-evidence-form';

export const metadata: Metadata = { title: 'Agency Clients' };

export const dynamic = 'force-dynamic';

/** The address parameters this page reads. */
const INVITES_BEFORE_KEY = 'invitesBefore';
const REQUESTS_BEFORE_KEY = 'requestsBefore';
const STATUS_KEY = 'status';

/**
 * Clients: inviting a traveller as a client, asking an applicant for evidence,
 * and following those requests (Commercial V1 Part 9 UX-01). Administrator work:
 * anyone else gets a plain explanation and none of this data is read for them.
 *
 * Scroll Budget WP-SB5: pending invitations and requests show 15 at a time with Show More, the
 * requests by status view, and the two forms open from their own headings.
 */
export default async function AgencyClientsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orgId: string }>;
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  const { orgId } = await params;
  const query: SearchParamsRecord = (await searchParams) ?? {};
  const invitesBefore = parseCursor(query[INVITES_BEFORE_KEY]);
  const requestsBefore = parseCursor(query[REQUESTS_BEFORE_KEY]);
  const statusParam = firstParam(query[STATUS_KEY]);
  const view: RequestViewKey | undefined = REQUEST_VIEWS.find((v) => v.key === statusParam)?.key;

  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    if (!access?.member) return null;
    if (!access.admin) return { admin: false as const };
    const members = await loadMembers(db, accountId, orgId, access);
    const [clientInvitations, requests, applicants, cases] = await Promise.all([
      loadPendingClientInvitationPage(db, accountId, orgId, access, { before: invitesBefore }),
      loadEvidenceRequestPage(db, accountId, orgId, access, { view, before: requestsBefore }),
      loadApplicants(db, orgId, access),
      loadVisibleCaseList(db, accountId, orgId),
    ]);
    return { admin: true as const, members, clientInvitations, requests, applicants, cases };
  });
  if (!data) return null;

  if (!data.admin) {
    return (
      <article className="card">
        <p className="card-body">
          Inviting clients and requesting evidence are limited to this organization's owners and
          admins.
        </p>
      </article>
    );
  }

  const pathname = `/app/agency/${orgId}/clients`;
  const invitations = data.clientInvitations;
  const requests = data.requests;
  const viewHref = (key: RequestViewKey | null) =>
    pagingHref(
      pathname,
      query,
      { [STATUS_KEY]: key, [REQUESTS_BEFORE_KEY]: null },
      'agency-evidence-requests',
    );

  return (
    <>
      <article className="card u-mb-150">
        <p className="card-kicker">Intake</p>
        <h2 className="card-title">Clients</h2>
        <p className="card-body u-mb-125">
          Invite a traveller as a new client. They alone choose which of their own traveller
          profiles the resulting case attaches to, and their acceptance is what actually grants this
          organization access, never the invitation itself.
        </p>
        {invitations.total > 0 ? (
          <>
            <div className="rows u-mb-100" id="client-invitation-list">
              {invitations.items.map((invitation) => (
                <div className="row" key={invitation.id}>
                  <span className="row-key">
                    {invitation.displayName}
                    <span
                      className="muted"
                      style={{ fontSize: 'var(--text-small)', marginLeft: '0.5rem' }}
                    >
                      {invitation.contactDestination}
                    </span>
                  </span>
                  <span className="row-end">
                    {!isAcceptableInvitationContact(invitation.contactDestination) ? (
                      // Saved without a valid email address before invitations became email-only:
                      // nobody can accept it.
                      <span className="badge badge-danger">
                        Cannot be accepted &middot; revoke and invite again by email
                      </span>
                    ) : new Date(invitation.expiresAt).getTime() < Date.now() ? (
                      <span className="badge badge-neutral">
                        Expired {formatTimestampDate(invitation.expiresAt)} &middot; invite again
                      </span>
                    ) : (
                      <span className="badge badge-warning">
                        Invited &middot; expires {formatTimestampDate(invitation.expiresAt)}
                      </span>
                    )}
                    <ClientInvitationRevokeButton
                      organizationId={orgId}
                      invitationId={invitation.id}
                    />
                  </span>
                </div>
              ))}
            </div>
            <ShowMore
              id="client-invitation-more"
              landOn="client-invitation-list"
              pathname={pathname}
              searchParams={query}
              next={
                invitations.nextCursor ? { [INVITES_BEFORE_KEY]: invitations.nextCursor } : null
              }
              shown={invitations.items.length}
              total={invitations.total}
              noun={{ one: 'pending invitation', other: 'pending invitations' }}
            />
            {invitesBefore ? (
              <p className="u-mt-050">
                <Link
                  href={pagingHref(
                    pathname,
                    query,
                    { [INVITES_BEFORE_KEY]: null },
                    'client-invitation-list',
                  )}
                >
                  Back to the Newest Invitations
                </Link>
              </p>
            ) : null}
          </>
        ) : (
          <div className="u-mb-150">
            <EmptyState
              icon="users"
              title="No Clients Invited Yet"
              why="You see each client's progress here once they accept."
              action={{ href: '#invite-client', label: 'Invite a Client' }}
            >
              This is where you invite the people you help. Each one gets a link, creates their
              file, and chooses what to share with you. Start with the form below.
            </EmptyState>
          </div>
        )}
        {/* Opens on its own while nobody is invited yet, and for a link to #invite-client. */}
        <CollapsibleGroup id="invite-client" title="Invite a Client" open={invitations.total === 0}>
          <ClientInvitationForm
            pendingInvitationIds={invitations.items.map((invitation) => invitation.id)}
            organizationId={orgId}
            members={data.members.map((m) => ({
              accountId: m.accountId,
              email: m.email,
              active: m.active,
            }))}
          />
        </CollapsibleGroup>
      </article>

      <article className="card u-mb-150">
        <p className="card-kicker">Collect</p>
        <h2 className="card-title">Request Evidence</h2>
        <p className="card-body u-mb-125">
          Ask a traveller for a specific field or document. They decide whether to fulfil it.
        </p>
        {/* Opens on its own while no request exists yet, and for a link to #ask-for-evidence. */}
        <CollapsibleGroup
          id="ask-for-evidence"
          title="Ask for a Field or Document"
          open={requests.viewCounts.all === 0}
        >
          <RequestEvidenceForm
            organizationId={orgId}
            fieldGroups={evidenceFieldGroups()}
            documentGroups={evidenceDocumentGroups()}
            applicants={data.applicants}
            missions={data.cases.map((m) => ({
              missionId: m.missionId,
              title: m.title,
              applicantName: m.applicantName,
            }))}
          />
        </CollapsibleGroup>
      </article>

      <article className="card">
        <p className="card-kicker">Activity</p>
        <h2 className="card-title" id="agency-evidence-requests">
          Evidence Requests
        </h2>
        {requests.viewCounts.all === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No Evidence Requests Yet"
            why="Clients reply from their own documents, so you get the right paper without chasing."
            action={{ href: '#ask-for-evidence', label: 'Request Evidence' }}
          >
            This is where you ask a client for a specific document or detail. You will see here when
            it arrives and when it is overdue.
          </EmptyState>
        ) : (
          <>
            <nav className="quick-views u-mt-050" aria-label="Evidence requests by status">
              <Link
                href={viewHref(null)}
                className={`quick-view${view ? '' : ' quick-view-on'}`}
                aria-current={view ? undefined : 'true'}
              >
                All <span className="muted">{requests.viewCounts.all}</span>
              </Link>
              {REQUEST_VIEWS.map((option) => (
                <Link
                  key={option.key}
                  href={viewHref(option.key)}
                  className={`quick-view${view === option.key ? ' quick-view-on' : ''}`}
                  aria-current={view === option.key ? 'true' : undefined}
                >
                  {option.label} <span className="muted">{requests.viewCounts[option.key]}</span>
                </Link>
              ))}
            </nav>
            {requests.items.length === 0 ? (
              <p className="card-body u-mt-100">No requests in this view.</p>
            ) : (
              <div className="rows u-mt-050" id="agency-evidence-request-list">
                {requests.items.map((req) => {
                  const rb = REQ_STATUS[req.status] ?? {
                    label: req.status,
                    tone: 'badge-neutral',
                  };
                  const target = requestItemLabel(req);
                  return (
                    <div
                      className="row"
                      key={req.id}
                      // Do Next links straight to a request waiting for review.
                      id={`request-${req.id}`}
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                        }}
                      >
                        <span className="row-key">
                          {req.kind === 'FIELD' ? 'Field' : 'Document'}: {target}
                        </span>
                        <span className={`badge ${rb.tone}`}>{rb.label}</span>
                      </div>
                      <span className="muted u-fs-085">
                        {req.applicantName}
                        {req.dueDate ? ` · due ${formatDateOnly(req.dueDate)}` : ''}
                      </span>
                      <ReferenceCode code={req.referenceCode} label="Request Reference" />
                      {EVIDENCE_DECIDABLE_STATUSES.has(req.status) ? (
                        <EvidenceRequestActions
                          organizationId={orgId}
                          requestId={req.id}
                          status={req.status}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            <ShowMore
              id="agency-evidence-request-more"
              landOn="agency-evidence-request-list"
              pathname={pathname}
              searchParams={query}
              next={requests.nextCursor ? { [REQUESTS_BEFORE_KEY]: requests.nextCursor } : null}
              shown={requests.items.length}
              total={requests.total}
              noun={{ one: 'request', other: 'requests' }}
            />
            {requestsBefore ? (
              <p className="u-mt-050">
                <Link
                  href={pagingHref(
                    pathname,
                    query,
                    { [REQUESTS_BEFORE_KEY]: null },
                    'agency-evidence-requests',
                  )}
                >
                  Back to the Newest Requests
                </Link>
              </p>
            ) : null}
          </>
        )}
        <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '1rem' }}>
          Each request belongs to a case. To work on a case, open it in{' '}
          <Link href={`/app/agency/${orgId}/cases`}>Cases</Link>.
        </p>
      </article>
    </>
  );
}
