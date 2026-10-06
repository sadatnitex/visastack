import type { Metadata } from 'next';
import Link from 'next/link';
import { profileField } from '../../../../../lib/profile-fields';
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

export const metadata: Metadata = { title: 'Agency clients' };

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
      <article className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="card-kicker">Intake</p>
        <h2 className="card-title">Clients</h2>
        <p className="card-body" style={{ marginBottom: '1.25rem' }}>
          Invite a traveller as a new client. They alone choose which of their own applicant
          profiles the resulting case attaches to, and their acceptance is what actually grants this
          organization access, never the invitation itself.
        </p>
        {data.clientInvitations.length > 0 ? (
          <div className="rows" style={{ marginBottom: '1.5rem' }}>
            {data.clientInvitations.map((invitation) => (
              <div className="row" key={invitation.id}>
                <span className="row-key">
                  {invitation.displayName}
                  <span className="muted" style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                    {invitation.contactDestination}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span className="badge badge-warning">
                    Invited &middot; expires {new Date(invitation.expiresAt).toLocaleDateString()}
                  </span>
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

      <article className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="card-kicker">Collect</p>
        <h2 className="card-title">Request evidence</h2>
        <p className="card-body" style={{ marginBottom: '1.25rem' }}>
          Ask an applicant for a specific field or document. They decide whether to fulfil it.
        </p>
        <RequestEvidenceForm
          organizationId={orgId}
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
        <h2 className="card-title">Evidence requests</h2>
        {data.requests.length === 0 ? (
          <p className="card-body">No evidence requests raised yet.</p>
        ) : (
          <div className="rows" style={{ marginTop: '0.5rem' }}>
            {data.requests.map((req) => {
              const rb = REQ_STATUS[req.status] ?? {
                label: req.status,
                tone: 'badge-neutral',
              };
              const target =
                req.kind === 'FIELD'
                  ? ((req.fieldKey ? profileField(req.fieldKey)?.label : undefined) ?? req.fieldKey)
                  : req.docType;
              return (
                <div
                  className="row"
                  key={req.id}
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
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {req.applicantName}
                    {req.dueDate ? ` · due ${new Date(req.dueDate).toLocaleDateString()}` : ''}
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
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: '1rem' }}>
          Each request belongs to a case. To work on a case, open it in{' '}
          <Link href={`/app/agency/${orgId}/cases`}>Cases</Link>.
        </p>
      </article>
    </>
  );
}
