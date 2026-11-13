import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  deleteMyFile: vi.fn(),
  previewDeleteMyFile: vi.fn(),
  selfDeleteOn: vi.fn(),
  requestsOn: vi.fn(),
  stepUp: vi.fn(),
  worker: vi.fn(),
  after: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  deleteMyFile: mocks.deleteMyFile,
  previewDeleteMyFile: mocks.previewDeleteMyFile,
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
}));
vi.mock('../../../../../../../lib/session', () => ({
  withSession: (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'acct-1' }),
}));
vi.mock('../../../../../../../lib/env', () => ({
  documentSelfDeleteOn: mocks.selfDeleteOn,
  documentRemovalRequestsOn: mocks.requestsOn,
}));
vi.mock('../../../../../../../lib/step-up', () => ({
  tryEstablishStepUp: mocks.stepUp,
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'This action needs an extra sign-in check.',
}));
vi.mock('../../../../../../../lib/jobs', () => ({ triggerErasureWorker: mocks.worker }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('next/server', () => ({ after: mocks.after }));

import { REMOVAL_WORDS } from '../removal-words';
import { selfDeleteAction, selfDeletePreviewAction } from './actions';
import { GONE, NOT_ALLOWED, SWITCHED_OFF, TYPE_THE_WORD } from './messages';

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
const proof = (applicantId: string) => ({ ok: true, value: { applicant: { id: applicantId } } });
const refused = (code: string, message: string) => ({ ok: false, error: { code, message } });
const done = { ok: true, value: { receiptId: 'r1', documentCode: 'D-7K2Q9M', removal: 'QUEUED' } };

afterEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('Delete My File actions', () => {
  it('do nothing while the switch is off: no proof is asked for, nothing is deleted', async () => {
    mocks.selfDeleteOn.mockReturnValue(false);
    expect(await selfDeletePreviewAction(APPLICANT, DOC)).toEqual({
      ok: false,
      message: SWITCHED_OFF,
      messageKey: REMOVAL_WORDS.deletingNotAvailable,
    });
    expect(await selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE)).toEqual({
      ok: false,
      message: SWITCHED_OFF,
      messageKey: REMOVAL_WORDS.deletingNotAvailable,
    });
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.previewDeleteMyFile).not.toHaveBeenCalled();
    expect(mocks.deleteMyFile).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('turn a malformed id into the same plain answer without reaching the session', async () => {
    mocks.selfDeleteOn.mockReturnValue(true);
    for (const bad of ['', 'not-a-uuid', '../../etc/passwd']) {
      expect(await selfDeleteAction(bad, DOC, 'DELETE', NONE)).toEqual({
        ok: false,
        message: GONE,
        messageKey: REMOVAL_WORDS.fileNoLongerHere,
      });
      expect(await selfDeleteAction(APPLICANT, bad, 'DELETE', NONE)).toEqual({
        ok: false,
        message: GONE,
        messageKey: REMOVAL_WORDS.fileNoLongerHere,
      });
    }
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('ask for the owner MANAGE proof on the document and never trust the page for whose record it is', async () => {
    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof('someone-else'));
    expect(await selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE)).toEqual({
      ok: false,
      message: NOT_ALLOWED,
      messageKey: REMOVAL_WORDS.notOwnerOfRecord,
    });
    expect(await selfDeletePreviewAction(APPLICANT, DOC)).toEqual({
      ok: false,
      message: NOT_ALLOWED,
      messageKey: REMOVAL_WORDS.notOwnerOfRecord,
    });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct-1' },
      'MANAGE',
      { documentId: DOC },
      { purpose: 'owner_document_self_delete' },
    );
    mocks.requireAccess.mockResolvedValue({ ok: false });
    expect((await selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE)).ok).toBe(false);
    expect(mocks.deleteMyFile).not.toHaveBeenCalled();
    expect(mocks.previewDeleteMyFile).not.toHaveBeenCalled();
  });

  it('pass the typed word and what the person saw through to the server, and refuse a word that is not text', async () => {
    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof(APPLICANT));
    mocks.deleteMyFile.mockResolvedValue(done);
    const impact = { ...NONE, shares: 1 };
    await selfDeleteAction(APPLICANT, DOC, 'delete', impact);
    expect(mocks.deleteMyFile).toHaveBeenCalledWith(proof(APPLICANT).value, {
      documentId: DOC,
      typed: 'delete',
      confirmed: impact,
      stepUpSatisfied: false,
    });
    mocks.deleteMyFile.mockReset();
    expect(await selfDeleteAction(APPLICANT, DOC, 7 as unknown as string, NONE)).toEqual({
      ok: false,
      message: TYPE_THE_WORD,
      messageKey: REMOVAL_WORDS.typeTheWordToConfirm,
    });
    expect(mocks.deleteMyFile).not.toHaveBeenCalled();
  });

  it('start the erasure worker after a deletion and say what happened in plain words', async () => {
    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof(APPLICANT));
    mocks.deleteMyFile.mockResolvedValue(done);
    const result = await selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE);
    expect(result).toEqual({
      ok: true,
      message: 'Removing securely. Record D-7K2Q9M is in Removal Records.',
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    const callback = mocks.after.mock.calls[0]?.[0] as () => unknown;
    callback();
    expect(mocks.worker).toHaveBeenCalledWith({ limit: 5 });
  });

  it('do not start the worker when nothing was deleted', async () => {
    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof(APPLICANT));
    mocks.deleteMyFile.mockResolvedValue(refused('invalid', 'a legal hold covers this document'));
    const result = await selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE);
    expect(result.ok).toBe(false);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('ask for a fresh sign-in only when the server says it is needed, then try once more', async () => {
    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof(APPLICANT));
    mocks.deleteMyFile
      .mockResolvedValueOnce(
        refused('step_up_required', 'deleting this document needs a fresh sign-in'),
      )
      .mockResolvedValueOnce(done);
    mocks.stepUp.mockResolvedValue({ kind: 'satisfied' });
    const result = await selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE);
    expect(result.ok).toBe(true);
    expect(mocks.stepUp).toHaveBeenCalledWith(
      { accountId: 'acct-1', action: 'DELETE_DOCUMENT', resourceId: DOC },
      `/app/applicant/${APPLICANT}/documents?manage=${DOC}&action=DELETE_MY_FILE`,
    );
    expect(mocks.deleteMyFile.mock.calls.map((call) => call[1].stepUpSatisfied)).toEqual([
      false,
      true,
    ]);
  });

  it('send the person to sign in again when the session is old, and delete nothing', async () => {
    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof(APPLICANT));
    mocks.deleteMyFile.mockResolvedValue(refused('step_up_required', 'x'));
    mocks.stepUp.mockResolvedValue({ kind: 'reauth_required', reauthUrl: '/reauth?next=here' });
    await expect(selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE)).resolves.toMatchObject({
      ok: false,
      signInHref: '/reauth?next=here',
    });
    expect(mocks.deleteMyFile).toHaveBeenCalledTimes(1);
    mocks.deleteMyFile.mockReset();
    mocks.deleteMyFile.mockResolvedValue(refused('step_up_required', 'x'));
    mocks.stepUp.mockResolvedValue({ kind: 'not_configured' });
    const result = await selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE);
    expect(result).toEqual({ ok: false, message: 'This action needs an extra sign-in check.' });
    expect(mocks.deleteMyFile).toHaveBeenCalledTimes(1);
  });

  it('turn each refusal into plain words, pointing to Ask Us only while that is switched on', async () => {
    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof(APPLICANT));
    const say = async (code: string, message: string) => {
      mocks.deleteMyFile.mockResolvedValue(refused(code, message));
      const result = await selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE);
      return result.ok ? '' : result.message;
    };
    mocks.requestsOn.mockReturnValue(true);
    expect(await say('invalid', 'a finished case used this document')).toBe(
      'A finished case used this file, so it is kept with that case. You can use Ask Us to Remove This File instead.',
    );
    expect(await say('invalid', 'this document answered an agency request')).toContain(
      'Ask Us to Remove This File',
    );
    mocks.requestsOn.mockReturnValue(false);
    expect(await say('invalid', 'a finished case used this document')).toBe(
      'A finished case used this file, so it is kept with that case.',
    );
    expect(await say('invalid', 'a legal hold covers this document')).toContain(
      'legal requirement',
    );
    expect(await say('invalid', 'type the word to confirm')).toBe(TYPE_THE_WORD);
    expect(await say('forbidden', 'only the record owner can delete a document')).toBe(NOT_ALLOWED);
    expect(await say('not_found', 'document not found')).toBe(GONE);
    expect(
      await say('rate_limited', 'too many deletions in a short time, try again later'),
    ).toContain('Try again later');
    expect(await say('stale', 'this document is already deleted')).toContain('Recently Deleted');
    const stale = await (async () => {
      mocks.deleteMyFile.mockResolvedValue(
        refused('stale', 'what deleting this document changes has changed since you looked'),
      );
      return selfDeleteAction(APPLICANT, DOC, 'DELETE', NONE);
    })();
    expect(stale).toMatchObject({ ok: false, stale: true });
    // Words never carry the service's own sentence, a name or an id.
    for (const text of [
      await say('invalid', 'something unexpected with D-123'),
      await say('invalid', 'a legal hold covers this document'),
    ]) {
      expect(text).not.toContain('D-123');
      expect(text).not.toContain('document is');
    }
  });

  it('read the preview through the same proof and give back the counts and the sign-in need', async () => {
    mocks.selfDeleteOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof(APPLICANT));
    mocks.previewDeleteMyFile.mockResolvedValue({
      ok: true,
      value: { impact: { ...NONE, agencies: 2 }, needsFreshSignIn: true },
    });
    expect(await selfDeletePreviewAction(APPLICANT, DOC)).toEqual({
      ok: true,
      impact: { ...NONE, agencies: 2 },
      needsFreshSignIn: true,
    });
    mocks.previewDeleteMyFile.mockResolvedValue(
      refused('invalid', 'a legal hold covers this document'),
    );
    const held = await selfDeletePreviewAction(APPLICANT, DOC);
    expect(!held.ok && held.message).toContain('legal requirement');
  });
});
