import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * What the three removal screens say after a refusal: the exact English each sentence has always
 * had (typed out here from the screens as they were) plus the catalogue key the dialog words it
 * from. Every call is made up; no database.
 */
const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  deleteMyFile: vi.fn(),
  previewDeleteMyFile: vi.fn(),
  deleteDuplicate: vi.fn(),
  previewDeleteDuplicate: vi.fn(),
  restoreDeleted: vi.fn(),
  getDocumentLifecycle: vi.fn(),
  requestRemoval: vi.fn(),
  cancelRemovalRequest: vi.fn(),
  pendingRemovalRequests: vi.fn(),
  selfDeleteOn: vi.fn(),
  requestsOn: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  deleteMyFile: mocks.deleteMyFile,
  previewDeleteMyFile: mocks.previewDeleteMyFile,
  deleteDuplicate: mocks.deleteDuplicate,
  previewDeleteDuplicate: mocks.previewDeleteDuplicate,
  restoreDeleted: mocks.restoreDeleted,
  getDocumentLifecycle: mocks.getDocumentLifecycle,
  requestRemoval: mocks.requestRemoval,
  cancelRemovalRequest: mocks.cancelRemovalRequest,
  pendingRemovalRequests: mocks.pendingRemovalRequests,
  REMOVAL_REQUEST_REASONS: ['OTHER'],
  REMOVAL_REQUEST_REFUSALS: {
    notOwner: 'only the record owner can ask for a document to be removed',
    unavailable: 'removal requests are not available yet',
    notLive: 'only a current or archived document can be removed by request',
    legalHold: 'a legal hold covers this document',
    alreadyPending: 'a removal request for this document is already waiting',
    notPending: 'this removal request is no longer waiting',
    reason: 'choose a reason from the list',
  },
  SELF_DELETE_REFUSALS: {
    notOwner: 'only the record owner can delete a document',
    unavailable: 'deleting a document is not available yet',
    notLive: 'only a current or archived document can be deleted',
    alreadyGone: 'this document is already deleted',
    legalHold: 'a legal hold covers this document',
    finishedCase: 'a finished case used this document',
    agencyAnswer: 'this document answered an agency request',
    word: 'type the word to confirm',
    impact: 'the confirmation is not valid',
    stale: 'what deleting this document changes has changed since you looked',
    stepUp: 'deleting this document needs a fresh sign-in',
    rateLimited: 'too many deletions in a short time, try again later',
  },
  DELETE_DUPLICATE_REFUSALS: {
    notOwner: 'only the record owner can delete a duplicate',
    notDuplicate: 'this document is not an exact duplicate of another usable document',
    alreadyDeleted: 'this document is already deleted',
    blocked: {
      FINISHED_CASE: 'a finished case used this document',
      AGENCY_REQUEST_ANSWER: 'this document answered an agency request',
      CONTRIBUTOR_HANDOVER: 'a contributor handed this document over',
      SHARED_BY_NAME: 'a share names this document',
      LEGAL_HOLD: 'a legal hold covers this document',
    },
  },
  RESTORE_REFUSALS: {
    notOwner: 'only the record owner can restore a document',
    notDeleted: 'this document is not in Recently Deleted',
    tooLate: 'this document is already being removed',
  },
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'acct-1' }),
}));
vi.mock('../../../../../../lib/env', () => ({
  documentSelfDeleteOn: mocks.selfDeleteOn,
  documentRemovalRequestsOn: mocks.requestsOn,
}));
vi.mock('../../../../../../lib/step-up', () => ({
  tryEstablishStepUp: vi.fn(),
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'This action needs an extra sign-in check.',
}));
vi.mock('../../../../../../lib/jobs', () => ({ triggerErasureWorker: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));

import { appApplicantCatalog } from '../../../../../../i18n/app-applicant';
import {
  deleteDuplicateAction,
  deletePreviewAction,
  restoreDeletedAction,
  restoreInfoAction,
} from './delete/actions';
import { REMOVAL_WORDS } from './removal-words';
import { cancelRemovalRequestAction, requestRemovalAction } from './request/actions';
import { selfDeleteAction, selfDeletePreviewAction } from './self-delete/actions';

const APPLICANT = '22222222-2222-4222-8222-222222222222';
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
const proof = { ok: true, value: { applicant: { id: APPLICANT } } };
const refused = (code: string, message: string) => ({ ok: false, error: { code, message } });
const W = REMOVAL_WORDS;

afterEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

/** Every sentence: its key, and the English it had before it moved into the catalogue. */
const OLD_ENGLISH: Readonly<Record<keyof typeof W, string>> = {
  notOwnerOfRecord: 'Only the owner of this record can do this.',
  fileNoLongerHere: 'That file is no longer here. Refresh the page and try again.',
  documentNoLongerHere: 'That document is no longer here. Refresh the page and try again.',
  deletingNotAvailable: 'Deleting files is not available yet.',
  typeTheWordToConfirm: 'Type DELETE to confirm.',
  changedSinceOpened:
    'Something changed since you opened this. Read it again before you delete the file.',
  deletedManyFilesLastHour: 'You have deleted several files in the last hour. Try again later.',
  fileAlreadyDeletedOrRemoving:
    'This file is already in Recently Deleted or being removed. Refresh the page.',
  fileKeptLegal:
    'We have to keep this file for now because of a legal requirement, so it cannot be deleted.',
  fileKeptFinishedCase: 'A finished case used this file, so it is kept with that case.',
  fileKeptFinishedCaseAskUs:
    'A finished case used this file, so it is kept with that case. You can use Ask Us to Remove This File instead.',
  fileKeptAgencyAnswer: 'This file answered a request from an agency, so it is kept.',
  fileKeptAgencyAnswerAskUs:
    'This file answered a request from an agency, so it is kept. You can use Ask Us to Remove This File instead.',
  fileCannotBeDeletedNow: 'This file cannot be deleted right now. Refresh the page and try again.',
  couldNotCheckFile: 'We could not check this file. Close this and try again.',
  couldNotDeleteIt: 'We could not delete it. Check your connection and try again.',
  copyAlreadyRecentlyDeleted: 'This copy is already in Recently Deleted. Refresh the page.',
  copyKeptFinishedCase:
    'A finished case used this copy, so it is kept with that case. You can archive it instead.',
  copyKeptAgencyAnswer:
    'This copy answered a request from an agency, so it is kept. You can archive it instead.',
  copyKeptHandover:
    'Someone you invited sent this copy, so it is kept. You can archive it instead.',
  copyKeptSharedByName:
    'You shared this copy by name, so it is kept while that share is open. You can archive it instead.',
  copyKeptLegalHold: 'This copy must be kept for a legal requirement. You can archive it instead.',
  copyNotDuplicate:
    'This is no longer an exact copy of another document you keep, so it cannot be deleted here. You can archive it instead.',
  copyCannotBeDeletedNow: 'This copy cannot be deleted right now. Refresh the page and try again.',
  couldNotCheckCopy: 'We could not check this copy. Close this and try again.',
  restoreTooLate: 'Its 30 days are over and it is being removed, so it cannot be restored.',
  restoreNotDeleted: 'This document is not in Recently Deleted. Refresh the page.',
  couldNotCheckDocument: 'We could not check this document. Close this and try again.',
  couldNotRestoreIt: 'We could not restore it. Check your connection and try again.',
  couldNotRemoveIt: 'We could not remove it. Check your connection and try again.',
  requestNotOwner: 'Only the owner of these records can ask for a document to be removed.',
  requestsNotAvailable: 'Removal requests are not available yet.',
  requestAlreadyRemoving: 'This document is already being removed or is in Recently Deleted.',
  requestLegalHold:
    'We have to keep this document for now because of a legal requirement, so it cannot be removed.',
  requestAlreadyAsked:
    'You already asked us to remove this document. Refresh the page to see the request.',
  requestAlreadyDecided:
    'Support has already decided this request. Refresh the page to see the latest.',
  chooseReasonFromList: 'Choose a reason from the list.',
  requestCouldNotBeSent: 'This request could not be sent. Refresh the page and try again.',
  noWaitingRequest:
    'There is no waiting request for this document. Refresh the page to see the latest.',
  requestSendFailed: 'The request could not be sent. Check your connection and try again.',
  requestCancelFailed: 'The request could not be cancelled. Check your connection and try again.',
};

const said = (slug: keyof typeof W) => ({ message: OLD_ENGLISH[slug], messageKey: W[slug] });

describe('the removal catalogue', () => {
  it('holds the exact English every key had before, for every key', () => {
    expect(Object.keys(OLD_ENGLISH).sort()).toEqual(Object.keys(W).sort());
    for (const slug of Object.keys(W) as (keyof typeof W)[]) {
      expect(appApplicantCatalog.en[W[slug]], slug).toBe(OLD_ENGLISH[slug]);
    }
  });
});

describe('Delete My File refusals', () => {
  const run = async (code: string, message: string) => {
    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof);
    mocks.deleteMyFile.mockResolvedValue(refused(code, message));
    return selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE);
  };

  it.each([
    ['invalid', 'a legal hold covers this document', false, 'fileKeptLegal'],
    [
      'invalid',
      'only a current or archived document can be deleted',
      false,
      'fileAlreadyDeletedOrRemoving',
    ],
    ['stale', 'this document is already deleted', false, 'fileAlreadyDeletedOrRemoving'],
    ['invalid', 'a finished case used this document', false, 'fileKeptFinishedCase'],
    ['invalid', 'a finished case used this document', true, 'fileKeptFinishedCaseAskUs'],
    ['invalid', 'this document answered an agency request', false, 'fileKeptAgencyAnswer'],
    ['invalid', 'this document answered an agency request', true, 'fileKeptAgencyAnswerAskUs'],
    ['invalid', 'type the word to confirm', false, 'typeTheWordToConfirm'],
    ['invalid', 'deleting a document is not available yet', false, 'deletingNotAvailable'],
    [
      'rate_limited',
      'too many deletions in a short time, try again later',
      false,
      'deletedManyFilesLastHour',
    ],
    ['invalid', 'something nobody planned for', false, 'fileCannotBeDeletedNow'],
  ])('%s "%s" (ask-us %s) says %s', async (code, message, askUs, slug) => {
    mocks.requestsOn.mockReturnValue(askUs);
    expect(await run(code, message)).toEqual({
      ok: false,
      ...said(slug as keyof typeof W),
    });
  });

  it('says a changed list is stale', async () => {
    expect(
      await run('stale', 'what deleting this document changes has changed since you looked'),
    ).toEqual({ ok: false, ...said('changedSinceOpened'), stale: true });
  });

  it('gives a real record that is not theirs and a made-up id the same two answers', async () => {
    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const stranger = await selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE);
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    const madeUp = await selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE);
    expect(stranger).toEqual({ ok: false, ...said('notOwnerOfRecord') });
    expect(madeUp).toEqual(stranger);
    expect(await selfDeleteAction('not-an-id', DOC, 'DELETE', NONE)).toEqual({
      ok: false,
      ...said('fileNoLongerHere'),
    });
  });

  it('words the preview refusals the same way', async () => {
    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.requestsOn.mockReturnValue(false);
    mocks.requireAccess.mockResolvedValue(proof);
    mocks.previewDeleteMyFile.mockResolvedValue(refused('not_found', 'document not found'));
    expect(await selfDeletePreviewAction(APPLICANT, DOC)).toEqual({
      ok: false,
      ...said('fileNoLongerHere'),
    });
    mocks.selfDeleteOn.mockReturnValue(false);
    expect(await selfDeletePreviewAction(APPLICANT, DOC)).toEqual({
      ok: false,
      ...said('deletingNotAvailable'),
    });
  });
});

