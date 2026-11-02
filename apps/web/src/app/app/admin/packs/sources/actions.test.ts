import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/** UMPE P10: the Official Sources actions keep to pack management rights and never touch a pack. */

const mocks = vi.hoisted(() => ({
  staff: { kind: 'staff', accountId: 'synthetic-admin' },
  permission: vi.fn(),
  register: vi.fn(),
  deactivate: vi.fn(),
  review: vi.fn(),
  run: vi.fn(),
  approve: vi.fn(),
  publish: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  registerOfficialSource: mocks.register,
  deactivateOfficialSource: mocks.deactivate,
  reviewSourceChangeCandidate: mocks.review,
  runSourceCheck: mocks.run,
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
import {
  checkNowAction,
  deactivateSourceAction,
  registerSourceAction,
  reviewCandidateAction,
} from './actions';

const START = { ok: true, message: '' };
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const sourceForm = () =>
  form({
    jurisdiction: 'GB',
    url: 'https://visas.synthetic-gov.example/visit',
    title: 'Synthetic Visit Page',
    publisher: 'Synthetic Authority',
    authorityTier: 'GOVERNMENT',
    route: 'visit',
  });

beforeEach(() => {
  mocks.permission.mockResolvedValue(true);
  mocks.register.mockResolvedValue({ ok: true, value: { id: 's1' } });
  mocks.deactivate.mockResolvedValue({ ok: true, value: { id: 's1' } });
  mocks.review.mockResolvedValue({ ok: true, value: { id: 'c1', status: 'DISMISSED' } });
  mocks.run.mockResolvedValue({
    status: 'COMPLETED',
    sourcesDue: 3,
    checked: 2,
    changed: 1,
    blocked: 1,
    failed: 0,
    unsupported: 0,
    deferred: 0,
  });
});
afterEach(() => {
  vi.resetAllMocks();
});

it('refuses every action without pack management rights', async () => {
  mocks.permission.mockResolvedValue(false);
  expect((await registerSourceAction(START, sourceForm())).ok).toBe(false);
  expect((await deactivateSourceAction(START, form({ sourceId: 's1' }))).ok).toBe(false);
  expect((await checkNowAction(START, form({}))).ok).toBe(false);
  expect(
    (await reviewCandidateAction(START, form({ candidateId: 'c1', decision: 'DISMISSED' }))).ok,
  ).toBe(false);
  for (const fn of [mocks.register, mocks.deactivate, mocks.run, mocks.review]) {
    expect(fn).not.toHaveBeenCalled();
  }
  expect(mocks.permission.mock.calls.every((call) => call[2] === 'PACK_MANAGE')).toBe(true);
});

it('registers a source through the service with the signed-in actor', async () => {
  expect((await registerSourceAction(START, sourceForm())).ok).toBe(true);
  expect(mocks.register.mock.calls[0]?.[1]).toBe(mocks.staff);
  expect(mocks.register.mock.calls[0]?.[2]).toMatchObject({
    jurisdiction: 'GB',
    url: 'https://visas.synthetic-gov.example/visit',
    route: 'visit',
  });
  const missing = sourceForm();
  missing.delete('url');
  const result = await registerSourceAction(START, missing);
  expect(result).toMatchObject({ ok: false, field: 'url' });
});

it('runs Check Now as a manual run, one source when asked, and reports counts in plain words', async () => {
  const result = await checkNowAction(START, form({ sourceId: 's1' }));
  expect(result).toEqual({
    ok: true,
    message: 'Checked 2 of 3. 1 changed and waiting for review. 1 could not be read.',
  });
  expect(mocks.run.mock.calls[0]?.[1]).toBe(mocks.staff);
  expect(mocks.run.mock.calls[0]?.[2]).toMatchObject({ sourceId: 's1' });
  mocks.run.mockResolvedValue({ status: 'NOT_READY' });
  expect((await checkNowAction(START, form({}))).ok).toBe(false);
});

it('records a decision only: accepting never approves or publishes a pack version', async () => {
  const result = await reviewCandidateAction(
    START,
    form({ candidateId: 'c1', decision: 'ACCEPTED_FOR_DRAFT', note: 'Fee changed.' }),
  );
  expect(result.ok).toBe(true);
  expect(mocks.review.mock.calls[0]?.[1]).toBe(mocks.staff);
  expect(mocks.review.mock.calls[0]?.[2]).toMatchObject({
    candidateId: 'c1',
    decision: 'ACCEPTED_FOR_DRAFT',
    note: 'Fee changed.',
  });
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(
    (await reviewCandidateAction(START, form({ candidateId: 'c1', decision: 'PUBLISHED' }))).ok,
  ).toBe(false);
});
