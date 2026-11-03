import { beforeEach, expect, it, vi } from 'vitest';

/** UMPE P11: a decision on a checklist correction needs pack management rights and records only. */

const mocks = vi.hoisted(() => ({
  staff: { kind: 'staff', accountId: 'synthetic-admin' },
  permission: vi.fn(),
  review: vi.fn(),
  approve: vi.fn(),
  publish: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  reviewChecklistCorrection: mocks.review,
  approvePackVersion: mocks.approve,
  publishPackVersion: mocks.publish,
}));
vi.mock('../../../../../lib/admin', () => ({
  staffPrincipal: async (...args: unknown[]) =>
    (await mocks.permission(...args))
      ? { ok: true, value: mocks.staff }
      : { ok: false, error: { code: 'forbidden', message: 'no' } },
  bootstrapAdminEmails: () => [],
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-admin', email: 'admin@example.com' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { reviewCorrectionAction } from './actions';

const START = { ok: true, message: '' };
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.review.mockResolvedValue({ ok: true, value: { id: 'k1', status: 'ACCEPTED_FOR_DRAFT' } });
});

it('refuses without pack management rights and decides nothing', async () => {
  mocks.permission.mockResolvedValue(false);
  const result = await reviewCorrectionAction(
    START,
    form({ correctionId: 'k1', decision: 'DISMISSED' }),
  );
  expect(result).toEqual({ ok: false, message: 'Not authorized.' });
  expect(mocks.review).not.toHaveBeenCalled();
  expect(mocks.permission.mock.calls[0]?.[2]).toBe('PACK_MANAGE');
});

it('refuses a decision that is not one of the three', async () => {
  const result = await reviewCorrectionAction(
    START,
    form({ correctionId: 'k1', decision: 'PUBLISHED' }),
  );
  expect(result.ok).toBe(false);
  expect(mocks.review).not.toHaveBeenCalled();
});

it('Accept for Draft records the decision only: nothing is approved or published', async () => {
  const result = await reviewCorrectionAction(
    START,
    form({ correctionId: 'k1', decision: 'ACCEPTED_FOR_DRAFT', note: 'Next draft.' }),
  );
  expect(result).toEqual({
    ok: true,
    message: 'Decision recorded. Write the change as a draft version in Pack Studio.',
  });
  expect(mocks.review).toHaveBeenCalledWith({}, mocks.staff, {
    correctionId: 'k1',
    decision: 'ACCEPTED_FOR_DRAFT',
    note: 'Next draft.',
  });
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});
