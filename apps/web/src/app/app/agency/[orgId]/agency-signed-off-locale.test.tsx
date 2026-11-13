// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Components whose wording the owner signed off on 2026-11-12, drawn under Bengali so that every
// live Bengali message has a test that shows it.
vi.mock('./ai-actions', () => ({
  turnOffAgencyAiConnectionAction: vi.fn(async () => ({ ok: true, message: '' })),
  setAgencyAiSettingAction: vi.fn(async () => ({ ok: true, message: '' })),
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
    startEvidenceReviewAction: idle,
    cancelEvidenceRequestAction: idle,
    // A decision that arrives after the request moved on: the page asks for a refresh.
    decideEvidenceResponseAction: vi.fn(async () => ({
      ok: false,
      stale: true,
      message: 'This request changed since you opened it.',
    })),
    inviteClientAction: idle,
    updateBrandingAction: idle,
    uploadLogoAction: idle,
    removeLogoAction: idle,
  };
});
vi.mock('./collection/collection-review-actions', () => ({
  reviewAnswerAction: vi.fn(async () => ({ ok: true, message: '' })),
  guestHoldAction: vi.fn(async () => ({ ok: true, message: '' })),
}));
vi.mock('./plan/invoices/actions', () => ({
  startPaymentAction: async () => ({ ok: true, message: '' }),
  checkPaymentAction: async () => ({ ok: true, message: '' }),
  submitClaimAction: async () => ({ ok: true, message: '' }),
}));

