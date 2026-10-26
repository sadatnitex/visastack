import { formatReferenceCode, referenceCheckCharacter } from '@visastack/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  searchWorkspaceRecords: vi.fn(),
  session: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  RATE_LIMITS: { REFERENCE_LOOKUP: { limit: 60, windowMs: 3_600_000 } },
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

describe('looking a record up by its visible reference code (ADR 0018)', () => {
  // 00 is never issued, so this example can never name a real record.
  const code = formatReferenceCode('C', `00K2Q${referenceCheckCharacter('C', '00K2Q')}`);
  const search = (query: string) => POST(request({ query, scope: { kind: 'personal' } }));

  it('spends one hourly lookup per account on a code, and none on an ordinary search', async () => {
    expect((await search(code)).status).toBe(200);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      {},
      {
        subjectId: 'trusted-session-account',
        action: 'reference.lookup',
        label: 'reference lookup',
      },
      { limit: 60, windowMs: 3_600_000 },
    );
    mocks.checkRateLimit.mockClear();
    // "Germany" reads as a valid code by chance; it is a word, so it costs no lookup.
    for (const text of ['Japan trip', 'Germany']) {
      mocks.checkRateLimit.mockClear();
      await search(text);
      expect(mocks.checkRateLimit).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses once the lookup budget is spent, before searching', async () => {
    mocks.checkRateLimit
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });
    const response = await search(code);
    expect(response.status).toBe(429);
    expect(mocks.searchWorkspaceRecords).not.toHaveBeenCalled();
  });

  it('says one character looks wrong for a typed code that fails its check, without searching', async () => {
    const typo = `${code.slice(0, 7)}${code.endsWith('0') ? '1' : '0'}`;
    const response = await search(typo);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [],
      notice: 'One character in that reference looks wrong. Check it and try again.',
    });
    expect(mocks.searchWorkspaceRecords).not.toHaveBeenCalled();
    // Words, names and a code still being typed are searched normally.
    for (const text of ['passport', 'D Rahman', 'C-00K2Q']) await search(text);
    expect(mocks.searchWorkspaceRecords).toHaveBeenCalledTimes(3);
  });
});