describe('Delete Duplicate and Restore refusals', () => {
  it.each([
    ['FINISHED_CASE', 'a finished case used this document', 'copyKeptFinishedCase'],
    ['AGENCY_REQUEST_ANSWER', 'this document answered an agency request', 'copyKeptAgencyAnswer'],
    ['CONTRIBUTOR_HANDOVER', 'a contributor handed this document over', 'copyKeptHandover'],
    ['SHARED_BY_NAME', 'a share names this document', 'copyKeptSharedByName'],
    ['LEGAL_HOLD', 'a legal hold covers this document', 'copyKeptLegalHold'],
  ])('a copy kept for %s says %s', async (_reason, message, slug) => {
    mocks.requireAccess.mockResolvedValue(proof);
    mocks.deleteDuplicate.mockResolvedValue(refused('invalid', message));
    expect(await deleteDuplicateAction(APPLICANT, DOC)).toEqual({
      ok: false,
      ...said(slug as keyof typeof W),
    });
  });

  it.each([
    [
      'invalid',
      'this document is not an exact duplicate of another usable document',
      'copyNotDuplicate',
    ],
    ['stale', 'this document is already deleted', 'copyAlreadyRecentlyDeleted'],
    ['invalid', 'something nobody planned for', 'copyCannotBeDeletedNow'],
    ['forbidden', 'only the record owner can delete a duplicate', 'notOwnerOfRecord'],
    ['not_found', 'document not found', 'documentNoLongerHere'],
  ])('delete %s "%s" says %s', async (code, message, slug) => {
    mocks.requireAccess.mockResolvedValue(proof);
    mocks.previewDeleteDuplicate.mockResolvedValue(refused(code, message));
    expect(await deletePreviewAction(APPLICANT, DOC)).toEqual({
      ok: false,
      ...said(slug as keyof typeof W),
    });
  });

  it.each([
    ['invalid', 'this document is already being removed', 'restoreTooLate'],
    ['invalid', 'this document is not in Recently Deleted', 'restoreNotDeleted'],
    ['not_found', 'document not found', 'documentNoLongerHere'],
    ['forbidden', 'only the record owner can restore a document', 'notOwnerOfRecord'],
  ])('restore %s "%s" says %s', async (code, message, slug) => {
    mocks.requireAccess.mockResolvedValue(proof);
    mocks.restoreDeleted.mockResolvedValue(refused(code, message));
    expect(await restoreDeletedAction(APPLICANT, DOC, 'UNDO')).toEqual({
      ok: false,
      ...said(slug as keyof typeof W),
    });
  });

  it('says a document that is not in Recently Deleted when its days cannot be read', async () => {
    mocks.requireAccess.mockResolvedValue(proof);
    mocks.getDocumentLifecycle.mockResolvedValue({ state: 'CURRENT' });
    expect(await restoreInfoAction(APPLICANT, DOC)).toEqual({
      ok: false,
      ...said('restoreNotDeleted'),
    });
  });

  it('gives a stranger and a made-up id the same answer', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const stranger = await deleteDuplicateAction(APPLICANT, DOC);
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    expect(await deleteDuplicateAction(APPLICANT, DOC)).toEqual(stranger);
    expect(stranger).toEqual({ ok: false, ...said('notOwnerOfRecord') });
  });
});

