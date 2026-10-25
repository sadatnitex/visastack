import { getApplicant, hasConsent, listMissions } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader, StatusBadge } from '../../../../../components/ui';
import { humanizeCode } from '../../../../../lib/format-code';
import { withSession } from '../../../../../lib/session';
import { CreateMissionForm } from './create-mission-form';

export const metadata: Metadata = { title: 'Cases' };

export const dynamic = 'force-dynamic';

const STATE_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  INTAKE: 'Intake',
  IN_REVIEW: 'In Review',
  AWAITING_APPLICANT: 'Awaiting Applicant',
  SUBMISSION_READY: 'Submission Ready',
  SUBMITTED: 'Submitted',
  IN_PROGRESS: 'In Progress',
  READY_FOR_REVIEW: 'Ready for Review',
  UNDER_REVIEW: 'Under Review',
  READY_TO_EXPORT: 'Ready to Export',
  LOCKED: 'Locked',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export default async function MissionsPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [missions, coreGranted] = await Promise.all([
      listMissions(db, accountId, id),
      hasConsent(db, accountId, 'CORE_PROCESSING'),
    ]);
    return { applicant, missions: missions.ok ? missions.value : [], coreGranted };
  });

  if (!data) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Cases"
        title="Visa Cases"
        description="A case assembles this applicant's evidence against a published requirement pack."
        as="h2"
      />

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Your Cases</p>
          <h2 className="card-title">Active &amp; Past</h2>
          {data.missions.length === 0 ? (
            <EmptyState icon="briefcase" title="No Cases Yet">
              A case checks this person's documents against the requirements of one visa route.
              Start one on the right.
            </EmptyState>
          ) : (
            <div className="rows u-mt-050">
              {data.missions.map((mission) => (
                <Link className="row row-link" key={mission.id} href={`/app/mission/${mission.id}`}>
                  <span className="row-key">{mission.title}</span>
                  <span className="row-end">
                    <StatusBadge tone="neutral">
                      {STATE_LABELS[mission.state] ?? humanizeCode(mission.state)}
                    </StatusBadge>
                    <span className="muted" aria-hidden="true">
                      →
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">New</p>
          <h2 className="card-title">Start a Case</h2>
          {data.coreGranted ? (
            <CreateMissionForm applicantId={id} />
          ) : (
            <p className="card-body">
              Turn on <strong>Let VisaStack Process My Details</strong> on Home to create cases.
            </p>
          )}
        </article>
      </div>
    </>
  );
}
