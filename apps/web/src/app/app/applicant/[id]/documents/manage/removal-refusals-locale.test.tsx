// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../../../i18n/app-applicant';

/**
 * What the removal dialogs say after a refusal or a failed call, in English and in Bengali. Each
 * sentence comes from the catalogue by the key the action sent; Bengali shows only where a checked
 * draft exists, and everything else shows its exact English. Every file and message is made up.
 */
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  deletePreview: vi.fn(),
  deleteDuplicate: vi.fn(),
  restoreInfo: vi.fn(),
  restore: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
  selfPreview: vi.fn(),
  selfDelete: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./delete/actions', () => ({
  deletePreviewAction: mocks.deletePreview,
  deleteDuplicateAction: mocks.deleteDuplicate,
  restoreInfoAction: mocks.restoreInfo,
  restoreDeletedAction: mocks.restore,
}));
vi.mock('./request/actions', () => ({
  requestRemovalAction: mocks.request,
  cancelRemovalRequestAction: mocks.cancel,
}));
vi.mock('./self-delete/actions', () => ({
  selfDeletePreviewAction: mocks.selfPreview,
  selfDeleteAction: mocks.selfDelete,
}));

import { DeleteDuplicateAction } from './delete/delete-action';
import { RestoreDeletedAction } from './delete/restore-action';
import { REMOVAL_WORDS } from './removal-words';
import { CancelRemovalRequestAction } from './request/cancel-action';
import { RequestRemovalAction } from './request/request-action';
import { SelfDeleteAction } from './self-delete/self-delete-action';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const BENGALI = /[ঀ-৿]/;
const DOC = '11111111-1111-4111-8111-111111111111';
const NONE = {
  openCases: 0,
  agencies: 0,
  shares: 0,
  profileDetails: 0,
  aiChoices: 0,
  trips: 0,
  contributorHandovers: 0,
};
const KEYS = Object.values(REMOVAL_WORDS);
const W = REMOVAL_WORDS;

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

const alert = () => container.querySelector('[role="alert"]')?.textContent;
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
const props = { applicantId: 'a1', documentId: DOC, documentName: 'Passport', onClose: noop };
const danger = () => container.querySelector('button.btn-danger');
const primary = () => container.querySelector('button.btn-primary');

describe('every removal sentence, worded from the catalogue by its key', () => {
  it.each(KEYS)(
    '%s: exact English under English, Bengali only where a draft is checked',
    async (key) => {
      mocks.selfPreview.mockResolvedValue({ ok: false, message: en[key], messageKey: key });
      await show('en', <SelfDeleteAction {...props} />);
      expect(alert()).toBe(en[key]);
      expect(alert()).not.toMatch(BENGALI);
      act(() => root.unmount());
      root = createRoot(container);
      await show('bn', <SelfDeleteAction {...props} />);
      expect(alert()).toBe(bn[key] ?? en[key]);
    },
  );

  it('keyed with Bengali equals rendered in Bengali', async () => {
    const keyedWithBengali = KEYS.filter((key) => bn[key] !== undefined);
    let renderedInBengali = 0;
    for (const key of keyedWithBengali) {
      mocks.selfPreview.mockResolvedValue({ ok: false, message: en[key], messageKey: key });
      act(() => root.unmount());
      root = createRoot(container);
      await show('bn', <SelfDeleteAction {...props} />);
      if (alert() === bn[key] && BENGALI.test(alert() ?? '')) renderedInBengali += 1;
    }
    expect(keyedWithBengali.length).toBeGreaterThanOrEqual(6);
    expect(renderedInBengali).toBe(keyedWithBengali.length);
  });

  it('marks the language of a Bengali sentence on an English page, and shows English for a key it does not know', async () => {
    const legal = W.fileKeptLegal;
    mocks.selfPreview.mockResolvedValue({ ok: false, message: en[legal], messageKey: legal });
    await act(async () => {
      root.render(
        <I18nProvider locale="bn" pageLang="en">
          <SelfDeleteAction {...props} />
        </I18nProvider>,
      );
    });
    expect(container.querySelector('[role="alert"] span[lang="bn"]')?.textContent).toBe(bn[legal]);
    act(() => root.unmount());
    root = createRoot(container);
    mocks.selfPreview.mockResolvedValue({
      ok: false,
      message: 'Sent by a newer version.',
      messageKey: 'appApplicant.notInThisCatalogue',
    });
    await show('bn', <SelfDeleteAction {...props} />);
    expect(alert()).toBe('Sent by a newer version.');
    // On a page marked Bengali, the English it falls back to is marked as English.
    expect(container.querySelector('[role="alert"] span[lang="en"]')?.textContent).toBe(
      'Sent by a newer version.',
    );
  });

  it('shows the English message as sent when an answer carries no key, marked as English on a Bengali page', async () => {
    mocks.selfPreview.mockResolvedValue({ ok: false, message: 'Something plain.' });
    await show('bn', <SelfDeleteAction {...props} />);
    expect(alert()).toBe('Something plain.');
    expect(container.querySelector('[role="alert"] span[lang="en"]')?.textContent).toBe(
      'Something plain.',
    );
    // On a page marked English it is plain text, with no extra marking.
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider locale="bn" pageLang="en">
          <SelfDeleteAction {...props} />
        </I18nProvider>,
      );
    });
    expect(alert()).toBe('Something plain.');
    expect(container.querySelector('[role="alert"] span')).toBeNull();
  });
});

