import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listRequestHistoriesForOwner: vi.fn(),
  listFieldAnswersForOwner: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@visastack/services', () => ({
  REQUEST_HISTORY_MAX_REQUESTS: 100,
  FIELD_ANSWER_MAX_REQUESTS: 100,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  listRequestHistoriesForOwner: mocks.listRequestHistoriesForOwner,
  listFieldAnswersForOwner: mocks.listFieldAnswersForOwner,
}));
vi.mock('../../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));

const { loadRequestHistories } = await import('./request-thread-data');

const field = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, kind: 'FIELD', status: 'ACCEPTED', respondedAt: new Date(), ...over }) as never;
const doc = (id: string) =>
  ({ id, kind: 'DOCUMENT', status: 'RECEIVED', respondedAt: new Date() }) as never;

const emptyHistory = {
  decisions: [],
  sends: { available: true, submissions: [], legacy: [] },
  olderSends: 0,
};
const answers = { available: true, rounds: [], legacyLabel: 'x' };

function setup(fieldResult: unknown) {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'owner' } });
  mocks.listRequestHistoriesForOwner.mockResolvedValue({
    ok: true,
    value: new Map([
      ['f1', emptyHistory],
      ['d1', emptyHistory],
      ['f2', emptyHistory],
    ]),
  });
  mocks.listFieldAnswersForOwner.mockImplementation(async () => fieldResult);
}

const load = (requests: unknown[]) =>
  loadRequestHistories({
    db: {} as never,
    accountId: 'a',
    applicantId: 'p',
    requests: requests as never,
  });

describe('the detail answers on the request page', () => {
  it("reads the exact answers of the listed detail requests only, in the owner's own proof", async () => {
    setup({ ok: true, value: new Map([['f1', answers]]) });
    const out = await load([field('f1'), doc('d1')]);
    expect(mocks.listFieldAnswersForOwner).toHaveBeenCalledTimes(1);
    expect(mocks.listFieldAnswersForOwner).toHaveBeenCalledWith(
      { proof: 'owner' },
      { requestIds: ['f1'] },
    );
    expect(out.get('f1')?.fieldAnswer).toEqual({ state: 'read', value: answers });
    expect(out.get('d1')?.fieldAnswer).toEqual({ state: 'none' });
  });

  it('says unread, never "nothing sent", when the read failed', async () => {
    setup({ ok: false, error: { code: 'invalid', message: 'x' } });
    const out = await load([field('f1')]);
    expect(out.get('f1')?.fieldAnswer).toEqual({ state: 'unread' });
    mocks.listFieldAnswersForOwner.mockRejectedValue(new Error('down'));
    const thrown = await load([field('f1')]);
    expect(thrown.get('f1')?.fieldAnswer).toEqual({ state: 'unread' });
  });

  it('reads nothing for a detail request nobody answered', async () => {
    setup({ ok: true, value: new Map() });
    const out = await load([field('f2', { status: 'OPEN', respondedAt: null })]);
    expect(mocks.listFieldAnswersForOwner).not.toHaveBeenCalled();
    expect(out.get('f2')?.fieldAnswer).toEqual({ state: 'none' });
  });
});
