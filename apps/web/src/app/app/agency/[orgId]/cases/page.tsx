import { summarizeCaseTriage } from '@visastack/services';
import type { Metadata } from 'next';
import { EmptyState } from '../../../../../components/ui';
import { withSession } from '../../../../../lib/session';
import { caseTriageView } from '../case-triage';
import { loadCases, loadEvidenceRequests, loadMembers, loadOrgAccess } from '../console-data';
import { MissionCollaboration } from '../mission-collaboration';

export const metadata: Metadata = { title: 'Agency Cases' };

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
    // Requests are administrator data: loadEvidenceRequests returns none for anyone else.
    const [{ cases }, requests] = await Promise.all([
      loadCases(db, accountId, orgId, members),
      loadEvidenceRequests(db, accountId, orgId, access, { withFileStates: true }),
    ]);
    return { admin: access.admin, members, cases, requests };
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
          title="No Cases Yet"
          icon="briefcase"
          {...(data.admin
            ? { action: { href: `/app/agency/${orgId}/clients`, label: 'Invite a Client' } }
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
              // Only the fields the workspace shows: a task's own time zone is used on the
              // server for due days and is not sent to the browser.
              tasks={mission.tasks.map((task) => ({
                id: task.id,
                description: task.description,
                status: task.status,
                priority: task.priority,
                assigneeAccountId: task.assigneeAccountId,
                dueDate: task.dueDate,
              }))}
              appointments={mission.appointments}
              requirements={mission.requirements}
              decisions={mission.decisions}
              issuerVerifications={mission.issuerVerifications}
              viewerAssigned={mission.viewerAssigned}
              triage={caseTriageView(
                summarizeCaseTriage({
                  missionId: mission.missionId,
                  manualMode: mission.manualMode,
                  readiness: mission.readiness,
                  decisions: mission.decisions,
                  // Belt and braces: only an administrator's requests ever reach the summary.
                  requests: data.admin ? data.requests : [],
                  documentStates: new Map(
                    data.requests.flatMap((r) =>
                      data.admin && r.respondingDocumentState !== undefined
                        ? [[r.id, r.respondingDocumentState] as const]
                        : [],
                    ),
                  ),
                }),
                {
                  requirementLabels: new Map(mission.requirements.map((r) => [r.id, r.label])),
                  requestsIncluded: data.admin,
                },
              )}
            />
          ))}
        </div>
      )}
    </article>
  );
}