describe('each dialog shows its own refusals and failures', () => {
  const sayBoth = async (node: React.ReactNode, key: string, drive?: () => Promise<void>) => {
    for (const locale of ['en', 'bn'] as const) {
      act(() => root.unmount());
      root = createRoot(container);
      await show(locale, node);
      if (drive) await drive();
      expect(alert(), `${locale} ${key}`).toBe(locale === 'bn' ? (bn[key] ?? en[key]) : en[key]);
    }
  };

  it('Delete My File: a refusal, a failed check, a failed delete, and a missing word', async () => {
    mocks.selfPreview.mockResolvedValue({
      ok: false,
      message: en[W.fileKeptLegal],
      messageKey: W.fileKeptLegal,
    });
    await sayBoth(<SelfDeleteAction {...props} />, W.fileKeptLegal);
    mocks.selfPreview.mockRejectedValue(new Error('offline'));
    await sayBoth(<SelfDeleteAction {...props} />, W.couldNotCheckFile);
    mocks.selfPreview.mockResolvedValue({ ok: true, impact: NONE, needsFreshSignIn: false });
    await sayBoth(<SelfDeleteAction {...props} />, W.typeTheWordToConfirm, () => click(danger()));
    expect(mocks.selfDelete).not.toHaveBeenCalled();
    mocks.selfDelete.mockRejectedValue(new Error('offline'));
    await sayBoth(<SelfDeleteAction {...props} />, W.couldNotDeleteIt, async () => {
      const field = container.querySelector('input[type="text"]') as HTMLInputElement;
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        set?.call(field, 'DELETE');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await click(danger());
    });
  });

  it('Delete Duplicate and Restore: refusals and failures', async () => {
    mocks.deletePreview.mockResolvedValue({
      ok: false,
      message: en[W.copyNotDuplicate],
      messageKey: W.copyNotDuplicate,
    });
    await sayBoth(<DeleteDuplicateAction {...props} />, W.copyNotDuplicate);
    mocks.deletePreview.mockRejectedValue(new Error('offline'));
    await sayBoth(<DeleteDuplicateAction {...props} />, W.couldNotCheckCopy);
    mocks.restoreInfo.mockResolvedValue({
      ok: false,
      message: en[W.restoreNotDeleted],
      messageKey: W.restoreNotDeleted,
    });
    await sayBoth(<RestoreDeletedAction {...props} />, W.restoreNotDeleted);
    mocks.restoreInfo.mockRejectedValue(new Error('offline'));
    await sayBoth(<RestoreDeletedAction {...props} />, W.couldNotCheckDocument);
  });

  it('Ask Us to Remove This File: a refusal, a failed send, a missing reason, a failed cancel', async () => {
    const radio = () => container.querySelector('input[type="radio"]');
    mocks.request.mockResolvedValue({
      ok: false,
      message: en[W.requestLegalHold],
      messageKey: W.requestLegalHold,
    });
    await sayBoth(<RequestRemovalAction {...props} />, W.requestLegalHold, async () => {
      await click(radio());
      await click(primary());
    });
    mocks.request.mockRejectedValue(new Error('offline'));
    await sayBoth(<RequestRemovalAction {...props} />, W.requestSendFailed, async () => {
      await click(radio());
      await click(primary());
    });
    await sayBoth(<RequestRemovalAction {...props} />, W.chooseReasonFromList, () =>
      click(primary()),
    );
    mocks.cancel.mockRejectedValue(new Error('offline'));
    await sayBoth(<CancelRemovalRequestAction {...props} />, W.requestCancelFailed, async () => {
      const keep = [...container.querySelectorAll('button')].find(
        (b) => b.className.includes('danger') || b.className.includes('primary'),
      );
      await click(keep);
    });
  });
});