describe('Ask Us to Remove This File refusals', () => {
  it.each([
    ['forbidden', 'only the record owner can ask for a document to be removed', 'requestNotOwner'],
    ['invalid', 'removal requests are not available yet', 'requestsNotAvailable'],
    [
      'invalid',
      'only a current or archived document can be removed by request',
      'requestAlreadyRemoving',
    ],
    ['invalid', 'a legal hold covers this document', 'requestLegalHold'],
    ['stale', 'a removal request for this document is already waiting', 'requestAlreadyAsked'],
    ['stale', 'this removal request is no longer waiting', 'requestAlreadyDecided'],
    ['invalid', 'choose a reason from the list', 'chooseReasonFromList'],
    ['not_found', 'document not found', 'documentNoLongerHere'],
    ['invalid', 'something nobody planned for', 'requestCouldNotBeSent'],
  ])('%s "%s" says %s', async (code, message, slug) => {
    mocks.requestsOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof);
    mocks.requestRemoval.mockResolvedValue(refused(code, message));
    expect(await requestRemovalAction(APPLICANT, DOC, 'OTHER')).toEqual({
      ok: false,
      ...said(slug as keyof typeof W),
    });
  });

  it('says the switch, a bad reason, a missing request and a cancel refusal in the catalogue too', async () => {
    mocks.requestsOn.mockReturnValue(false);
    expect(await requestRemovalAction(APPLICANT, DOC, 'OTHER')).toEqual({
      ok: false,
      ...said('requestsNotAvailable'),
    });
    mocks.requestsOn.mockReturnValue(true);
    expect(await requestRemovalAction(APPLICANT, DOC, 'NOT_A_REASON')).toEqual({
      ok: false,
      ...said('chooseReasonFromList'),
    });
    mocks.requireAccess.mockResolvedValue(proof);
    mocks.pendingRemovalRequests.mockResolvedValue(new Map());
    expect(await cancelRemovalRequestAction(APPLICANT, DOC)).toEqual({
      ok: false,
      ...said('noWaitingRequest'),
    });
    mocks.pendingRemovalRequests.mockResolvedValue(new Map([[DOC, 'r1']]));
    mocks.cancelRemovalRequest.mockResolvedValue(
      refused('stale', 'this removal request is no longer waiting'),
    );
    expect(await cancelRemovalRequestAction(APPLICANT, DOC)).toEqual({
      ok: false,
      ...said('requestAlreadyDecided'),
    });
  });

  it('gives a stranger and a made-up id the same answer', async () => {
    mocks.requestsOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const stranger = await requestRemovalAction(APPLICANT, DOC, 'OTHER');
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    expect(await requestRemovalAction(APPLICANT, DOC, 'OTHER')).toEqual(stranger);
    expect(stranger).toEqual({ ok: false, ...said('requestNotOwner') });
  });
});
