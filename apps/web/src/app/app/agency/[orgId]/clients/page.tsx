import { isAcceptableInvitationContact, isUuid } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ReferenceCode } from '../../../../../components/reference-code';
import { EmptyState } from '../../../../../components/ui';
import { AboutDisclosure, SectionCard } from '../../../../../components/ui-lift';
import { formatDateOnly, formatTimestampDate } from '../../../../../lib/format-date';
import { type SearchParamsRecord, firstParam, pagingHref } from '../../../../../lib/paging';
import { buildRequestPicker } from '../../../../../lib/request-picker';
import { withSession } from '../../../../../lib/session';
import { ListPager } from '../cases/list-pager';
import { type ListKeys, listWindow } from '../cases/list-window';
import { ClientInvitationForm } from '../client-invitation-form';
import { ClientInvitationRevokeButton } from '../client-invitation-revoke-button';
import {
  AGENCY_LIST_SIZES,
  type EvidenceRequestRow,
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
import { EvidenceCopies, waitingCopy } from '../evidence-copies';
import {
  COPIES_STATUSES,
  type EvidenceCopies as EvidenceCopiesData,
  loadEvidenceCopies,
} from '../evidence-copies-data';
import { EvidenceRequestActions } from '../evidence-request-actions';
import { RequestEvidenceForm } from '../request-evidence-form';
import { FormGroup } from './form-group';
import { OpenRequestFromLink } from './open-request-from-link';

export const metadata: Metadata = { title: 'Agency Clients' };

export const dynamic = 'force-dynamic';

/** The address parameters this page reads. */
const INVITE_KEYS: ListKeys = { show: 'invites', before: 'invitesBefore', from: 'invitesFrom' };
const REQUEST_KEYS: ListKeys = {
  show: 'requests',
  before: 'requestsBefore',
  from: 'requestsFrom',
};
/**
 * Requests on this page grow 10 at a time (WP-SB11, was 15 like the other agency lists): with the
 * invitations folded, 10 request rows keep the page within 3 screens on a phone.
 */
const REQUEST_SIZES = { step: 10, max: 90 } as const;
const STATUS_KEY = 'status';
/** One request a link points at (Do Next, the workspace search), shown first when off the page. */
const REQUEST_KEY = 'request';
/** Set by the sent-file download when the file could not be opened. */
const FILE_KEY = 'file';

/**
 * Clients: inviting a traveller as a client, asking an applicant for evidence,
 * and following those requests (Commercial V1 Part 9 UX-01). Administrator work:
 * anyone else gets a plain explanation and none of this data is read for them.
 *
 * Scroll Budget WP-SB5: pending invitations and requests show 15 at a time with Show More, the
 * requests by status view, and the two forms open from their own headings.
 *
 * WP-SB11: the pending invitations sit in their own group with their count, so the page opens on
 * one list, not two, and requests show 10 at a time (3 screens on a phone). The group opens on its own when there is no
 * request to follow yet, and when the address pages through invitations (their Show More).
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
  const invitePage = listWindow(query, INVITE_KEYS, AGENCY_LIST_SIZES);
  const requestPage = listWindow(query, REQUEST_KEYS, REQUEST_SIZES);
  const statusParam = firstParam(query[STATUS_KEY]);
  const view: RequestViewKey | undefined = REQUEST_VIEWS.find((v) => v.key === statusParam)?.key;
  const linked = firstParam(query[REQUEST_KEY]);
  const linkedId = linked && isUuid(linked) ? linked.toLowerCase() : undefined;
  // The download sends a person back here with this word when a file could not be opened.
  const fileUnavailable = firstParam(query[FILE_KEY]) === 'unavailable';
  const pagingInvitations = [INVITE_KEYS.show, INVITE_KEYS.before, INVITE_KEYS.from].some(
    (key) => firstParam(query[key]) !== undefined,
  );

  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    if (!access?.member) return null;
    if (!access.admin) return { admin: false as const };
    const members = await loadMembers(db, accountId, orgId, access);
    const [clientInvitations, newestInvitations, requests, linkedRequest, applicants, cases] =
      await Promise.all([
        loadPendingClientInvitationPage(db, accountId, orgId, access, {
          limit: invitePage.limit,
          before: invitePage.before,
        }),
        // On an older page, the newest invitations are read too: an invitation just created is
        // among them, so the form keeps showing its link while it is still pending.
        invitePage.before
          ? loadPendingClientInvitationPage(db, accountId, orgId, access, {
              limit: AGENCY_LIST_SIZES.step,
            })
          : Promise.resolve(null),
        loadEvidenceRequestPage(db, accountId, orgId, access, {
          view,
          limit: requestPage.limit,
          before: requestPage.before,
        }),
        linkedId
          ? loadEvidenceRequestPage(db, accountId, orgId, access, { limit: 1, only: linkedId })
          : Promise.resolve(null),
        loadApplicants(db, orgId, access),
        loadVisibleCaseList(db, accountId, orgId),
      ]);
    // The exact copies sent for every document request shown, so a reviewer decides on a copy
    // they were shown. Read through the organization's own proof, request by request.
    const shownRequests = [...(linkedRequest?.items ?? []), ...requests.items];
    const copies = await loadEvidenceCopies(db, accountId, orgId, shownRequests);
    const pendingInvitationIds = [
      ...new Set(
        [...clientInvitations.items, ...(newestInvitations?.items ?? [])].map((i) => i.id),
      ),
    ];
    return {
      admin: true as const,
      members,
      clientInvitations,
      pendingInvitationIds,
      requests,
      copies,
      // Shown first only when the list on this page does not already hold it.
      linkedRequest: requests.items.some((r) => r.id === linkedRequest?.items[0]?.id)
        ? null
        : (linkedRequest?.items[0] ?? null),
      applicants,
      cases,
    };
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
      {
        [STATUS_KEY]: key,
        [REQUEST_KEYS.show]: null,
        [REQUEST_KEYS.before]: null,
        [REQUEST_KEYS.from]: null,
      },
      'agency-evidence-requests',
    );

  return (
    <>
      <OpenRequestFromLink />
      <div className="agency-add-card lc-empty-host">
        <SectionCard heading="Add People and Requests">
          <section className="agency-add-part" aria-labelledby="agency-add-clients">
            <p className="card-kicker">Intake</p>
            <h3 className="agency-add-title" id="agency-add-clients">
              Clients
            </h3>
            <AboutDisclosure summary="About Invitations">
              <p className="card-body">
                Invite a traveller as a new client. They alone choose which of their own traveller
                profiles the resulting case attaches to, and their acceptance is what actually
                grants this organization access, never the invitation itself.
              </p>
            </AboutDisclosure>
            {invitations.total > 0 ? (
              // Keeps the state it first opened with across this page's own links (Show More, Back to
              // the Newest Invitations), so a link into the list never folds it shut.
              <FormGroup
                id="client-invitations"
                title="Pending Invitations"
                icon="mail"
                count={invitations.total}
                noun={{ one: 'pending invitation', other: 'pending invitations' }}
                openAtFirst={pagingInvitations || requests.viewCounts.all === 0}
              >
                <div className="rows u-mb-100" id="client-invitation-list">
                  {invitations.items.map((invitation) => (
                    <div className="row" key={invitation.id}>
                      <span className="row-key">
                        {invitation.displayName}
                        <span className="muted lc-invite-contact">
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
                            Expired {formatTimestampDate(invitation.expiresAt)} &middot; invite
                            again
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
                <ListPager
                  id="client-invitation-more"
                  landOn="client-invitation-list"
                  pathname={pathname}
                  query={query}
                  keys={INVITE_KEYS}
                  sizes={AGENCY_LIST_SIZES}
                  window={invitePage}
                  shown={invitations.items.length}
                  total={invitations.total}
                  nextCursor={invitations.nextCursor}
                  noun={{ one: 'pending invitation', other: 'pending invitations' }}
                  newestLabel="Back to the Newest Invitations"
                />
              </FormGroup>
            ) : (
              <div className="u-mb-150">
                <EmptyState
                  icon="users"
                  title="No Clients Invited Yet"
                  fold
                  why="You see each client's progress here once they accept."
                  action={{ href: '#invite-client', label: 'Invite a Client' }}
                >
                  This is where you invite the people you help. Each one gets a link, creates their
                  file, and chooses what to share with you. Start with the form below.
                </EmptyState>
              </div>
            )}
            {/* Opens on its own while nobody is invited yet, and for a link to #invite-client. */}
            <FormGroup
              id="invite-client"
              title="Invite a Client"
              icon="users"
              openAtFirst={invitations.total === 0}
            >
              <ClientInvitationForm
                pendingInvitationIds={data.pendingInvitationIds}
                organizationId={orgId}
                members={data.members.map((m) => ({
                  accountId: m.accountId,
                  email: m.email,
                  active: m.active,
                }))}
              />
            </FormGroup>
          </section>

          <section className="agency-add-part" aria-labelledby="agency-add-evidence">
            <p className="card-kicker">Collect</p>
            <h3 className="agency-add-title" id="agency-add-evidence">
              Request Evidence
            </h3>
            <p className="muted u-fs-085">For people who are already your clients.</p>
            <AboutDisclosure summary="About Requests">
              <p className="card-body">
                Ask a traveller for a specific detail or document. They decide whether to fulfil it.
              </p>
            </AboutDisclosure>
            {/* Opens on its own while no request exists yet, and for a link to #ask-for-evidence. */}
            <FormGroup
              id="ask-for-evidence"
              title="Ask for a Document or Detail"
              icon="clipboard"
              openAtFirst={requests.viewCounts.all === 0}
            >
              <RequestEvidenceForm
                organizationId={orgId}
                picker={buildRequestPicker()}
                applicants={data.applicants}
                missions={data.cases.map((m) => ({
                  missionId: m.missionId,
                  title: m.title,
                  applicantName: m.applicantName,
                }))}
              />
            </FormGroup>
          </section>
        </SectionCard>
      </div>

      <article className="card lc-empty-host">
        <p className="card-kicker">Activity</p>
        <h2 className="card-title" id="agency-evidence-requests">
          Evidence Requests
        </h2>
        {requests.viewCounts.all === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No Evidence Requests Yet"
            fold
            why="Clients reply from their own documents, so you get the right paper without chasing."
            action={{ href: '#ask-for-evidence', label: 'Request Evidence' }}
          >
            This is where you ask a client for a specific document or detail. You will see here when
            it arrives and when it is overdue.
          </EmptyState>
        ) : (
          <>
            <nav
              className="quick-views lift-segments u-mt-050"
              aria-label="Evidence requests by status"
            >
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
            {data.linkedRequest ? (
              <div className="rows u-mt-050" aria-label="The request you followed a link to">
                <RequestRow
                  orgId={orgId}
                  req={data.linkedRequest}
                  copies={data.copies.get(data.linkedRequest.id)}
                  fileUnavailable={fileUnavailable && linkedId === data.linkedRequest.id}
                />
              </div>
            ) : null}
            {requests.items.length === 0 ? (
              <p className="card-body u-mt-100">No requests in this view.</p>
            ) : (
              <>
                <div className="rows u-mt-050" id="agency-evidence-request-list">
                  {requests.items.map((req) => (
                    <RequestRow
                      key={req.id}
                      orgId={orgId}
                      req={req}
                      copies={data.copies.get(req.id)}
                      fileUnavailable={fileUnavailable && linkedId === req.id}
                    />
                  ))}
                </div>
                <ListPager
                  id="agency-evidence-request-more"
                  landOn="agency-evidence-request-list"
                  pathname={pathname}
                  query={query}
                  keys={REQUEST_KEYS}
                  sizes={REQUEST_SIZES}
                  window={requestPage}
                  shown={requests.items.length}
                  total={requests.total}
                  nextCursor={requests.nextCursor}
                  noun={{ one: 'request', other: 'requests' }}
                  newestLabel="Back to the Newest Requests"
                />
              </>
            )}
          </>
        )}
        <AboutDisclosure summary="About Cases">
          <p className="muted lc-small-note">
            Each request belongs to a case. To work on a case, open it in{' '}
            <Link href={`/app/agency/${orgId}/cases`}>Cases</Link>.
          </p>
        </AboutDisclosure>
      </article>
    </>
  );
}

