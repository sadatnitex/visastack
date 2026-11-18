import { MissionCollaboration } from '../../src/app/app/agency/[orgId]/mission-collaboration';
import {
  AgencyRow,
  AgencyRows,
  InitialsPicture,
  LimitRing,
  UnlimitedPicture,
} from '../../src/app/app/agency/[orgId]/u8-rows';
import u8 from '../../src/app/app/agency/[orgId]/u8.css?inline';
import { AppointmentsPanel } from '../../src/app/app/mission/[id]/collaboration-panels';
import { ExpandableSection } from '../../src/components/ui-lift/expandable-section';

/**
 * U8: the agency screens on the Wallet foundation, on the real stylesheet. The open case's real
 * collaboration panel (its Task, Appointment and Note forms are real; their server ends are
 * stand-ins that change nothing), plus team rows and limit rows built from the same shared pieces
 * the pages use. Every name is made up. Used by e2e/wallet/u8-agency.spec.ts.
 */
export interface U8FixtureProps {
  /** Which part to draw: the open case, or the team and limit rows. */
  readonly part?: 'case' | 'rows' | 'traveller';
}

const MEMBERS = [
  { accountId: 'a1', email: 'owner@example.test' },
  { accountId: 'a2', email: 'reviewer.with.a.very.long.address.for.wrapping@example.test' },
];

export default function U8Fixture({ part = 'case' }: U8FixtureProps) {
  if (part === 'traveller') {
    return <AppointmentsPanel missionId="m1" appointments={[]} />;
  }
  if (part === 'rows') {
    return (
      <div className="u8-fixture-rows">
        <style>{u8}</style>
        <AgencyRows id="team-members" ariaLabel="Members">
          {MEMBERS.map((m) => (
            <AgencyRow
              key={m.accountId}
              title={m.email}
              picture={<InitialsPicture name={m.email} />}
              chip={{ label: 'Case Manager', tone: 'info' }}
              meta="Active"
            >
              <p className="muted u8-limit-note">{m.email}</p>
            </AgencyRow>
          ))}
        </AgencyRows>
        <AgencyRows id="plan-limits" ariaLabel="Usage">
          <ExpandableSection
            className="u8-row u8-limit"
            title="Team Members"
            picture={<LimitRing used={4} allowed={5} tone="meter-warn" />}
            summary="4 of 5 used"
          >
            <p className="muted u8-limit-note">Seats in use.</p>
          </ExpandableSection>
          <ExpandableSection
            className="u8-row u8-limit"
            title="AI Allowance"
            picture={<UnlimitedPicture />}
            summary="1 used, Unlimited"
          >
            <p className="muted u8-limit-note">Shown for your information.</p>
          </ExpandableSection>
        </AgencyRows>
      </div>
    );
  }
  return (
    <article className="card">
      <style>{u8}</style>
      <MissionCollaboration
        organizationId="o1"
        missionId="m1"
        applicantId="ap1"
        title="Japan Tourist Visa"
        referenceCode="C-1Z3Z2V"
        applicantName="Rumana Test Traveller"
        members={MEMBERS}
        assignments={[]}
        notes={[]}
        tasks={[]}
        appointments={[]}
        requirements={[]}
        decisions={[]}
        issuerVerifications={[]}
        viewerAssigned={false}
      />
    </article>
  );
}
