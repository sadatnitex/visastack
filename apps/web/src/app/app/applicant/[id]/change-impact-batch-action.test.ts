import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What This Change Affects after "Accept N Clear Details": the batch is saved first, and only
 * then are the first few saved details looked at, one after another. A look can only add to a
 * success: a quiet detail, a refused, failed or thrown read, or a detail past the cap never turns
 * a saved batch into a problem.
 */

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  approveClearProposals: vi.fn(),
  readDetail: vi.fn(),
  order: [] as string[],
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  approveClearProposals: mocks.approveClearProposals,
  registerFieldDefinition: vi.fn(),
}));
vi.mock('../../../../lib/change-impact-read', () => ({
  readDetailChangeImpact: mocks.readDetail,
}));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('../../../../lib/jobs', () => ({ triggerIntakeWorker: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../lib/providers-media', () => ({ createPreviewRenderer: () => undefined }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) => {
    const out = await fn({ db: {}, accountId: 'owner-1' });
    mocks.order.push('approval returned');
    return out;
  },
}));

const { acceptClearDetailsAction } = await import('./actions');
const { DETAIL_RECORDED, QUIET_EMPTY } = await import('./change-impact/fixtures.test-support');

const initial = { ok: true, message: '' };

/** A review of a detail named `fact-N`, with the same things affected as DETAIL_RECORDED. */
function affecting(factId: string) {
  return {
    ...DETAIL_RECORDED,
    subject: {
      kind: 'DETAIL' as const,
      factId,
      label: `Label ${factId}`,
      changedAt: null,
      savedValues: 2,
    },
  };
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `fact-${index + 1}`);
}

function accept() {
  const data = new FormData();
  data.set('applicantId', 'a-1');
  data.append('proposalId', 'p-1');
  data.append('proposalId', 'p-2');
  return acceptClearDetailsAction(initial, data);
}

/** The approval saved these details; each read gives the review `reads(factId)` returns. */
function approvedWith(factIds: string[], reads: (factId: string) => unknown) {
  mocks.approveClearProposals.mockImplementation(async () => {
    mocks.order.push('approved');
    return {
      ok: true,
      value: { approved: factIds.length, leftForReview: 0, alreadyDecided: 0, factIds },
    };
  });
  mocks.readDetail.mockImplementation(async (_applicantId: string, factId: string) => {
    mocks.order.push(`read ${factId}`);
    return reads(factId);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'owner-1' });
});

describe('accepting clear details together', () => {
  it('names what the saved details affect, reading only after the approval has returned', async () => {
    approvedWith(['fact-1', 'fact-2'], affecting);
    const result = await accept();
    expect(result.ok).toBe(true);
    expect(result.changeImpactBatch?.more).toBe(0);
    expect(result.changeImpactBatch?.items).toEqual([
      {
        label: 'Label fact-1',
        summary: {
          href: '/app/applicant/a-1/change-impact?detail=fact-1',
          actionRequired: 2,
          reviewRecommended: 2,
          unknown: 2,
        },
      },
      {
        label: 'Label fact-2',
        summary: {
          href: '/app/applicant/a-1/change-impact?detail=fact-2',
          actionRequired: 2,
          reviewRecommended: 2,
          unknown: 2,
        },
      },
    ]);
    expect(mocks.order).toEqual(['approved', 'approval returned', 'read fact-1', 'read fact-2']);
  });

  it('keeps only the details that affect something', async () => {
    approvedWith(['fact-1', 'fact-2', 'fact-3'], (factId) =>
      factId === 'fact-2' ? affecting(factId) : QUIET_EMPTY,
    );
    const result = await accept();
    expect(result.changeImpactBatch?.items.map((one) => one.label)).toEqual(['Label fact-2']);
    expect(result.changeImpactBatch?.more).toBe(0);
  });

  it('names three and counts the rest', async () => {
    approvedWith(ids(5), affecting);
    const batch = (await accept()).changeImpactBatch;
    expect(batch?.items.map((one) => one.label)).toEqual([
      'Label fact-1',
      'Label fact-2',
      'Label fact-3',
    ]);
    expect(batch?.more).toBe(2);
  });

  it('stops reading at six and counts every detail it did not read', async () => {
    approvedWith(ids(100), affecting);
    const batch = (await accept()).changeImpactBatch;
    expect(mocks.readDetail.mock.calls.map((call) => call[1])).toEqual(ids(6));
    // Three named, three more that affect something, 94 never looked at.
    expect(batch?.items).toHaveLength(3);
    expect(batch?.more).toBe(97);
  });

  it('says some details were not looked at even when the ones read were quiet', async () => {
    approvedWith(ids(8), () => QUIET_EMPTY);
    const batch = (await accept()).changeImpactBatch;
    expect(mocks.readDetail).toHaveBeenCalledTimes(6);
    expect(batch).toEqual({ items: [], more: 2 });
  });

  it('reads one after another, never two at once', async () => {
    approvedWith(ids(6), affecting);
    let running = 0;
    let most = 0;
    mocks.readDetail.mockImplementation(async (_applicantId: string, factId: string) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return affecting(factId);
    });
    await accept();
    expect(mocks.readDetail).toHaveBeenCalledTimes(6);
    expect(most).toBe(1);
  });

  it('adds nothing when every detail is quiet and all were read', async () => {
    approvedWith(['fact-1', 'fact-2'], () => QUIET_EMPTY);
    const result = await accept();
    expect(result.ok).toBe(true);
    expect('changeImpactBatch' in result).toBe(false);
  });

  it('keeps the batch saved, with nothing added for that detail, when a read is refused, fails or throws', async () => {
    approvedWith(['fact-1', 'fact-2', 'fact-3', 'fact-4'], (factId) => {
      if (factId === 'fact-1') return 'refused';
      if (factId === 'fact-2') return 'failed';
      if (factId === 'fact-3') throw new Error('database went away');
      return affecting(factId);
    });
    const result = await accept();
    expect(result.ok).toBe(true);
    expect(result.message).not.toBe('');
    expect(result.changeImpactBatch?.items.map((one) => one.label)).toEqual(['Label fact-4']);
    expect(result.changeImpactBatch?.more).toBe(0);
  });

  it('adds nothing when every read is refused or fails', async () => {
    approvedWith(['fact-1', 'fact-2'], (factId) => (factId === 'fact-1' ? 'refused' : 'failed'));
    const result = await accept();
    expect(result.ok).toBe(true);
    expect('changeImpactBatch' in result).toBe(false);
  });

  it('does not read when nothing was approved, or when the approval was refused', async () => {
    approvedWith([], affecting);
    expect('changeImpactBatch' in (await accept())).toBe(false);
    mocks.approveClearProposals.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'No.' },
    });
    const refused = await accept();
    expect(refused.ok).toBe(false);
    expect('changeImpactBatch' in refused).toBe(false);
    expect(mocks.readDetail).not.toHaveBeenCalled();
  });
});