/** One evidence request: what is asked, its status, who for, its code, the copy sent and any decision due. */
function RequestRow({
  orgId,
  req,
  copies,
  fileUnavailable,
}: {
  readonly orgId: string;
  readonly req: EvidenceRequestRow;
  /** The sent copies read for this request; undefined when they could not be read (or none apply). */
  readonly copies: EvidenceCopiesData | undefined;
  readonly fileUnavailable: boolean;
}) {
  const rb = REQ_STATUS[req.status] ?? { label: req.status, tone: 'badge-neutral' };
  const target = requestItemLabel(req);
  // A document request with something sent shows that exact copy. If it could not be read, no
  // decision is offered on it (withdrawing the request still is).
  const hasCopies = req.kind === 'DOCUMENT' && COPIES_STATUSES.has(req.status);
  const waiting = waitingCopy(copies?.list, req.status);
  return (
    <div
      className="row request-row"
      // Do Next links straight to a request waiting for review.
      id={`request-${req.id}`}
    >
      <div className="request-row-head">
        <span className="row-key">
          {req.kind === 'FIELD' ? 'Field' : 'Document'}: {target}
        </span>
        <span className={`badge ${rb.tone}${req.status === 'RECEIVED' ? ' lift-pill-info' : ''}`}>
          {rb.label}
        </span>
      </div>
      <span className="muted u-fs-085">
        {req.applicantName}
        {req.dueDate ? ` · due ${formatDateOnly(req.dueDate)}` : ''}
      </span>
      <ReferenceCode code={req.referenceCode} label="Request Reference" />
      {hasCopies ? (
        <EvidenceCopies
          organizationId={orgId}
          requestId={req.id}
          status={req.status}
          copies={copies}
          fileUnavailable={fileUnavailable}
        />
      ) : null}
      {EVIDENCE_DECIDABLE_STATUSES.has(req.status) ? (
        <EvidenceRequestActions
          organizationId={orgId}
          requestId={req.id}
          status={req.status}
          submissionId={waiting?.id}
          canDecide={!hasCopies || copies !== undefined}
        />
      ) : null}
    </div>
  );
}
