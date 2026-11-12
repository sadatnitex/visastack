// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareOriginsProvider } from '../../../../components/share/share-origins';

// Components whose wording the owner signed off on 2026-11-12, drawn under Bengali so that every
// live Bengali message has a test that shows it.
vi.mock('./actions', () => ({
  transitionMissionAction: vi.fn(async () => ({ ok: true, message: '' })),
  snapshotMissionAction: vi.fn(async () => ({ ok: true, message: '' })),
  deleteCancelledCaseAction: vi.fn(async () => ({ ok: true, message: '' })),
  generateLetterAction: vi.fn(async () => ({ ok: true, message: '' })),
  fileComplaintAction: vi.fn(async () => ({ ok: true, message: '' })),
  withdrawComplaintAction: vi.fn(async () => ({ ok: true, message: '' })),
  submitFeedbackAction: vi.fn(async () => ({ ok: true, message: '' })),
  createContributorRequestAction: vi.fn(async () => ({ ok: true, message: '' })),
  revokeContributorRequestAction: vi.fn(async () => ({ ok: true, message: '' })),
}));
vi.mock('./snapshots/[snapshotId]/actions', () => ({
  decideAcknowledgementAction: vi.fn(async () => ({ ok: true, message: '' })),
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => (
    <a href={href} {...rest}>
      {children as never}
    </a>
  ),
}));

import { I18nProvider } from '../../../../components/i18n-provider';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { CaseMoreMenu } from './case-more-menu';
import { LettersPanel } from './collaboration-panels';
import { ComplaintPanel, FeedbackPanel } from './complaint-feedback-panel';
import { ContributorRequestsPanel } from './contributor-requests-panel';
import { AcknowledgementPanel } from './snapshots/[snapshotId]/acknowledgement-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bn = appMissionCatalog.bn as Record<string, string>;
const en = appMissionCatalog.en as Record<string, string>;
const P = 'appMission.appMissionId';
const MISSION = '00000000-0000-4000-8000-000000000101';
const SNAPSHOT = '00000000-0000-4000-8000-000000000202';

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

const show = (node: React.ReactNode) =>
  act(() =>
    root.render(
      <I18nProvider locale="bn" pageLang="bn">
        <ShareOriginsProvider appOrigin="https://vs.example.test">{node}</ShareOriginsProvider>
      </I18nProvider>,
    ),
  );
const expectBengali = (key: string) => {
  expect(host.textContent, key).toContain(bn[key]);
  expect(host.textContent, key).not.toContain(en[key]);
};

describe('signed-off wording on the case screens, under Bengali', () => {
  it('the delete question says the case is removed for good', () => {
    show(<CaseMoreMenu missionId={MISSION} applicantId="person-1" canCancel canDelete />);
    const details = host.querySelector('details') as HTMLDetailsElement;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    // Delete Case is the last item of the list (the label may or may not have Bengali yet).
    const remove = [...host.querySelectorAll('button.case-more-item')].at(-1) as
      | HTMLButtonElement
      | undefined;
    expect(remove).toBeTruthy();
    act(() => remove?.click());
    expectBengali(`${P}CaseMoreMenu.theCaseIsRemovedForGood`);
  });

  it('cover letters say they are made only from confirmed evidence', () => {
    show(<LettersPanel missionId={MISSION} letters={[]} canGenerate />);
    expectBengali(`${P}CollaborationPanels.generatedStrictlyFromConfirmedEligibleEvidence`);
  });

  it('the complaint and feedback panels say who sees them', () => {
    show(
      <>
        <ComplaintPanel missionId={MISSION} complaints={[]} />
        <FeedbackPanel missionId={MISSION} feedback={[]} canSubmit />
      </>,
    );
    expectBengali(`${P}ComplaintFeedbackPanel.reviewedOnlyByAuthorizedQualityStaff`);
    expectBengali(`${P}ComplaintFeedbackPanel.onlyYouAndAuthorizedQualityStaff`);
  });

  it('the contributor request form says why the contributor will see the reason', () => {
    show(<ContributorRequestsPanel missionId={MISSION} requests={[]} />);
    expectBengali(`${P}ContributorRequestsPanel.whyTheContributorWillSeeThis`);
  });

  it('the final review form says a reason is required to reject or ask for a correction', () => {
    show(
      <AcknowledgementPanel
        missionId={MISSION}
        snapshotId={SNAPSHOT}
        checksum="a1b2c3d4e5f60718"
        history={[]}
      />,
    );
    expectBengali(`${P}SnapshotsSnapshotidAcknowledgementPanel.reasonRequiredToRejectOrRequest`);
  });
});
