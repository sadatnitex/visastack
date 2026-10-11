import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  searchWorkspaceRecords: vi.fn(),
  session: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  checkRateLimit: mocks.checkRateLimit,
  searchWorkspaceRecords: mocks.searchWorkspaceRecords,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => {
    mocks.session();
    return fn({ db: {}, accountId: 'trusted-session-account' });
  },
}));
const { POST } = await import('./route');
const url = 'https://synthetic-preview.example.test/api/workspace/search';
const request = (body: unknown, origin = 'https://synthetic-preview.example.test') =>
  new Request(url, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.searchWorkspaceRecords.mockResolvedValue({ ok: true, value: [] });
});
describe('bounded authenticated record-search endpoint', () => {
  it('rejects another origin before touching the session or database', async () => {
    expect(
      (
        await POST(
          request(
            { query: 'Synthetic', scope: { kind: 'personal' } },
            'https://foreign.example.test',
          ),
        )
      ).status,
    ).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.searchWorkspaceRecords).not.toHaveBeenCalled();
  });
  it('bounds a streamed body even without Content-Length', async () => {
    expect((await POST(request({ query: 'x'.repeat(5000) }))).status).toBe(413);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('rejects unknown scope and malformed queries before rate-limited database work', async () => {
    expect(
      (await POST(request({ query: 'Synthetic', scope: { kind: 'platform_all' } }))).status,
    ).toBe(400);
    expect((await POST(request({ query: 'x', scope: { kind: 'personal' } }))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('uses the session account rather than a client-supplied account and prevents caching', async () => {
    const response = await POST(
      request({ query: 'Synthetic', accountId: 'foreign-account', scope: { kind: 'personal' } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.searchWorkspaceRecords).toHaveBeenCalledWith(
      {},
      'trusted-session-account',
      { kind: 'personal' },
      'Synthetic',
    );
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      {},
      { subjectId: 'trusted-session-account', action: 'workspace.search', label: 'search' },
      { limit: 60, windowMs: 60_000 },
    );
  });
  it('does not query records when the account search budget is exhausted', async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false });
    expect((await POST(request({ query: 'Synthetic', scope: { kind: 'personal' } }))).status).toBe(
      429,
    );
    expect(mocks.searchWorkspaceRecords).not.toHaveBeenCalled();
  });
  it('preserves service refusal rather than returning a successful empty result', async () => {
    mocks.searchWorkspaceRecords.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'Workspace unavailable.' },
    });
    expect(
      (
        await POST(
          request({
            query: 'Synthetic',
            scope: { kind: 'agency', organizationId: 'synthetic-org' },
          }),
        )
      ).status,
    ).toBe(403);
  });
});
