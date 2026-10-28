import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Start a New Case from This One checks its dates the same way as Start a Case: an impossible
 * date is refused in the same words, never silently dropped from the new case.
 */

const mocks = vi.hoisted(() => ({
  prepareCaseAgain: vi.fn(),
  requireAccess: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock('@visastack/services', () => ({
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  prepareCaseAgain: mocks.prepareCaseAgain,
  requireAccess: mocks.requireAccess,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'owner' }),
}));

const { prepareCaseAgainAction } = await import('./actions');

const form = (values: Record<string, string>) => {
  const data = new FormData();
  data.set('applicantId', 'applicant-1');
  data.set('from', 'case-0');
  data.set('title', 'Japan visitor visa 2027');
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { applicant: { id: 'applicant-1' } } });
  mocks.prepareCaseAgain.mockResolvedValue({ ok: true, value: { id: 'case-2' } });
});

describe('prepareCaseAgainAction dates', () => {
  it('refuses an impossible date in the same words as Start a Case, and makes no case', async () => {
    const result = await prepareCaseAgainAction(
      { ok: true, message: '' },
      form({ targetDeadline: '2026-02-30' }),
    );
    expect(result).toMatchObject({
      ok: false,
      message: 'Check the field marked above.',
      field: 'targetDeadline',
      fieldErrors: { targetDeadline: 'Enter a full date: day, month and year.' },
      values: { title: 'Japan visitor visa 2027', targetDeadline: '2026-02-30' },
      attempt: 1,
    });
    expect(mocks.prepareCaseAgain).not.toHaveBeenCalled();
  });

  it('names every problem beside its field and focuses the first, as Start a Case does', async () => {
    const data = form({ travelStartDate: '2027-03-10', travelEndDate: '2027-03-01' });
    data.set('title', ' ');
    const result = await prepareCaseAgainAction({ ok: false, message: '', attempt: 2 }, data);
    expect(result.field).toBe('title');
    expect(result.fieldErrors).toEqual({
      title: 'Give the case a name, for example the visa and the year.',
      travelEndDate: 'The trip cannot end before it starts.',
    });
    expect(result.message).toBe('Check the 2 fields marked above.');
    expect(result.attempt).toBe(3);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('refuses a trip that ends before it starts', async () => {
    const result = await prepareCaseAgainAction(
      { ok: true, message: '' },
      form({ travelStartDate: '2027-03-10', travelEndDate: '2027-03-01' }),
    );
    expect(result.fieldErrors).toEqual({ travelEndDate: 'The trip cannot end before it starts.' });
    expect(mocks.prepareCaseAgain).not.toHaveBeenCalled();
  });

  it('carries real dates to the new case and opens it', async () => {
    await expect(
      prepareCaseAgainAction(
        { ok: true, message: '' },
        form({ travelStartDate: '2027-03-01', travelEndDate: '2027-03-10' }),
      ),
    ).rejects.toThrow('REDIRECT /app/mission/case-2?welcome=1');
    expect(mocks.prepareCaseAgain).toHaveBeenCalledWith(
      { applicant: { id: 'applicant-1' } },
      expect.objectContaining({
        travelStartDate: new Date('2027-03-01T00:00:00.000Z'),
        travelEndDate: new Date('2027-03-10T00:00:00.000Z'),
      }),
    );
  });
});
