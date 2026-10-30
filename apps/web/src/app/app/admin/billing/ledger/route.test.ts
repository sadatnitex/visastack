import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  exportLedgerMonth: vi.fn(),
  tryEstablishStepUp: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  exportLedgerMonth: mocks.exportLedgerMonth,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner', email: 'owner@example.com' }),
}));
vi.mock('../../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: mocks.staffPrincipal,
}));
vi.mock('../../../../../lib/step-up', () => ({ tryEstablishStepUp: mocks.tryEstablishStepUp }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
const { GET } = await import('./route');

const get = (month: string) =>
  GET(new Request(`https://example.test/app/admin/billing/ledger?month=${month}`));

beforeEach(() => {
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: { kind: 'staff' } });
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
  mocks.exportLedgerMonth.mockResolvedValue({
    ok: true,
    value: {
      month: '2026-10',
      filename: 'visastack-ledger-2026-10.csv',
      rowCount: 1,
      csv: '"entry_id"\r\n',
    },
  });
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('the ledger download (S18)', () => {
  it('is for the platform owner only, under the export scope', async () => {
    mocks.staffPrincipal.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'x' },
    });
    await expect(get('2026-10')).rejects.toThrow(
      'NEXT_REDIRECT:/app/admin/billing?ledger=denied#ledger',
    );
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('BILLING_LEDGER_EXPORT');
    expect(mocks.exportLedgerMonth).not.toHaveBeenCalled();
  });

  it('needs a month and a fresh sign-in check before anything is read', async () => {
    await expect(get('2026-13')).rejects.toThrow('ledger=month');
    mocks.tryEstablishStepUp.mockResolvedValue({
      kind: 'reauth_required',
      reauthUrl: '/auth/reauth?returnTo=y',
    });
    await expect(get('2026-10')).rejects.toThrow('NEXT_REDIRECT:/auth/reauth?returnTo=y');
    expect(mocks.exportLedgerMonth).not.toHaveBeenCalled();
  });

  it('sends the file as a private, never cached download', async () => {
    const response = await get('2026-10');
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="visastack-ledger-2026-10.csv"',
    );
    expect(mocks.exportLedgerMonth.mock.calls[0]?.[2]).toEqual({
      month: '2026-10',
      stepUpSatisfied: true,
    });
  });
});
