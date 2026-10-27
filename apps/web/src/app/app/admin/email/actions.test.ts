import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  resendEmail: vi.fn(),
  triggerNotificationWorker: vi.fn(),
  revalidatePath: vi.fn(),
  after: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  resendEmail: mocks.resendEmail,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-admin', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: mocks.staffPrincipal,
}));
vi.mock('../../../../lib/jobs', () => ({
  triggerNotificationWorker: mocks.triggerNotificationWorker,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/server', () => ({ after: mocks.after }));
import { EMAIL_RESEND_REFUSED } from '@visastack/services';
import { resendEmailAction } from './actions';
import { EMAIL_KIND_LABELS, emailKindLabel, emailProblemReason } from './labels';

const SCOPE = { kind: 'staff', platformAction: 'PROCESSING_JOB_RETRY' };
const INITIAL = { ok: true, message: '' };
const ID = '3b85b469-4d6f-4d94-8eeb-bab0e47fde42';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.triggerNotificationWorker.mockResolvedValue({ sent: 1, retrying: 0, failed: 0 });
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('resendEmailAction', () => {
  it('needs an email id before anything else runs', async () => {
    const result = await resendEmailAction(INITIAL, form({ notificationId: ' ' }));
    expect(result.ok).toBe(false);
    expect(mocks.staffPrincipal).not.toHaveBeenCalled();
    expect(mocks.resendEmail).not.toHaveBeenCalled();
  });

  it('refuses staff without the processing retry permission', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const result = await resendEmailAction(INITIAL, form({ notificationId: ID }));
    expect(result.message).toContain('support admin or platform owner');
    expect(mocks.staffPrincipal.mock.calls[0]?.[1]).toEqual({
      accountId: 'synthetic-admin',
      email: 'admin@example.com',
      bootstrapEmails: [],
    });
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('PROCESSING_JOB_RETRY');
    expect(mocks.resendEmail).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('sends again with the live scope, refreshes the page and starts a short send pass', async () => {
    mocks.resendEmail.mockResolvedValue({ ok: true, value: { id: ID, resourceId: 'inv-1' } });
    const result = await resendEmailAction(INITIAL, form({ notificationId: ID }));
    expect(result.ok).toBe(true);
    expect(mocks.resendEmail).toHaveBeenCalledWith({}, SCOPE, { notificationId: ID });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/admin/email');
    expect(mocks.after).toHaveBeenCalledTimes(1);
    const task = mocks.after.mock.calls[0]?.[0] as () => Promise<unknown>;
    await expect(task()).resolves.toBeUndefined();
    expect(mocks.triggerNotificationWorker).toHaveBeenCalledWith({
      limit: 5,
      timeBudgetMs: 15_000,
      resourceId: 'inv-1',
    });
  });

  it('explains each refusal in plain words and starts nothing', async () => {
    for (const message of Object.values(EMAIL_RESEND_REFUSED)) {
      mocks.resendEmail.mockResolvedValueOnce({ ok: false, error: { code: 'invalid', message } });
      const result = await resendEmailAction(INITIAL, form({ notificationId: ID }));
      expect(result.ok).toBe(false);
      expect(result.message).not.toBe(message);
      expect(result.message).toMatch(/^[A-Z]/);
    }
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('email delivery wording', () => {
  it('names every known kind in Title Case and falls back for an unknown one', () => {
    expect(emailKindLabel('MISSION_STATUS_CHANGED')).toBe('Case Update');
    expect(emailKindLabel('SOMETHING_NEW')).toBe('Other Email');
    expect(emailKindLabel('toString')).toBe('Other Email');
    for (const label of Object.values(EMAIL_KIND_LABELS)) {
      expect(label).not.toMatch(/mission/i);
    }
  });

  it('never shows the stored reason itself', () => {
    const stored = [
      'recipient no longer authorized',
      'no recipient email resolvable',
      'Email provider not configured',
      'Email provider unavailable or request timed out',
      'Email provider did not confirm acceptance',
      'Email provider returned status 503',
      'Email provider returned status 422',
      'Invalid email idempotency key',
      'Email delivery failed; provider acceptance was not confirmed',
      'The email provider rejected this message.',
      'something unexpected with secret@example.com',
    ];
    for (const error of stored) {
      const reason = emailProblemReason('FAILED', error);
      expect(reason).not.toBe(error);
      expect(reason).not.toMatch(/provider|status \d|idempotency|@/i);
    }
    expect(emailProblemReason('BOUNCED', null)).toContain('refused');
    expect(emailProblemReason('FAILED', null)).toMatch(/^The email/);
  });
});
