import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What This Change Affects after a saved detail: the review is read in its own step, only after
 * the save has returned, and it can only add a notice to a success. A quiet change, a refusal or
 * a failed read leaves the saved result exactly as it was.
 */

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  editFact: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  readDetail: vi.fn(),
  order: [] as string[],
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  editFact: mocks.editFact,
  registerFieldDefinition: vi.fn(),
  approveProposal: mocks.approveProposal,
  rejectProposal: mocks.rejectProposal,
}));
vi.mock('../../../../lib/change-impact-read', () => ({
  readDetailChangeImpact: mocks.readDetail,
}));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('../../../../lib/jobs', () => ({ triggerIntakeWorker: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../lib/providers-media', () => ({ createPreviewRenderer: () => undefined }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) => {
    const out = await fn({ db: {}, accountId: 'owner-1' });
    mocks.order.push('save returned');
    return out;
  },
}));

const { decideProposalAction, saveFactAction } = await import('./actions');
const { DETAIL_INCOMPLETE, DETAIL_RECORDED, QUIET_EMPTY, QUIET_WITH_HISTORY } = await import(
  './change-impact/fixtures.test-support'
);

const FACT = 'f1111111-1111-4111-8111-111111111111';
const initial = { ok: true, message: '' };

function save() {
  const data = new FormData();
  data.set('applicantId', 'a-1');
  data.set('fieldKey', 'annual_income_tax_basis');
  data.set('value', 'Before tax');
  return saveFactAction(initial, data);
}

function approve() {
  const data = new FormData();
  data.set('applicantId', 'a-1');
  data.set('proposalId', 'p-1');
  data.set('proposalAction', 'approve');
  return decideProposalAction(initial, data);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'owner-1' });
  mocks.editFact.mockImplementation(async () => {
    mocks.order.push('saved');
    return { ok: true, value: { fact: { id: FACT }, version: { factId: FACT } } };
  });
  mocks.approveProposal.mockImplementation(async () => {
    mocks.order.push('saved');
    return {
      ok: true,
      value: { fact: { id: FACT }, version: { factId: FACT, status: 'APPLICANT_CONFIRMED' } },
    };
  });
  mocks.readDetail.mockImplementation(async () => {
    mocks.order.push('read');
    return DETAIL_RECORDED;
  });
});

describe.each([
  ['saving a detail', save],
  ['approving a suggested detail', approve],
])('%s', (_name, act) => {
  it('adds the counts and the address of the review to the saved result', async () => {
    const result = await act();
    expect(result.ok).toBe(true);
    expect(result.message).not.toBe('');
    expect(result.changeImpact).toEqual({
      href: '/app/applicant/a-1/change-impact?detail=f-employer',
      actionRequired: 2,
      reviewRecommended: 2,
      unknown: 2,
    });
    expect(mocks.readDetail.mock.calls).toEqual([['a-1', FACT]]);
  });

  it('reads only after the save has returned, never inside it', async () => {
    await act();
    expect(mocks.order).toEqual(['saved', 'save returned', 'read']);
  });

  it('adds nothing for a quiet change', async () => {
    for (const quiet of [QUIET_EMPTY, QUIET_WITH_HISTORY]) {
      mocks.readDetail.mockResolvedValue(quiet);
      const result = await act();
      expect(result.ok).toBe(true);
      expect('changeImpact' in result).toBe(false);
    }
  });

  it('keeps the save a success, with nothing added, when the read fails or is refused', async () => {
    const plain = await (async () => {
      mocks.readDetail.mockResolvedValue(QUIET_EMPTY);
      return act();
    })();
    for (const read of ['failed', 'refused']) {
      mocks.readDetail.mockResolvedValue(read);
      expect(await act()).toEqual(plain);
    }
  });

  it('counts what could not be checked as something to look at', async () => {
    mocks.readDetail.mockResolvedValue(DETAIL_INCOMPLETE);
    expect((await act()).changeImpact).toMatchObject({ actionRequired: 1, unknown: 2 });
  });
});

describe('when nothing was saved', () => {
  it('does not read after a refused save', async () => {
    mocks.editFact.mockResolvedValue({ ok: false, error: { code: 'invalid', message: 'No.' } });
    const result = await save();
    expect(result.ok).toBe(false);
    expect('changeImpact' in result).toBe(false);
    expect(mocks.readDetail).not.toHaveBeenCalled();
  });

  it('does not read for someone else, or after skipping a suggestion', async () => {
    mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'someone-else' });
    expect((await save()).ok).toBe(false);
    mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'owner-1' });
    mocks.rejectProposal.mockResolvedValue({ ok: true, value: {} });
    const data = new FormData();
    data.set('applicantId', 'a-1');
    data.set('proposalId', 'p-1');
    data.set('proposalAction', 'reject');
    const skipped = await decideProposalAction(initial, data);
    expect(skipped).toEqual({ ok: true, message: 'Skipped. Nothing was saved.' });
    expect(mocks.readDetail).not.toHaveBeenCalled();
  });
});
