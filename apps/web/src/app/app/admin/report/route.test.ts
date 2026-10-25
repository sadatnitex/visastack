import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getPlatformOverview: vi.fn() }));
vi.mock('@visastack/services', () => mocks);
vi.mock('../../../../lib/admin', () => ({ bootstrapAdminEmails: () => [] }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'trusted-role', email: 'synthetic@example.test' }),
}));
const { GET } = await import('./route');
beforeEach(() => vi.clearAllMocks());
it('refuses the current actor when the independent service permission check denies access', async () => {
  mocks.getPlatformOverview.mockResolvedValue({ ok: false });
  const response = await GET();
  expect(response.status).toBe(403);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.text()).not.toContain('Registered Accounts');
  expect(mocks.getPlatformOverview.mock.calls[0]?.[1]).toEqual({
    accountId: 'trusted-role',
    email: 'synthetic@example.test',
    bootstrapEmails: [],
  });
});
it('downloads exact aggregate rows without identities and makes failed reads explicit', async () => {
  mocks.getPlatformOverview.mockResolvedValue({
    ok: true,
    value: {
      accounts: 4,
      travellers: 3,
      agencies: 2,
      approvedVersions: 1,
      terminalVersions: 2,
      activity: [{ day: '2026-10-11', activated: 1, cases: 2 }],
    },
  });
  const response = await GET();
  const csv = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Disposition')).toContain('attachment;');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(csv).toContain('Registered accounts,4');
  expect(csv).toContain('2026-10-11,1,2');
  expect(csv).not.toContain('synthetic@example.test');
  mocks.getPlatformOverview.mockRejectedValue(new Error('Database unavailable'));
  const unavailable = await GET();
  expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).not.toContain('Registered accounts,0');
});
