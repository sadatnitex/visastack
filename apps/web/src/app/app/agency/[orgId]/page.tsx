import {
  getOrganization,
  isOrgAdmin,
  listApplicantsForOrganization,
  listAssignmentsDetailed,
  listEvidenceRequestsForOrgDetailed,
  listMissionsForOrganization,
  listNotes,
  listOrgMemberships,
} from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { profileField } from '../../../../lib/profile-fields';
import { withSession } from '../../../../lib/session';
import { toggleMemberAction } from './actions';
import { AddMemberForm } from './member-form';
import { MissionCollaboration } from './mission-collaboration';
import { RequestEvidenceForm } from './request-evidence-form';

export const dynamic = 'force-dynamic';

const ORG_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_VERIFICATION: { label: 'Pending verification', tone: 'badge-warning' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  SUSPENDED: { label: 'Suspended', tone: 'badge-danger' },
  REJECTED: { label: 'Rejected', tone: 'badge-danger' },
  CLOSED: { label: 'Closed', tone: 'badge-neutral' },
};

const REQ_STATUS: Record<string, { label: string; tone: string }> = {
  OPEN: { label: 'Open', tone: 'badge-warning' },
  FULFILLED: { label: 'Fulfilled', tone: 'badge-success' },
  DECLINED: { label: 'Declined', tone: 'badge-neutral' },
};

export default async function OrgConsolePage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const org = await getOrganization(db, orgId);
    if (!org) return null;
    const admin = await isOrgAdmin(db, accountId, orgId);
    if (!admin) {
      return { org, admin: false, requests: [], members: [], applicants: [], missions: [] };
    }
    const [requests, members, applicants, orgMissions] = await Promise.all([
      listEvidenceRequestsForOrgDetailed(db, accountId, orgId),
      listOrgMemberships(db, accountId, orgId),
      listApplicantsForOrganization(db, orgId),
      listMissionsForOrganization(db, orgId),
    ]);
    const membersResolved = members.ok ? members.value : [];
    const missions = await Promise.all(
      orgMissions.map(async (mission) => {
        const [assignments, notes] = await Promise.all([
          listAssignmentsDetailed(db, mission.missionId),
          listNotes(db, mission.missionId),
        ]);
        return {
          ...mission,
          assignments,
          notes: notes.map((n) => ({
            id: n.id,
            body: n.body,
            createdAt: n.createdAt.toISOString(),
            authorEmail:
              membersResolved.find((m) => m.accountId === n.authorAccountId)?.email ?? 'Unknown',
          })),
        };
      }),
    );
    return {
      org,
      admin: true,
      requests: requests.ok ? requests.value : [],
      members: membersResolved,
      applicants,
      missions,
    };
  });

  if (!data) notFound();

  const badge = ORG_STATUS[data.org.status] ?? { label: data.org.status, tone: 'badge-neutral' };

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/app/agency" className="muted" style={{ fontSize: '0.9rem' }}>
          ← Organizations
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Organization</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {data.org.name}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Collaboration console
          </p>
        </div>
        <span className={`badge ${badge.tone}`}>{badge.label}</span>
      </div>

      {!data.admin ? (
        <article className="card">
          <p className="card-body">
            You are a member of this organization but not an administrator. Only owners and admins
            can request evidence or export data.
          </p>
        </article>
      ) : (
        <>
          <div className="grid">
            <article className="card">
              <p className="card-kicker">Collect</p>
              <h2 className="card-title">Request evidence</h2>
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                Ask an applicant for a specific field or document. They decide whether to fulfil it.
              </p>
              <RequestEvidenceForm organizationId={orgId} applicants={data.applicants} />
            </article>

            <article className="card">
              <p className="card-kicker">Export</p>
              <h2 className="card-title">Bulk export</h2>
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                Download the profiles of every applicant who granted this organization an accepted
                export grant. Each applicant is re-checked by the policy engine at export time.
              </p>
              <a
                href={`/app/agency/${orgId}/export?purpose=agency_review`}
                className="btn btn-primary"
                download
              >
                Download bulk export
              </a>
            </article>
          </div>

          <article className="card" style={{ marginTop: '1.5rem' }}>
            <p className="card-kicker">Team</p>
            <h2 className="card-title">Members</h2>
            <p className="card-body" style={{ marginBottom: '1.25rem' }}>
              Membership is organizational bookkeeping — it never grants access to an applicant's
              records on its own. Access is always an accepted grant.
            </p>
            {data.members.length > 0 ? (
              <div className="rows" style={{ marginBottom: '1.5rem' }}>
                {data.members.map((m) => (
                  <div className="row" key={m.membershipId}>
                    <span className="row-key">
                      {m.email}
                      <span className="muted" style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                        {m.role}
                      </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span className={`badge ${m.active ? 'badge-success' : 'badge-neutral'}`}>
                        {m.active ? 'Active' : 'Inactive'}
                      </span>
                      {m.role !== 'OWNER' ? (
                        <form action={toggleMemberAction}>
                          <input type="hidden" name="organizationId" value={orgId} />
                          <input type="hidden" name="membershipId" value={m.membershipId} />
                          <input type="hidden" name="active" value={String(!m.active)} />
                          <button
                            type="submit"
                            className="btn btn-secondary"
                            style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
                          >
                            {m.active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </form>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <AddMemberForm organizationId={orgId} />
          </article>

          <article className="card" style={{ marginTop: '1.5rem' }}>
            <p className="card-kicker">Collaborate</p>
            <h2 className="card-title">Missions</h2>
            <p className="card-body" style={{ marginBottom: '1.25rem' }}>
              Assign a team member and leave case notes on any mission this organization has a grant
              for.
            </p>
            {data.missions.length === 0 ? (
              <p className="card-body">
                No missions are reachable yet — an applicant must grant this organization access to
                a specific mission.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {data.missions.map((mission) => (
                  <MissionCollaboration
                    key={mission.missionId}
                    organizationId={orgId}
                    missionId={mission.missionId}
                    title={mission.title}
                    applicantName={mission.applicantName}
                    members={data.members.map((m) => ({ accountId: m.accountId, email: m.email }))}
                    assignments={mission.assignments}
                    notes={mission.notes}
                  />
                ))}
              </div>
            )}
          </article>

          <article className="card" style={{ marginTop: '1.5rem' }}>
            <p className="card-kicker">Activity</p>
            <h2 className="card-title">Evidence requests</h2>
            {data.requests.length === 0 ? (
              <p className="card-body">No evidence requests raised yet.</p>
            ) : (
              <div className="rows" style={{ marginTop: '0.5rem' }}>
                {data.requests.map((req) => {
                  const rb = REQ_STATUS[req.status] ?? { label: req.status, tone: 'badge-neutral' };
                  const target =
                    req.kind === 'FIELD'
                      ? ((req.fieldKey ? profileField(req.fieldKey)?.label : undefined) ??
                        req.fieldKey)
                      : req.docType;
                  return (
                    <div
                      className="row"
                      key={req.id}
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' }}
                    >
                      <div
                        style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}
                      >
                        <span className="row-key">
                          {req.kind === 'FIELD' ? 'Field' : 'Document'}: {target ?? '(unspecified)'}
                        </span>
                        <span className={`badge ${rb.tone}`}>{rb.label}</span>
                      </div>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        {req.applicantName}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </>
      )}
    </section>
  );
}
