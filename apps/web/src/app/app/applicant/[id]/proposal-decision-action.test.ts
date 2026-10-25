import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  approveClearProposals: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  approveProposal: mocks.approveProposal,
  rejectProposal: mocks.rejectProposal,
  approveClearProposals: mocks.approveClearProposals,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn }));
vi.mock('../../../../lib/jobs', () => ({ triggerIntakeWorker: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({
  createKeyManagementPort: () => undefined,
  createPreviewRenderer: () => undefined,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'owner-1' }),
}));

const { acceptClearDetailsAction, decideProposalAction } = await import('./actions');
const { describeClearAcceptance } = await import('./ai-review-messages');

const initial = { ok: true, message: '' };
function decide(fields: Record<string, string>): FormData {
  const form = new FormData();
  form.set('applicantId', 'a-1');
  form.set('proposalId', 'p-1');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'owner-1' });
  mocks.rejectProposal.mockResolvedValue({ ok: true, value: {} });
  mocks.approveProposal.mockResolvedValue({
    ok: true,
    value: { version: { status: 'APPLICANT_CONFIRMED' } },
  });
});

describe('deciding one reading', () => {
  it('"keep my current value" changes nothing: it sets the reading aside', async () => {
    const result = await decideProposalAction(
      initial,
      decide({ proposalAction: 'approve', resolution: 'keep' }),
    );
    expect(result).toEqual({ ok: true, message: 'Kept your current value. Nothing was changed.' });
    expect(mocks.approveProposal).not.toHaveBeenCalled();
    expect(mocks.rejectProposal).toHaveBeenCalledWith(
      {},
      { actorAccountId: 'owner-1', proposalId: 'p-1', reason: 'kept_existing' },
    );
  });

  it.each([
    ['', 'no date'],
    ['2021-02-31', 'a day that does not exist'],
    ['2021-2-3', 'a loose format'],
    ['2999-01-01', 'a date in the future'],
  ])('refuses "it changed" with %j (%s)', async (effectiveFrom) => {
    const result = await decideProposalAction(
      initial,
      decide({ proposalAction: 'approve', resolution: 'changed', effectiveFrom }),
    );
    expect(result).toMatchObject({ ok: false, field: 'effectiveFrom' });
    expect(mocks.approveProposal).not.toHaveBeenCalled();
  });

  it('passes a real past date through when both values are right', async () => {
    const result = await decideProposalAction(
      initial,
      decide({ proposalAction: 'approve', resolution: 'changed', effectiveFrom: '2020-03-01' }),
    );
    expect(result.message).toBe('Saved as the new value. The earlier one stays in your history.');
    expect(mocks.approveProposal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        resolution: 'changed',
        effectiveFrom: new Date('2020-03-01T00:00:00Z'),
      }),
    );
  });

  it('refuses an unknown choice, and someone else’s applicant', async () => {
    expect(
      await decideProposalAction(initial, decide({ proposalAction: 'approve', resolution: 'x' })),
    ).toMatchObject({ ok: false, field: 'resolution' });
    mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'someone-else' });
    expect(await decideProposalAction(initial, decide({ proposalAction: 'reject' }))).toEqual({
      ok: false,
      message: 'Not authorized.',
    });
    expect(mocks.rejectProposal).not.toHaveBeenCalled();
  });
});

describe('accepting clear details at once', () => {
  it('reports what was saved, what was already decided and what needs a closer look', async () => {
    mocks.approveClearProposals.mockResolvedValue({
      ok: true,
      value: { approved: 2, leftForReview: 1, alreadyDecided: 1 },
    });
    const form = new FormData();
    form.set('applicantId', 'a-1');
    form.append('proposalId', 'p-1');
    form.append('proposalId', 'p-2');
    const result = await acceptClearDetailsAction(initial, form);
    expect(result).toEqual({
      ok: true,
      message:
        'Saved 2 details to your profile. 1 was already decided. 1 needs a closer look before you accept it.',
    });
  });

  it('shows the reason when nothing could be saved', async () => {
    mocks.approveClearProposals.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'Turn on processing to save details.' },
    });
    const form = new FormData();
    form.set('applicantId', 'a-1');
    form.append('proposalId', 'p-1');
    expect(await acceptClearDetailsAction(initial, form)).toEqual({
      ok: false,
      message: 'Turn on processing to save details.',
    });
  });

  it('words every combination plainly', () => {
    expect(describeClearAcceptance({ approved: 1, leftForReview: 0, alreadyDecided: 0 })).toBe(
      'Saved 1 detail to your profile.',
    );
    expect(describeClearAcceptance({ approved: 0, leftForReview: 2, alreadyDecided: 3 })).toBe(
      'Nothing new was saved. 3 were already decided. 2 need a closer look before you accept them.',
    );
  });
});
