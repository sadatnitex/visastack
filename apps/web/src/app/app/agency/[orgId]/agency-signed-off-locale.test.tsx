// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Components whose wording the owner signed off on 2026-11-12, drawn under Bengali so that every
// live Bengali message has a test that shows it.
vi.mock('./ai-actions', () => ({
  turnOffAgencyAiConnectionAction: vi.fn(async () => ({ ok: true, message: '' })),
}));
vi.mock('./actions', () => {
  const idle = vi.fn(async () => ({ ok: true, message: '' }));
  return {
    addNoteAction: idle,
    assignMemberAction: idle,
    createAppointmentForOrgAction: idle,
    createTaskForOrgAction: idle,
    decideAppointmentForOrgAction: idle,
    decideTaskForOrgAction: idle,
    recordDecisionAction: idle,
    recordIssuerVerificationAction: idle,
    unassignMemberAction: idle,
    updateTaskForOrgAction: idle,
    requestEvidenceAction: idle,
  };
});
vi.mock('./plan/invoices/actions', () => ({
  startPaymentAction: async () => ({ ok: true, message: '' }),
  checkPaymentAction: async () => ({ ok: true, message: '' }),
  submitClaimAction: async () => ({ ok: true, message: '' }),
}));

import { I18nProvider } from '../../../../components/i18n-provider';
import { appAgencyCatalog } from '../../../../i18n/app-agency';
import { fixturePicker } from '../../../../lib/master-profile-fixture';
import { AgencyAiTurnOff } from './agency-ai-turn-off';
import { MissionCollaboration } from './mission-collaboration';
import { ClaimForm } from './plan/invoices/invoice-forms';
import { RequestEvidenceForm } from './request-evidence-form';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bn = appAgencyCatalog.bn as Record<string, string>;
const en = appAgencyCatalog.en as Record<string, string>;
const P = 'appAgency.appAgencyOrgid';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = async (node: React.ReactNode) =>
  act(async () =>
    root.render(
      <I18nProvider locale="bn" pageLang="bn">
        {node}
      </I18nProvider>,
    ),
  );
const expectBengali = (key: string) => {
  expect(host.textContent, key).toContain(bn[key]);
  expect(host.textContent, key).not.toContain(en[key]);
};

describe('signed-off wording on the agency screens, under Bengali', () => {
  it('an AI connection that ended says so', async () => {
    await show(
      <AgencyAiTurnOff organizationId="o1" connectionId="c1" appLabel="Claude" live={false} />,
    );
    expectBengali(`${P}AgencyAiTurnOff.ended`);
  });

  it('the payment report form marks the note and the proof as optional', async () => {
    await show(
      <ClaimForm
        organizationId="o1"
        invoiceId="i1"
        currency="BDT"
        balance="1250.50"
        latestDate="2026-10-28"
      />,
    );
    expectBengali(`${P}PlanInvoicesInvoiceForms.noteOptional`);
    expectBengali(`${P}PlanInvoicesInvoiceForms.proofOfPaymentOptional`);
  });

  it('the evidence request form says when no traveller has granted access', async () => {
    await show(<RequestEvidenceForm organizationId="org-1" picker={fixturePicker} applicants={[]} />);
    expectBengali(`${P}RequestEvidenceForm.noTravellerHasGrantedThisOrganization`);
  });

  it('the evidence request form offers the whole traveller record by default and explains the case choice', async () => {
    await show(
      <RequestEvidenceForm
        organizationId="org-1"
        picker={fixturePicker}
        applicants={[{ applicantId: 'a-1', displayName: 'Test Applicant' }]}
        missions={[{ missionId: 'm-1', title: 'Japan Visit', applicantName: 'Test Applicant' }]}
      />,
    );
    expectBengali(`${P}RequestEvidenceForm.wholeTravellerRecordDefault`);
    expectBengali(`${P}RequestEvidenceForm.onlyIfAccessIsLimitedTo`);
  });

  it('issuer confirmations say Confirmed or Expired', async () => {
    const verification = (id: string, expired: boolean) => ({
      id,
      packRequirementId: 'req-1',
      issuerIdentity: 'Issuer',
      exactClaim: 'Claim',
      response: 'CONFIRMED',
      validUntil: '2027-01-01',
      expired,
    });
    await show(
      <MissionCollaboration
        organizationId="o1"
        missionId="m1"
        applicantId="a1"
        title="UK visit"
        applicantName="Rahim Uddin"
        viewerAssigned
        members={[]}
        assignments={[]}
        notes={[]}
        tasks={[]}
        appointments={[]}
        requirements={[{ id: 'req-1', label: 'Employment Letter' }]}
        decisions={[]}
        issuerVerifications={[verification('v1', false), verification('v2', true)]}
      />,
    );
    expectBengali(`${P}MissionCollaboration.confirmed`);
    expectBengali(`${P}MissionCollaboration.expired`);
  });
});
