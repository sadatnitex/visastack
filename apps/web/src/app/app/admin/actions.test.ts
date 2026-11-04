import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The overview and privacy actions: who may run them, the fresh sign-in rule and the audit trail. */

const mocks = vi.hoisted(() => ({
  hasPlatformPermission: vi.fn(),
  setRetentionPolicy: vi.fn(),
  retryFailedJob: vi.fn(),
  retryErasureJob: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  setRetentionPolicy: mocks.setRetentionPolicy,
  retryFailedJob: mocks.retryFailedJob,
  retryErasureJob: mocks.retryErasureJob,
}));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'staff-1', email: 'staff@example.com' }),
}));
vi.mock('../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  hasPlatformPermission: mocks.hasPlatformPermission,
  isPlatformOwnerAccount: vi.fn(),
}));
vi.mock('../../../lib/step-up', () => ({
  tryEstablishStepUp: mocks.tryEstablishStepUp,
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Step-up is not configured here.',
}));
vi.mock('../../../lib/jobs', () => ({
  triggerErasureWorker: vi.fn(),
  triggerNotificationWorker: vi.fn(),
}));
vi.mock('../../../lib/storage', () => ({ createStorage: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/server', () => ({ after: (work: () => unknown) => work() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { retryErasureJobAction, retryJobAction, setRetentionPolicyAction } from './actions';

const INITIAL = { ok: true, message: '' };
const EM_DASH = String.fromCharCode(0x2014);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const policy = form({ docType: 'passport', retentionDays: '30' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPlatformPermission.mockResolvedValue(true);
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
  mocks.setRetentionPolicy.mockResolvedValue({ ok: true, value: {} });
});

describe('changing a retention policy', () => {
  it('needs the compliance role first', async () => {
    mocks.hasPlatformPermission.mockResolvedValue(false);
    const result = await setRetentionPolicyAction(INITIAL, policy);
    expect(result).toEqual({ ok: false, message: 'Not authorized.' });
    expect(mocks.hasPlatformPermission.mock.calls[0]?.[2]).toBe('RETENTION_POLICY_SET');
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
    expect(mocks.setRetentionPolicy).not.toHaveBeenCalled();
  });

  it('sends the person to sign in again, and changes nothing, when the last sign-in is stale', async () => {
    mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'reauth_required', reauthUrl: '/again' });
    await expect(setRetentionPolicyAction(INITIAL, policy)).rejects.toThrow('NEXT_REDIRECT:/again');
    expect(mocks.setRetentionPolicy).not.toHaveBeenCalled();
  });

  it('says plainly when the fresh sign-in check is not set up here', async () => {
    mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'not_configured' });
    const result = await setRetentionPolicyAction(INITIAL, policy);
    expect(result.ok).toBe(false);
    expect(mocks.setRetentionPolicy).not.toHaveBeenCalled();
  });

  it('passes the fresh sign-in proof to the service once it is established', async () => {
    const result = await setRetentionPolicyAction(INITIAL, policy);
    expect(result.ok).toBe(true);
    expect(mocks.tryEstablishStepUp.mock.calls[0]?.[0]).toMatchObject({
      action: 'RETENTION_POLICY_SET',
    });
    expect(mocks.setRetentionPolicy.mock.calls[0]?.[1]).toMatchObject({
      actorAccountId: 'staff-1',
      retentionDays: 30,
      stepUpSatisfied: true,
    });
  });
});

describe('retrying a stuck job', () => {
  it('names the staff member to the service so the retry is on the record', async () => {
    mocks.retryFailedJob.mockResolvedValue(true);
    const result = await retryJobAction(INITIAL, form({ jobId: 'job-1' }));
    expect(result.ok).toBe(true);
    expect(mocks.retryFailedJob).toHaveBeenCalledWith({}, 'job-1', 'staff-1');
  });

  it('does the same for a deletion job, and never runs for the wrong role', async () => {
    mocks.retryErasureJob.mockResolvedValue(true);
    await retryErasureJobAction(INITIAL, form({ jobId: 'er-1' }));
    expect(mocks.retryErasureJob).toHaveBeenCalledWith({}, 'er-1', 'staff-1');
    mocks.hasPlatformPermission.mockResolvedValue(false);
    mocks.retryErasureJob.mockClear();
    expect((await retryErasureJobAction(INITIAL, form({ jobId: 'er-1' }))).ok).toBe(false);
    expect(mocks.retryErasureJob).not.toHaveBeenCalled();
  });

  it('writes plain sentences with no dash used as punctuation', async () => {
    mocks.retryFailedJob.mockResolvedValue(false);
    mocks.retryErasureJob.mockResolvedValue(false);
    const one = await retryJobAction(INITIAL, form({ jobId: 'job-1' }));
    const two = await retryErasureJobAction(INITIAL, form({ jobId: 'er-1' }));
    expect(one.message).toBe('That job is no longer failed. It may have already been retried.');
    for (const result of [one, two]) expect(result.message).not.toContain(EM_DASH);
  });
});
