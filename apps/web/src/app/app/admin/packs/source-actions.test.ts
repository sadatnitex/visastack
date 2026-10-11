import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ permission: vi.fn(), add: vi.fn(), review: vi.fn() }));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  addRequirement: mocks.add,
  recordRequirementSourceReview: mocks.review,
}));
vi.mock('../../../../lib/admin', () => ({ hasPlatformPermission: mocks.permission }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-reviewer', email: 'reviewer@example.com' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { addRequirementAction, recordRequirementSourceReviewAction } from './actions';

beforeEach(() => {
  mocks.permission.mockResolvedValue(true);
  mocks.add.mockResolvedValue({ ok: true, value: {} });
  mocks.review.mockResolvedValue({ ok: true, value: {} });
});
afterEach(() => {
  vi.resetAllMocks();
});
const form = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    packId: 'synthetic-pack',
    packVersionId: 'synthetic-version',
    kind: 'FIELD',
    key: 'passport_expiry',
    citation: 'Official rule',
    sourceUrl: 'https://example.com/rule',
    sourceTitle: 'Entry requirements',
    publisher: 'Synthetic authority',
    observedDate: '2026-01-01',
  }))
    data.set(key, value);
  return data;
};
it('passes the human source record through the authorized service path', async () => {
  expect((await addRequirementAction({ ok: true, message: '' }, form())).ok).toBe(true);
  expect(mocks.add.mock.calls[0]?.[1]).toMatchObject({
    sourceUrl: 'https://example.com/rule',
    sourceTitle: 'Entry requirements',
    publisher: 'Synthetic authority',
    observedDate: new Date('2026-01-01'),
  });
});
it('refuses invalid or future dates before persisting a source record', async () => {
  for (const value of ['not-a-date', '2026-02-30', '9999-01-01']) {
    const data = form();
    data.set('observedDate', value);
    expect((await addRequirementAction({ ok: true, message: '' }, data)).ok).toBe(false);
  }
  expect(mocks.add).not.toHaveBeenCalled();
});
it('preserves source-free custom checklist input without inventing verification', async () => {
  const data = form();
  for (const key of ['sourceUrl', 'sourceTitle', 'publisher', 'observedDate']) data.delete(key);
  expect((await addRequirementAction({ ok: true, message: '' }, data)).ok).toBe(true);
  expect(mocks.add.mock.calls[0]?.[1]).not.toHaveProperty('observedDate');
  expect(mocks.add.mock.calls[0]?.[1]).not.toHaveProperty('sourceUrl');
});
it('does not let source metadata bypass pack-management permission', async () => {
  mocks.permission.mockResolvedValue(false);
  expect((await addRequirementAction({ ok: true, message: '' }, form())).ok).toBe(false);
  expect(mocks.add).not.toHaveBeenCalled();
});

it('saves a draft source review through the existing permission boundary', async () => {
  const data = form();
  data.set('requirementId', 'synthetic-requirement');
  expect((await recordRequirementSourceReviewAction({ ok: true, message: '' }, data)).ok).toBe(
    true,
  );
  expect(mocks.review.mock.calls[0]?.[1]).toMatchObject({
    requirementId: 'synthetic-requirement',
    publisher: 'Synthetic authority',
    observedDate: new Date('2026-01-01'),
  });
  mocks.permission.mockResolvedValue(false);
  mocks.review.mockClear();
  expect((await recordRequirementSourceReviewAction({ ok: true, message: '' }, data)).ok).toBe(
    false,
  );
  expect(mocks.review).not.toHaveBeenCalled();
});
