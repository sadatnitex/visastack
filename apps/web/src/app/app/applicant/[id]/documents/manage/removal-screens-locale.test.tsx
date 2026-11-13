// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../../../i18n/app-applicant';

/**
 * Every removal sentence on the dialog that really shows it, driven the way a person reaches it:
 * the check when the dialog opens, or the button after it. Under Bengali the sentence shows its
 * Bengali when the catalogue has a checked draft and its exact English when it is held; under
 * English it is the exact English. Each case then switches the language with the sentence still on
 * screen and expects the new language (the dialog keeps the key, not words built once). Every file
 * and message is made up.
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

type WordKey = keyof typeof REMOVAL_WORDS;
const W = REMOVAL_WORDS;
const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const BENGALI = /[ঀ-৿]/;
const LATIN_WORD = /[A-Za-z]{3,}/;
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

/**
 * The six sentences held in English for label in name (HOLDBACK in scripts/i18n/register.mjs,
 * KEY_HOLDBACK in scripts/i18n/refill.mjs): each names a list or an action in quotes whose own
 * label is still English on screen.
 */
const HELD: readonly WordKey[] = [
  'copyAlreadyRecentlyDeleted',
  'fileAlreadyDeletedOrRemoving',
  'fileKeptAgencyAnswerAskUs',
  'fileKeptFinishedCaseAskUs',
  'requestAlreadyRemoving',
  'restoreNotDeleted',
];

type Screen = 'selfDelete' | 'deleteDuplicate' | 'restore' | 'request' | 'cancel';
/** open: the check when the dialog opens; act: the dialog's button. */
type Step = 'open' | 'act';
/** refused: the action answers with the key; failed: the call throws; empty: nothing chosen. */
type Way = 'refused' | 'failed' | 'empty';
type Case = readonly [WordKey, Screen, Step, Way];

const CASES: readonly Case[] = [
  // Delete My File
  ['notOwnerOfRecord', 'selfDelete', 'open', 'refused'],
  ['fileNoLongerHere', 'selfDelete', 'open', 'refused'],
  ['deletingNotAvailable', 'selfDelete', 'open', 'refused'],
  ['fileKeptLegal', 'selfDelete', 'open', 'refused'],
  ['fileKeptFinishedCase', 'selfDelete', 'open', 'refused'],
  ['fileKeptFinishedCaseAskUs', 'selfDelete', 'open', 'refused'],
  ['fileKeptAgencyAnswer', 'selfDelete', 'open', 'refused'],
  ['fileKeptAgencyAnswerAskUs', 'selfDelete', 'open', 'refused'],
  ['fileAlreadyDeletedOrRemoving', 'selfDelete', 'open', 'refused'],
  ['fileCannotBeDeletedNow', 'selfDelete', 'open', 'refused'],
  ['couldNotCheckFile', 'selfDelete', 'open', 'failed'],
  ['deletedManyFilesLastHour', 'selfDelete', 'act', 'refused'],
  ['changedSinceOpened', 'selfDelete', 'act', 'refused'],
  ['typeTheWordToConfirm', 'selfDelete', 'act', 'refused'],
  ['typeTheWordToConfirm', 'selfDelete', 'act', 'empty'],
  ['couldNotDeleteIt', 'selfDelete', 'act', 'failed'],
  // Delete Duplicate
  ['notOwnerOfRecord', 'deleteDuplicate', 'open', 'refused'],
  ['copyKeptFinishedCase', 'deleteDuplicate', 'open', 'refused'],
  ['copyKeptAgencyAnswer', 'deleteDuplicate', 'open', 'refused'],
  ['copyKeptHandover', 'deleteDuplicate', 'open', 'refused'],
  ['copyKeptSharedByName', 'deleteDuplicate', 'open', 'refused'],
  ['copyKeptLegalHold', 'deleteDuplicate', 'open', 'refused'],
  ['copyNotDuplicate', 'deleteDuplicate', 'open', 'refused'],
  ['copyAlreadyRecentlyDeleted', 'deleteDuplicate', 'open', 'refused'],
  ['copyCannotBeDeletedNow', 'deleteDuplicate', 'open', 'refused'],
  ['couldNotCheckCopy', 'deleteDuplicate', 'open', 'failed'],
  ['documentNoLongerHere', 'deleteDuplicate', 'act', 'refused'],
  ['couldNotDeleteIt', 'deleteDuplicate', 'act', 'failed'],
  // Restore from Recently Deleted
  ['notOwnerOfRecord', 'restore', 'open', 'refused'],
  ['restoreNotDeleted', 'restore', 'open', 'refused'],
  ['couldNotCheckDocument', 'restore', 'open', 'failed'],
  ['restoreTooLate', 'restore', 'act', 'refused'],
  ['documentNoLongerHere', 'restore', 'act', 'refused'],
  ['couldNotRestoreIt', 'restore', 'act', 'failed'],
  // Ask Us to Remove This File
  ['requestNotOwner', 'request', 'act', 'refused'],
  ['requestsNotAvailable', 'request', 'act', 'refused'],
  ['requestAlreadyRemoving', 'request', 'act', 'refused'],
  ['requestLegalHold', 'request', 'act', 'refused'],
  ['requestAlreadyAsked', 'request', 'act', 'refused'],
  ['chooseReasonFromList', 'request', 'act', 'refused'],
  ['chooseReasonFromList', 'request', 'act', 'empty'],
  ['documentNoLongerHere', 'request', 'act', 'refused'],
  ['requestCouldNotBeSent', 'request', 'act', 'refused'],
  ['requestSendFailed', 'request', 'act', 'failed'],
  // Cancel Removal Request
  ['requestNotOwner', 'cancel', 'act', 'refused'],
  ['requestsNotAvailable', 'cancel', 'act', 'refused'],
  ['noWaitingRequest', 'cancel', 'act', 'refused'],
  ['requestAlreadyDecided', 'cancel', 'act', 'refused'],
  ['documentNoLongerHere', 'cancel', 'act', 'refused'],
  ['requestCancelFailed', 'cancel', 'act', 'failed'],
];

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

