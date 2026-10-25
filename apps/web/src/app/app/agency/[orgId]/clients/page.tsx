import { isAcceptableInvitationContact } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '../../../../../components/ui';
import { formatDateOnly, formatTimestampDate } from '../../../../../lib/format-date';
import {
  evidenceDocumentGroups,
  evidenceFieldGroups,
  fieldLabel,
} from '../../../../../lib/master-profile';
import { withSession } from '../../../../../lib/session';
import { ClientInvitationForm } from '../client-invitation-form';
import { ClientInvitationRevokeButton } from '../client-invitation-revoke-button';
import {
  loadApplicants,
  loadEvidenceRequests,
  loadMembers,
  loadOrgAccess,
  loadPendingClientInvitations,
  loadVisibleCaseList,
} from '../console-data';
import { EVIDENCE_DECIDABLE_STATUSES, REQ_STATUS } from '../console-format';
import { EvidenceRequestActions } from '../evidence-request-actions';
import { RequestEvidenceForm } from '../request-evidence-form';

export const metadata: Metadata = { title: 'Agency Clients' };

export const dynamic = 'force-dynamic';

/**
 * Clients: inviting a traveller as a client, asking an applicant for evidence,
 * and following those requests (Commercial V1 Part 9 UX-01). Administrator work:
 * anyone else gets a plain explanation and none of this data is read for them.
 */
export default async function AgencyClientsPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    if (!access?.member) return null;
    if (!access.admin) return { admin: false as const };
    const members = await loadMembers(db, accountId, orgId, access);
    const [clientInvitations, requests, applicants, cases] = await Promise.all([
      loadPendingClientInvitations(db, accountId, orgId, access),
      loadEvidenceRequests(db, accountId, orgId, access),
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

  return (
    <>
      <article className="card u-mb-150">
        <p className="card-kicker">Intake</p>
        <h2 className="card-title">Clients</h2>
        <p className="card-body u-mb-125">
          Invite a traveller as a new client. They alone choose which of their own applicant
          profiles the resulting case attaches to, and their acceptance is what actually grants this
          organization access, never the invitation itself.
        </p>
        {data.clientInvitations.length > 0 ? (
          <div className="rows u-mb-150">
            {data.clientInvitations.map((invitation) => (
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
        ) : null}
        <ClientInvitationForm
          organizationId={orgId}
          members={data.members.map((m) => ({
            accountId: m.accountId,
            email: m.email,
            active: m.active,
          }))}
        />
      </article>

      <article className="card u-mb-150">
        <p className="card-kicker">Collect</p>
        <h2 className="card-title">Request Evidence</h2>
        <p className="card-body u-mb-125">
          Ask an applicant for a specific field or document. They decide whether to fulfil it.
        </p>
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
      </article>

      <article className="card">
        <p className="card-kicker">Activity</p>
        <h2 className="card-title" id="agency-evidence-requests">
          Evidence Requests
        </h2>
        {data.requests.length === 0 ? (
          <EmptyState icon="clipboard" title="No Evidence Requests Yet">
            Ask a client for a specific document or detail. You will see here when it arrives and
            when it is overdue.
          </EmptyState>
        ) : (
          <div className="rows u-mt-050">
            {data.requests.map((req) => {
              const rb = REQ_STATUS[req.status] ?? {
                label: req.status,
                tone: 'badge-neutral',
              };
              const target =
                req.kind === 'FIELD'
                  ? ((req.fieldKey ? fieldLabel(req.fieldKey) : undefined) ?? req.fieldKey)
                  : req.docType;
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
                      {req.kind === 'FIELD' ? 'Field' : 'Document'}: {target ?? '(unspecified)'}
                    </span>
                    <span className={`badge ${rb.tone}`}>{rb.label}</span>
                  </div>
                  <span className="muted u-fs-085">
                    {req.applicantName}
                    {req.dueDate ? ` · due ${formatDateOnly(req.dueDate)}` : ''}
                  </span>
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
        <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '1rem' }}>
          Each request belongs to a case. To work on a case, open it in{' '}
          <Link href={`/app/agency/${orgId}/cases`}>Cases</Link>.
        </p>
      </article>
    </>
  );
}
