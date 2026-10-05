import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  listRecentAuditEvents: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({ isPlatformAdmin: mocks.isPlatformAdmin }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listRecentAuditEvents: (...args: unknown[]) => mocks.listRecentAuditEvents(...args),
}));

const { default: Page } = await import('./page');

const event = (seq: number, eventType: string, result: string | null) => ({
  seq,
  eventType,
  result,
  occurredAt: new Date('2026-10-05T10:00:00Z'),
  resourceType: 'mission',
  reason: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/audit';
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.listRecentAuditEvents.mockResolvedValue([
    event(2, 'ACCESS_DENIED', 'DENIED'),
    event(1, 'MISSION_CREATED', 'ALLOWED'),
  ]);
});

describe('Platform > Audit', () => {
  it('lists the newest audit events and says how many it shows', async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Recent audit events');
    expect(text).toContain('The last 2 entries');
    expect(text).toContain('ACCESS_DENIED');
    expect(text).toContain('MISSION_CREATED');
    expect(html).toContain('badge-danger');
    expect(mocks.listRecentAuditEvents).toHaveBeenCalledWith({}, 50);
  });

  it('says there is nothing yet rather than an empty box', async () => {
    mocks.listRecentAuditEvents.mockResolvedValue([]);
    expect(textOf(await renderServer(Page()))).toContain('No audit events recorded yet.');
  });

  it('refuses anyone who is not a platform administrator, without reading the trail', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('restricted to platform administrators');
    expect(mocks.listRecentAuditEvents).not.toHaveBeenCalled();
  });

  it('names the section it could not read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.listRecentAuditEvents.mockRejectedValue(new Error('boom'));
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Some sections could not be loaded');
    expect(text).toContain('audit events');
  });
});
