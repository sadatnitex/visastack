import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  listRecentAuditEvents: vi.fn(),
  staffPrincipal: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  isPlatformAdmin: mocks.isPlatformAdmin,
  bootstrapAdminEmails: () => [],
  staffPrincipal: (...args: unknown[]) => mocks.staffPrincipal(...args),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listRecentAuditEvents: (...args: unknown[]) => mocks.listRecentAuditEvents(...args),
}));

const { default: Page } = await import('./page');

const event = (
  seq: number,
  eventType: string,
  result: string | null,
  actor: { actorAccountId?: string | null; actorEmail?: string | null } = {},
) => ({
  seq,
  eventType,
  result,
  occurredAt: new Date('2026-10-05T10:00:00Z'),
  resourceType: 'mission',
  reason: null,
  actorAccountId: actor.actorAccountId ?? null,
  actorEmail: actor.actorEmail ?? null,
});

const page = (
  items: unknown[],
  nextCursor: string | null = null,
  whoMatched: boolean | null = null,
) => ({
  ok: true,
  value: { items, nextCursor, whoMatched },
});

const STAFF = { kind: 'staff' };

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/app/admin/audit';
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: STAFF });
  mocks.listRecentAuditEvents.mockResolvedValue(
    page([event(2, 'ACCESS_DENIED', 'DENIED'), event(1, 'MISSION_CREATED', 'ALLOWED')]),
  );
});

describe('Platform > Audit', () => {
  it('lists the newest audit events and says how many it shows', async () => {
    const html = await renderServer(Page({}));
    const text = textOf(html);
    expect(text).toContain('Recent Audit Events');
    expect(text).toContain('The 2 newest entries');
    expect(text).toContain('ACCESS_DENIED');
    expect(text).toContain('MISSION_CREATED');
    expect(html).toContain('badge-danger');
    expect(mocks.listRecentAuditEvents).toHaveBeenCalledWith({}, STAFF, { limit: 50 });
  });

  it('reads 50 entries a time into the fixed log box, with Show Older Entries from the server', async () => {
    const many = Array.from({ length: 50 }, (_, n) =>
      event(1000 - n, 'MISSION_CREATED', 'ALLOWED', {
        actorAccountId: n % 3 === 0 ? 'acct-x' : null,
        actorEmail: n % 3 === 0 ? 'agent@example.test' : null,
      }),
    );
    mocks.listRecentAuditEvents.mockResolvedValue(page(many, 'CURSOR_950'));
    const html = await renderServer(Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('class="activity-log-scroll"');
    expect(html.match(/class="row activity-log-row"/g) ?? []).toHaveLength(50);
    expect(html).toContain('href="/app/admin/audit?before=CURSOR_950#admin-audit-log"');
    expect(textOf(html)).toContain('Show Older Entries');
    expect(textOf(html)).toContain('agent@example.test');
    expect(textOf(html)).toContain('System');
    // The newest page has no way back to itself.
    expect(textOf(html)).not.toContain('Show Newest Entries');
  });

  it('passes an older-page cursor and the Who search to the server, and keeps Who when paging', async () => {
    mocks.listRecentAuditEvents.mockResolvedValue(
      page([event(5, 'MISSION_CREATED', 'ALLOWED', { actorEmail: 'a@example.test' })], 'NEXT'),
    );
    const html = await renderServer(
      Page({ searchParams: Promise.resolve({ before: 'PREV', who: ' A@Example.TEST ' }) }),
    );
    expect(mocks.listRecentAuditEvents).toHaveBeenCalledWith({}, STAFF, {
      limit: 50,
      before: 'PREV',
      who: 'a@example.test',
    });
    expect(html).toContain(
      'href="/app/admin/audit?who=a%40example.test&amp;before=NEXT#admin-audit-log"',
    );
    expect(html).toContain('href="/app/admin/audit?who=a%40example.test#admin-audit-log"');
    expect(textOf(html)).toContain('Showing only what a@example.test did');
    expect(html).toContain('name="who"');
  });

  it('ignores a malformed cursor or Who value instead of failing', async () => {
    await renderServer(
      Page({ searchParams: Promise.resolve({ before: '<script>', who: 'not an email' }) }),
    );
    expect(mocks.listRecentAuditEvents).toHaveBeenCalledWith({}, STAFF, { limit: 50 });
  });

  it('says when no current account has the email, apart from an account with no entries', async () => {
    mocks.listRecentAuditEvents.mockResolvedValue(page([], null, false));
    const text = textOf(
      await renderServer(Page({ searchParams: Promise.resolve({ who: 'gone@example.test' }) })),
    );
    expect(text).toContain('No Account with This Email');
    expect(text).toContain('Removed Account');
    expect(text).not.toContain('Nothing in the audit trail was done by');
  });

  it('names its email search for its own job, apart from the log Who filter', async () => {
    const html = await renderServer(Page({ searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/<label class="field-label" for="audit-who">Find by Email<\/label>/);
  });

  it('says when one person has no entries', async () => {
    mocks.listRecentAuditEvents.mockResolvedValue(page([], null, true));
    const text = textOf(
      await renderServer(Page({ searchParams: Promise.resolve({ who: 'x@example.test' }) })),
    );
    expect(text).toContain('No Entries for This Person');
  });

  it('says there is nothing yet rather than an empty box', async () => {
    mocks.listRecentAuditEvents.mockResolvedValue(page([]));
    expect(textOf(await renderServer(Page({})))).toContain('No Audit Events Yet');
  });

  it('refuses anyone who is not a platform administrator, without reading the trail', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    const html = await renderServer(Page({}));
    expect(textOf(html)).toContain('restricted to platform administrators');
    expect(mocks.listRecentAuditEvents).not.toHaveBeenCalled();
  });

  it('tells an administrator whose role does not cover the trail, without reading it', async () => {
    mocks.staffPrincipal.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'no role' },
    });
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Not available for your role');
    expect(mocks.listRecentAuditEvents).not.toHaveBeenCalled();
    expect(mocks.staffPrincipal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ accountId: 'acct-1' }),
      'AUDIT_TRAIL_VIEW',
    );
  });

  it('names the section it could not read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.listRecentAuditEvents.mockRejectedValue(new Error('boom'));
    const text = textOf(await renderServer(Page({})));
    expect(text).toContain('Some Sections Could Not Be Loaded');
    expect(text).toContain('audit events');
  });
});