import { I18nProvider } from '../../../../components/i18n-provider';
import { ShareOriginsProvider } from '../../../../components/share/share-origins';
import { appAgencyCatalog } from '../../../../i18n/app-agency';
import { componentsShareCatalog } from '../../../../i18n/components-share';
import { fixturePicker } from '../../../../lib/master-profile-fixture';
import { AgencyAiSettingForm } from './agency-ai-setting-form';
import { AgencyAiTurnOff } from './agency-ai-turn-off';
import { BrandingForm } from './branding-form';
import { ClientInvitationForm } from './client-invitation-form';
import { CollectionLinkPanel } from './collection/collection-link-panel';
import { GuestHoldForm, ReviewAnswerForm } from './collection/collection-review-forms';
import { EvidencePicker } from './evidence-picker';
import { EvidenceRequestActions } from './evidence-request-actions';
import { MissionCollaboration } from './mission-collaboration';
import { AgencyMark } from './org-branding-header';
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
    await show(
      <RequestEvidenceForm organizationId="org-1" picker={fixturePicker} applicants={[]} />,
    );
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

  it('turning the agency AI setting on: a Bengali heading, the statement and its confirmation in English', async () => {
    await show(
      <AgencyAiSettingForm organizationId="o1" organizationName="Acme Visas" enabled={false} />,
    );
    expect(host.querySelector('legend')?.textContent).toBe(bn[`${P}AgencyAiSettingForm.statement`]);
    // Left English at review: the confirmation sits beside the English statement it confirms.
    expect(host.textContent).toContain('I Confirm This Statement for Acme Visas');
  });

  it('a case with someone to assign, viewed by a member not assigned to it', async () => {
    await show(
      <MissionCollaboration
        organizationId="o1"
        missionId="m1"
        applicantId="a1"
        title="UK visit"
        applicantName="Rahim Uddin"
        viewerAssigned={false}
        members={[{ accountId: 'acct-2', email: 'member@example.com' } as never]}
        assignments={[]}
        notes={[]}
        tasks={[]}
        appointments={[]}
        requirements={[{ id: 'req-1', label: 'Employment Letter' }]}
        decisions={[]}
        issuerVerifications={[]}
      />,
    );
    expectBengali(`${P}MissionCollaboration.assignAMember`);
    expectBengali(`${P}MissionCollaboration.onlyAnAssignedMemberCanRecord`);
    const named = [...host.querySelectorAll('[aria-label]')].map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(named).toContain(bn[`${P}MissionCollaboration.memberToAssign`]);
  });

  it('a decision asks for a reason, and a stale decision offers Refresh', async () => {
    await show(
      <EvidenceRequestActions
        organizationId="o1"
        requestId="r1"
        status="RECEIVED"
        submissionId="s1"
      />,
    );
    const propose = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === bn[`${P}EvidenceRequestActions.proposeCorrection`],
    );
    if (!propose) throw new Error('Propose Correction button');
    await act(async () => propose.click());
    const reason = host.querySelector<HTMLTextAreaElement>(
      'textarea[name="reason"], input[name="reason"]',
    );
    expect(reason?.getAttribute('aria-label')).toBe(bn[`${P}EvidenceRequestActions.reason`]);
    if (!reason) throw new Error('reason field');
    reason.value = 'The date is wrong.';
    await act(async () => reason.form?.requestSubmit());
    expectBengali(`${P}EvidenceRequestActions.refresh`);
  });

  it('inviting a client with no active team member says to add one first', async () => {
    await show(<ClientInvitationForm organizationId="o1" pendingInvitationIds={[]} members={[]} />);
    expectBengali(`${P}ClientInvitationForm.addAtLeastOneActiveTeam`);
  });

  it('the branding form with a logo says it shows the logo as it appears', async () => {
    await show(
      <BrandingForm
        organizationId="o1"
        name="Skyline Visa"
        accentColor={null}
        logoUrl="https://example.test/logo.png"
      />,
    );
    expectBengali(`${P}BrandingForm.yourLogoAsItAppears`);
  });

  it('the private request link shares under a Bengali title', async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    try {
      await show(
        <ShareOriginsProvider origin="https://vs.obsidianglobal.studio">
          <CollectionLinkPanel url="https://vs.obsidianglobal.studio/collect/open?token=abcDEF123_-xyzABC456" />
        </ShareOriginsProvider>,
      );
      const shareKey = 'componentsShare.shareWhatsappShare.moreWaysToSend';
      const shareWords = [componentsShareCatalog.bn, componentsShareCatalog.en].map(
        (catalog) => (catalog as Record<string, string>)[shareKey],
      );
      const more = [...host.querySelectorAll('button')].find((b) =>
        shareWords.includes(b.textContent ?? ''),
      );
      if (!more) throw new Error('More Ways to Send button');
      await act(async () => more.click());
      expect(share).toHaveBeenCalledWith(
        expect.objectContaining({
          title: bn[`${P}CollectionCollectionLinkPanel.visastackRequest`],
        }),
      );
    } finally {
      Reflect.deleteProperty(navigator, 'share');
    }
  });

  const picker = (query: string, missingCount = 0) => {
    const rows = Array.from({ length: missingCount }, (_, n) => ({
      id: `m${n}`,
      label: `Item ${n}`,
      hint: '',
      state: 'ask' as const,
    }));
    return (
      <EvidencePicker
        picker={fixturePicker}
        selected={new Set()}
        onToggle={() => undefined}
        query={query}
        onQuery={() => undefined}
        searchRef={{ current: null }}
        missing={missingCount ? ({ rows, anyOf: [] } as never) : null}
        onAskAllMissing={() => undefined}
        missingIds={rows.map((r) => r.id)}
      />
    );
  };

  it('the request picker says, in Bengali, when nothing matches a search', async () => {
    await show(picker('zzzzqq'));
    expectBengali(`${P}EvidencePicker.noMatches`);
    const [before, after] = (bn[`${P}EvidencePicker.nothingMatchesTrimNotInThe`] ?? '').split(
      '{trim}',
    ) as [string, string];
    expect(host.textContent).toContain(`${before}zzzzqq${after}`);
  });

  it('the request picker counts the matches in Bengali digits', async () => {
    await show(picker('pass'));
    const [before, after] = (bn[`${P}EvidencePicker.totalMatches`] ?? '').split('{total}') as [
      string,
      string,
    ];
    expect(host.querySelector('output')?.textContent).toMatch(
      new RegExp(`^${before}[০-৯]+${after.replace('.', '\\.')}$`),
    );
  });

  it('the request picker says only the first 25 missing items are ticked', async () => {
    await show(picker('', 26));
    expect(host.textContent).toContain(
      bn[`${P}EvidencePicker.onlyTheFirstMaxAskItems`]?.replace('{MAX_ASK_ITEMS}', '২৫'),
    );
  });

  it('reviewing an answer: the decision, notes per item and the general note', async () => {
    await show(
      <ReviewAnswerForm
        organizationId="o1"
        requestId="r1"
        source="guest"
        answerId="a1"
        items={[{ id: 'i1', label: 'Passport' }]}
      />,
    );
    expectBengali(`${P}CollectionCollectionReviewForms.yourDecision`);
    expectBengali(`${P}CollectionCollectionReviewForms.addNotesForThePerson`);
    expectBengali(`${P}CollectionCollectionReviewForms.generalNote`);
    // Left English at review: the item label filled into it is the English checklist label.
    expect(host.textContent).toContain('Note on Passport');
  });

  it('placing a legal hold asks for its reason in Bengali', async () => {
    await show(<GuestHoldForm organizationId="o1" requestId="r1" held={false} />);
    expectBengali(`${P}CollectionCollectionReviewForms.reasonForTheHold`);
  });

  it('an agency logo is named for a screen reader in Bengali', async () => {
    await show(
      <AgencyMark
        brand={
          {
            name: 'Skyline Visa',
            accentColor: null,
            logoUrl: 'https://example.test/l.png',
          } as never
        }
        size="lg"
      />,
    );
    expect(host.querySelector('img')?.getAttribute('alt')).toBe(
      bn[`${P}OrgBrandingHeader.nameLogo`]?.replace('{name}', 'Skyline Visa'),
    );
  });
});