const alert = () => container.querySelector('[role="alert"]')?.textContent ?? null;
const props = { applicantId: 'a1', documentId: DOC, documentName: 'Passport', onClose: () => {} };
const DIALOGS: Record<Screen, () => React.ReactElement> = {
  selfDelete: () => <SelfDeleteAction {...props} />,
  deleteDuplicate: () => <DeleteDuplicateAction {...props} />,
  restore: () => <RestoreDeletedAction {...props} />,
  request: () => <RequestRemovalAction {...props} />,
  cancel: () => <CancelRemovalRequestAction {...props} />,
};
/** The call each step of each dialog makes, and what it answers when it goes through. */
const CALLS: Record<
  Screen,
  { open?: ReturnType<typeof vi.fn>; opened?: unknown; act: ReturnType<typeof vi.fn> }
> = {
  selfDelete: {
    open: mocks.selfPreview,
    opened: { ok: true, impact: NONE, needsFreshSignIn: false },
    act: mocks.selfDelete,
  },
  deleteDuplicate: {
    open: mocks.deletePreview,
    opened: {
      ok: true,
      survivorName: 'Passport',
      cases: [],
      purgeAfter: '2026-12-13T00:00:00.000Z',
    },
    act: mocks.deleteDuplicate,
  },
  restore: { open: mocks.restoreInfo, opened: { ok: true, days: 30 }, act: mocks.restore },
  request: { act: mocks.request },
  cancel: { act: mocks.cancel },
};

function draw(locale: 'en' | 'bn', screen: Screen) {
  root.render(
    <I18nProvider locale={locale} pageLang={locale}>
      {DIALOGS[screen]()}
    </I18nProvider>,
  );
}
async function click(element: Element | null | undefined) {
  expect(element, 'the button to press').toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
  });
}
async function typeWord(word: string) {
  const field = container.querySelector('input[type="text"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, word);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Opens the dialog under `locale` and brings the sentence for `key` onto it the way a person would. */
async function reach(locale: 'en' | 'bn', [key, screen, step, way]: Case) {
  for (const mock of Object.values(mocks)) mock.mockReset();
  act(() => root.unmount());
  root = createRoot(container);
  const calls = CALLS[screen];
  const answer = (mock: ReturnType<typeof vi.fn>) => {
    if (way === 'failed') mock.mockRejectedValue(new Error('offline'));
    else mock.mockResolvedValue({ ok: false, message: en[W[key]], messageKey: W[key] });
  };
  if (step === 'open' && calls.open) answer(calls.open);
  else {
    calls.open?.mockResolvedValue(calls.opened);
    answer(calls.act);
  }
  await act(async () => draw(locale, screen));
  if (step === 'open') return;
  if (screen === 'selfDelete') {
    if (way !== 'empty') await typeWord('DELETE');
    await click(container.querySelector('button.btn-danger'));
  } else {
    if (screen === 'request' && way !== 'empty')
      await click(container.querySelector('input[type="radio"]'));
    await click(container.querySelector('button.btn-primary'));
  }
  if (way === 'empty') expect(calls.act).not.toHaveBeenCalled();
}

describe('every removal sentence on the dialog that shows it', () => {
  it.each(CASES)('%s on %s (%s, %s)', async (...c) => {
    const [key] = c;
    const english = en[W[key]];
    expect(english).toBeTruthy();

    await reach('en', c);
    expect(alert()).toBe(english);

    await reach('bn', c);
    if (HELD.includes(key)) {
      // Held: the exact English, and no Bengali value that could ship by mistake.
      expect(bn[W[key]]).toBeUndefined();
      expect(alert()).toBe(english);
    } else {
      expect(bn[W[key]]).toBeTruthy();
      expect(alert()).toBe(bn[W[key]]);
      expect(alert()).toMatch(BENGALI);
      // Only the typed word DELETE is Latin in a Bengali removal sentence.
      expect((alert() ?? '').replace('DELETE', '')).not.toMatch(LATIN_WORD);
    }
    expect(alert()).not.toContain('appApplicant.');

    // Switched to English with the sentence still on screen: it is reworded, not frozen.
    await act(async () => draw('en', c[1]));
    expect(alert()).toBe(english);
    // And back again.
    await act(async () => draw('bn', c[1]));
    expect(alert()).toBe(bn[W[key]] ?? english);
  });

  it('covers every removal sentence on at least one dialog, and holds exactly the six', () => {
    const covered = new Set(CASES.map(([key]) => key));
    // couldNotRemoveIt shows only in the upload and import lists (their own tests).
    const all = (Object.keys(W) as WordKey[]).filter((k) => k !== 'couldNotRemoveIt');
    expect(all.filter((k) => !covered.has(k))).toEqual([]);
    const withoutBengali = (Object.keys(W) as WordKey[]).filter((k) => bn[W[k]] === undefined);
    expect(withoutBengali.sort()).toEqual([...HELD].sort());
  });
});
