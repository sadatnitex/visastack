import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  navigationState,
  renderServer,
  stubProps,
  textOf,
} from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  listEmailDeliveryProblems: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'support@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  staffPrincipal: (...args: unknown[]) => mocks.staffPrincipal(...args),
  bootstrapAdminEmails: () => [],
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listEmailDeliveryProblems: (...args: unknown[]) => mocks.listEmailDeliveryProblems(...args),
}));
vi.mock('./forms', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { ResendEmailButton: stub('ResendEmailButton') };
});

const { default: Page } = await import('./page');

const STAFF = { kind: 'staff' };
const row = (n: number, status: string) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  eventType: 'CLIENT_INVITATION_CREATED',
  status,
  attempts: 5,
  lastError: 'Email provider returned status 500',
  createdAt: new Date('2026-10-01T09:00:00Z'),
  nextAttemptAt: new Date('2026-10-01T10:00:00Z'),
  recipientDomain: 'example.org',
});

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/email';
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: STAFF });
  mocks.listEmailDeliveryProblems.mockResolvedValue({
    ok: true,
    value: {
      failed: Array.from({ length: 50 }, (_, n) => row(n, n % 5 === 0 ? 'BOUNCED' : 'FAILED')),
      waiting: Array.from({ length: 50 }, (_, n) => row(100 + n, 'QUEUED')),
      counts: { sentToday: 10, deliveredToday: 8, failedToday: 900, waitingNow: 1000 },
      failedNext: 'FAILED_NEXT',
      waitingNext: 'WAITING_NEXT',
      failedTotal: 1000,
      waitingTotal: 1000,
    },
  });
});

describe('Platform > Email Delivery (WP-SB6)', () => {
  it('keeps both lists in fixed boxes, 50 a load, each with its own next page', async () => {
    const html = await renderServer(Page({ searchParams: Promise.resolve({}) }));
    expect(mocks.listEmailDeliveryProblems).toHaveBeenCalledWith({}, STAFF, expect.any(Date), {});
    expect(html).toContain('aria-label="Emails That Did Not Arrive"');
    expect(html).toContain('aria-label="Emails Still Waiting"');
    expect(html.match(/class="activity-log-scroll staff-queue-panel"/g) ?? []).toHaveLength(2);
    expect(html).toContain('href="/app/admin/email?failedBefore=FAILED_NEXT#email-failed-panel"');
    expect(html).toContain('href="/app/admin/email?waitingAfter=WAITING_NEXT#email-waiting-panel"');
    expect(stubProps(html, 'ResendEmailButton')).toHaveLength(40);
    const text = textOf(html);
    expect(text).toContain('Showing 50 of 1000 emails.');
    expect(text).toContain('Address Refused It');
  });

  it('passes each cursor to its own list and keeps the other list where it was', async () => {
    const html = await renderServer(
      Page({ searchParams: Promise.resolve({ failedBefore: 'F2', waitingAfter: 'W2' }) }),
    );
    expect(mocks.listEmailDeliveryProblems).toHaveBeenCalledWith({}, STAFF, expect.any(Date), {
      failedBefore: 'F2',
      waitingAfter: 'W2',
    });
    expect(html).toContain(
      'href="/app/admin/email?waitingAfter=W2&amp;failedBefore=FAILED_NEXT#email-failed-panel"',
    );
    expect(html).toContain('href="/app/admin/email?waitingAfter=W2#email-failed-panel"');
    expect(textOf(html)).toContain('Show Newest Entries');
  });

  it('ignores a malformed cursor', async () => {
    await renderServer(Page({ searchParams: Promise.resolve({ failedBefore: '<x>' }) }));
    expect(mocks.listEmailDeliveryProblems).toHaveBeenCalledWith({}, STAFF, expect.any(Date), {});
  });

  it('keeps its role check: no support role, no read', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('restricted to platform administrators');
    expect(mocks.listEmailDeliveryProblems).not.toHaveBeenCalled();
    expect(mocks.staffPrincipal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ accountId: 'acct-1' }),
      'PROCESSING_JOB_RETRY',
    );
  });
});
