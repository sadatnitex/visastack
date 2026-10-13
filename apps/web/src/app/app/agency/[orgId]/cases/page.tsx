import type { Metadata } from 'next';
import { EmptyState } from '../../../../../components/ui';
import { withSession } from '../../../../../lib/session';
import { loadCases, loadMembers, loadOrgAccess } from '../console-data';
import { MissionCollaboration } from '../mission-collaboration';

export const metadata: Metadata = { title: 'Agency cases' };

export const dynamic = 'force-dynamic';

/**
 * Cases: the working view of every case this person can see, one workspace per
 * case with its team, notes, tasks, appointments, requirements, reviewer
 * decisions and issuer confirmations (Commercial V1 Part 9 UX-01). Each workspace
 * has the anchor `#mission-<id>`, which the Dashboard links to.
 */
export default async function AgencyCasesPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    // The layout explains the "no role" case; there is nothing to load for it.
    if (!access?.member) return null;
    const members = await loadMembers(db, accountId, orgId, access);
    const { cases } = await loadCases(db, accountId, orgId, members);
    return { admin: access.admin, members, cases };
  });
  if (!data) return null;

  return (
    <article className="card">
      <p className="card-kicker">Collaborate</p>
      <h2 className="card-title">Cases</h2>
      <p className="card-body u-mb-125">
        {data.admin
          ? 'Assign a team member and leave case notes on any case this organization has a grant for.'
          : "Leave case notes and record decisions on cases you're assigned to."}
      </p>
      {data.cases.length === 0 ? (
        <EmptyState
          title="No cases yet"
          icon="briefcase"
          {...(data.admin
            ? { action: { href: `/app/agency/${orgId}/clients`, label: 'Invite a client' } }
            : {})}
        >
          {data.admin
            ? 'No cases are reachable yet - an applicant must grant this organization access to a specific case.'
            : "You aren't assigned to any cases yet - ask an admin to assign you to one."}
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {data.cases.map((mission) => (
            <MissionCollaboration
              key={mission.missionId}
              organizationId={orgId}
              missionId={mission.missionId}
              applicantId={mission.applicantId}
              title={mission.title}
              applicantName={mission.applicantName}
              members={data.members.map((m) => ({ accountId: m.accountId, email: m.email }))}
              assignments={mission.assignments}
              notes={mission.notes}
              tasks={mission.tasks}
              appointments={mission.appointments}
              requirements={mission.requirements}
              decisions={mission.decisions}
              issuerVerifications={mission.issuerVerifications}
              viewerAssigned={mission.viewerAssigned}
            />
          ))}
        </div>
      )}
    </article>
  );
}
