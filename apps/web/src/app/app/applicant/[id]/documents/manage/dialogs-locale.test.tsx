// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../../../i18n/app-applicant';

/**
 * The delete, request, replace and self-delete dialogs under Bengali, in each state they draw.
 * Every file, person and message here is made up.
 */
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  deletePreview: vi.fn(),
  deleteDuplicate: vi.fn(),
  restore: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
  options: vi.fn(),
  replace: vi.fn(),
  selfPreview: vi.fn(),
  selfDelete: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./delete/actions', () => ({
  deletePreviewAction: mocks.deletePreview,
  deleteDuplicateAction: mocks.deleteDuplicate,
  restoreInfoAction: vi.fn(),
  restoreDeletedAction: mocks.restore,
}));
vi.mock('./request/actions', () => ({
  requestRemovalAction: mocks.request,
  cancelRemovalRequestAction: mocks.cancel,
}));
vi.mock('./replace/actions', () => ({
  replaceOptionsAction: mocks.options,
  replaceDocumentAction: mocks.replace,
}));
vi.mock('./self-delete/actions', () => ({
  selfDeletePreviewAction: mocks.selfPreview,
  selfDeleteAction: mocks.selfDelete,
}));
vi.mock('./archive/actions', () => ({
  archiveDocumentAction: vi.fn(),
  restoreDocumentAction: vi.fn(),
}));
vi.mock('./copy/actions', () => ({ copyOptionsAction: vi.fn(), keepCopyAction: vi.fn() }));
vi.mock('../../actions', () => ({ uploadDocumentAction: vi.fn() }));

import { DeleteDuplicateAction } from './delete/delete-action';
import { ManageMenu } from './manage-menu';
import { ReplaceAction } from './replace/replace-action';
import { CancelRemovalRequestAction } from './request/cancel-action';
import { RequestRemovalAction } from './request/request-action';
import { SelfDeleteAction } from './self-delete/self-delete-action';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantIdDocumentsManage';
const BENGALI = /[ঀ-৿]/;
const DOC = '11111111-1111-4111-8111-111111111111';
const NEWER = '22222222-2222-4222-8222-222222222222';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const text = () => (container.textContent ?? '').replace(/\s+/g, ' ');
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
async function show(locale: 'en' | 'bn', node: React.ReactNode) {
  await act(async () => {
    root.render(
      <I18nProvider locale={locale} pageLang={locale}>
        {node}
      </I18nProvider>,
    );
  });
}
async function click(element: Element | null | undefined) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}
const noop = () => undefined;
const primary = () =>
  [...container.querySelectorAll('button')].find((b) => b.className.includes('primary'));

describe('Delete Duplicate under Bengali', () => {
  const open = (locale: 'en' | 'bn' = 'bn') =>
    show(
      locale,
      <DeleteDuplicateAction
        applicantId="a1"
        documentId={DOC}
        documentName="Passport"
        onClose={noop}
      />,
    );
  beforeEach(() => {
    mocks.deletePreview.mockResolvedValue({
      ok: true,
      survivorName: 'Passport, Kept',
      cases: [{ missionId: 'm1', title: 'Japan Visit' }],
      purgeAfter: '2026-12-12T00:00:00Z',
    });
    mocks.deleteDuplicate.mockResolvedValue({ ok: true, days: 30 });
  });

  it('shows the confirmation in Bengali with the purge date in Bengali digits, held lines in English', async () => {
    await open();
    expect(text()).toContain(bn[`${K}DeleteDeleteAction.deleteDuplicate`]);
    expect(text()).toContain(bn[`${K}DeleteDeleteAction.deleteDuplicate484f53`]);
    expect(text()).toContain('১২ ডিসে, ২০২৬');
    expect(text()).not.toContain('12 Dec');
    // The case-switch sentence is about open cases: held, English.
    expect(text()).toContain('1 open case uses this copy');
    expect(text()).not.toMatch(/appApplicant\./);
  });

  it('shows the finished state, which is held, in English with its undo and records link', async () => {
    await open();
    await click(button(bn[`${K}DeleteDeleteAction.deleteDuplicate484f53`] as string));
    expect(text()).toContain('Duplicate Deleted');
    expect(text()).toContain('Removed in 30 Days');
    expect(text()).toContain('Removal Records');
  });

  it('is the same English as before under English', async () => {
    await open('en');
    expect(text()).not.toMatch(BENGALI);
    expect(text()).toContain('Delete Duplicate');
    expect(text()).toContain('It waits in Recently Deleted until 12 Dec 2026');
  });
});

