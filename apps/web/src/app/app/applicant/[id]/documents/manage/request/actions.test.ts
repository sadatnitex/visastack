import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  requestRemoval: vi.fn(),
  cancelRemovalRequest: vi.fn(),
  pendingRemovalRequests: vi.fn(),
  switchOn: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  requestRemoval: mocks.requestRemoval,
  cancelRemovalRequest: mocks.cancelRemovalRequest,
  pendingRemovalRequests: mocks.pendingRemovalRequests,
  REMOVAL_REQUEST_REASONS: [
    'WRONG_PERSON',
    'UPLOADED_BY_MISTAKE',
    'NO_LONGER_NEEDED',
    'PRIVACY_CONCERN',
    'OTHER',
  ],
  REMOVAL_REQUEST_REFUSALS: {
    notOwner: 'only the record owner can ask for a document to be removed',
    unavailable: 'removal requests are not available yet',
    notLive: 'only a current or archived document can be removed by request',
    legalHold: 'a legal hold covers this document',
    alreadyPending: 'a removal request for this document is already waiting',
    notPending: 'this removal request is no longer waiting',
    reason: 'choose a reason from the list',
  },
}));
vi.mock('../../../../../../../lib/session', () => ({
  withSession: (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'acct-1' }),
}));
vi.mock('../../../../../../../lib/env', () => ({ documentRemovalRequestsOn: mocks.switchOn }));

import { cancelRemovalRequestAction, requestRemovalAction } from './actions';
import { CANCELLED_MESSAGE, NOT_ALLOWED, REQUESTED_MESSAGE } from './messages';

const proof = (applicantId: string) => ({ ok: true, value: { applicant: { id: applicantId } } });

afterEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('removal request actions', () => {
  it('do nothing while the switch is off', async () => {
    mocks.switchOn.mockReturnValue(false);
    const result = await requestRemovalAction('a1', 'd1', 'NO_LONGER_NEEDED');
    expect(result.ok).toBe(false);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.requestRemoval).not.toHaveBeenCalled();
  });

  it('ask for the owner MANAGE proof on the document, never trusting the page', async () => {
    mocks.switchOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof('someone-else'));
    expect(await requestRemovalAction('a1', 'd1', 'NO_LONGER_NEEDED')).toEqual({
      ok: false,
      message: NOT_ALLOWED,
    });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct-1' },
      'MANAGE',
      { documentId: 'd1' },
      { purpose: 'owner_document_removal_request' },
    );
    expect(mocks.requestRemoval).not.toHaveBeenCalled();
  });

  it('refuse a reason outside the list before reaching the service', async () => {
    mocks.switchOn.mockReturnValue(true);
    const result = await requestRemovalAction('a1', 'd1', 'my passport number is 123');
    expect(result.ok).toBe(false);
    expect(mocks.requestRemoval).not.toHaveBeenCalled();
  });

  it('send the request and turn refusals into plain words', async () => {
    mocks.switchOn.mockReturnValue(true);
    mocks.requireAccess.mockResolvedValue(proof('a1'));
    mocks.requestRemoval.mockResolvedValue({ ok: true, value: { id: 'r1', documentCode: 'D-1' } });
    expect(await requestRemovalAction('a1', 'd1', 'PRIVACY_CONCERN')).toEqual({
      ok: true,
      message: REQUESTED_MESSAGE,
    });
    mocks.requestRemoval.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'a legal hold covers this document' },
    });
    const held = await requestRemovalAction('a1', 'd1', 'PRIVACY_CONCERN');
    expect(held.message).toContain('legal requirement');
  });

  it('cancel the waiting request of the document, even with the switch off', async () => {
    mocks.switchOn.mockReturnValue(false);
    mocks.requireAccess.mockResolvedValue(proof('a1'));
    mocks.pendingRemovalRequests.mockResolvedValue(new Map([['d1', 'r1']]));
    mocks.cancelRemovalRequest.mockResolvedValue({ ok: true, value: { documentId: 'd1' } });
    expect(await cancelRemovalRequestAction('a1', 'd1')).toEqual({
      ok: true,
      message: CANCELLED_MESSAGE,
    });
    expect(mocks.cancelRemovalRequest).toHaveBeenCalledWith(proof('a1').value, 'r1');
    mocks.pendingRemovalRequests.mockResolvedValue(new Map());
    expect((await cancelRemovalRequestAction('a1', 'd1')).ok).toBe(false);
  });
});