describe('the removal request under Bengali', () => {
  it('shows the request form: Bengali title and question, the reasons and promise held in English', async () => {
    await show(
      'bn',
      <RequestRemovalAction
        applicantId="a1"
        documentId={DOC}
        documentName="Passport"
        onClose={noop}
      />,
    );
    expect(text()).toContain(bn[`${K}RequestRequestAction.askUsToRemoveThisFile`]);
    expect(text()).toContain('আমরা কেন Passport সরাব?');
    expect(text()).toContain('Backup copies expire within 90 days');
    expect(text()).toContain('I added it by mistake');
    expect(text()).toContain('Send Request');
  });

  it('shows the sent state in Bengali, with the server message as sent', async () => {
    mocks.request.mockResolvedValue({ ok: true, message: 'Removal requested.' });
    await show(
      'bn',
      <RequestRemovalAction
        applicantId="a1"
        documentId={DOC}
        documentName="Passport"
        onClose={noop}
      />,
    );
    await click(container.querySelector('input[type="radio"]'));
    await click(primary());
    expect(text()).toContain(bn[`${K}RequestCancelAction.removalRequested`]);
    expect(text()).toContain('Removal requested.');
  });

  it('shows the waiting request with its cancel button in Bengali', async () => {
    await show(
      'bn',
      <CancelRemovalRequestAction
        applicantId="a1"
        documentId={DOC}
        documentName="Passport"
        onClose={noop}
      />,
    );
    expect(text()).toContain(bn[`${K}RequestCancelAction.removalRequested`]);
    expect(text()).toContain(bn[`${K}RequestCancelAction.cancelRequest`]);
    expect(text()).toContain('You asked us to remove Passport.');
    expect(text()).toContain('Keep Request');
  });

  it('is the same English as before under English', async () => {
    await show(
      'en',
      <CancelRemovalRequestAction
        applicantId="a1"
        documentId={DOC}
        documentName="Passport"
        onClose={noop}
      />,
    );
    expect(text()).not.toMatch(BENGALI);
    expect(text()).toContain('Removal Requested');
    expect(text()).toContain('Cancel Request');
  });
});

describe('Replace with a Newer Document under Bengali', () => {
  beforeEach(() => {
    mocks.options.mockResolvedValue({
      ok: true,
      docType: 'PASSPORT',
      kindLabel: 'Passport',
      candidates: [
        {
          documentId: NEWER,
          name: 'Passport, Renewed',
          uploadedAt: '2026-10-30T00:00:00Z',
          status: 'READY',
        },
      ],
      cases: [{ missionId: 'm1', title: 'Japan Visit' }],
      pdfAccepted: false,
    });
    mocks.replace.mockResolvedValue({ ok: true, message: 'Replaced.' });
  });
  const open = (locale: 'en' | 'bn' = 'bn') =>
    show(
      locale,
      <ReplaceAction
        applicantId="a1"
        documentId={DOC}
        documentName="Passport, Old"
        onClose={noop}
      />,
    );

  it('shows the choice step in Bengali, with the date in Bengali digits and the names as they are', async () => {
    await open();
    for (const key of [
      'replaceWithANewerDocument',
      'chooseTheNewerDocument',
      'addTheNewerDocument',
      'continue',
    ])
      expect(text(), key).toContain(bn[`${K}ReplaceReplaceAction.${key}`]);
    expect(text()).toContain('Passport, Renewed');
    expect(text()).toContain('Added ৩০ অক্টো, ২০২৬');
    expect(text()).not.toMatch(/appApplicant\./);
  });

  it('shows the confirm step, which names open cases, in English, then the done state in Bengali', async () => {
    await open();
    await click(container.querySelector(`input[value="${NEWER}"]`));
    await click(button(bn[`${K}ReplaceReplaceAction.continue`] as string));
    expect(text()).toContain('Replace Passport, Old?');
    expect(text()).toContain('1 case will be updated');
    await click(primary());
    expect(text()).toContain(bn[`${K}ReplaceReplaceAction.documentReplaced`]);
    expect(text()).toContain('Replaced.');
  });

  it('is the same English as before under English', async () => {
    await open('en');
    expect(text()).not.toMatch(BENGALI);
    expect(text()).toContain('Replace with a Newer Document');
    expect(text()).toContain('Added 30 Oct 2026');
  });
});

describe('Delete My File and the Manage menu under Bengali', () => {
  it('shows the confirmation in Bengali for the title, the word to type and the button', async () => {
    mocks.selfPreview.mockResolvedValue({
      ok: true,
      impact: {
        openCases: 1,
        agencies: 2,
        shares: 0,
        profileDetails: 3,
        aiChoices: 0,
        trips: 0,
        contributorHandovers: 0,
      },
      needsFreshSignIn: false,
    });
    await show(
      'bn',
      <SelfDeleteAction applicantId="a1" documentId={DOC} documentName="Passport" onClose={noop} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(text()).toContain(bn[`${K}SelfDeleteSelfDeleteAction.deleteFileNow`]);
    expect(text()).toContain(bn[`${K}SelfDeleteSelfDeleteAction.typeDeleteToConfirm`]);
    expect(text()).toContain('Passport এখনই মুছে ফেলবেন?');
    // What is lost, and who is told, is held: English.
    expect(text()).toContain('2 agencies can see it.');
    expect(text()).toContain('Backup copies expire within 90 days');
  });

  it('labels the Manage menu button in Bengali and names the file in its accessible name', async () => {
    await show(
      'bn',
      <ManageMenu
        applicantId="a1"
        documentId={DOC}
        documentName="Passport"
        actions={['ARCHIVE']}
      />,
    );
    expect(text()).toContain(bn[`${K}ManageMenu.manage`]);
    expect(container.innerHTML).toContain(
      bn[`${K}ManageMenu.manageDocumentname`]?.replace('{documentName}', 'Passport') ?? 'MISSING',
    );
  });

  it('is the same English as before under English', async () => {
    await show(
      'en',
      <ManageMenu
        applicantId="a1"
        documentId={DOC}
        documentName="Passport"
        actions={['ARCHIVE']}
      />,
    );
    expect(text()).toBe('Manage');
    expect(en[`${K}ManageMenu.manage`]).toBe('Manage');
  });
});
