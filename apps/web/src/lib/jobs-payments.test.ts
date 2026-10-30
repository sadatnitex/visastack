import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

/**
 * S19 step 0 round 2: a payment provider the owner chose but left with incomplete settings is off,
 * and the daily payment check says so (a reported error naming the provider and the settings it
 * lacks, never a value), while the other providers are still asked.
 */

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  pooled: vi.fn(),
  reconcile: vi.fn(),
  refunds: vi.fn(),
  report: vi.fn(),
  incomplete: vi.fn(),
  ports: vi.fn(),
}));
vi.mock('@visastack/db', async (load) => ({
  ...(await load<typeof import('@visastack/db')>()),
  resolveDatabaseUrl: mocks.resolve,
  createPooledDb: mocks.pooled,
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  reconcilePaymentAttempts: mocks.reconcile,
  reconcileRefunds: mocks.refunds,
}));
vi.mock('./providers', () => ({
  incompletePaymentSettings: mocks.incomplete,
  paymentPorts: mocks.ports,
}));
vi.mock('./server-error', () => ({ reportServerError: mocks.report }));

const SUMMARY = {
  available: true,
  configured: false,
  checked: 0,
  recorded: 0,
  held: 0,
  closed: 0,
  stillPending: 0,
  unavailable: 0,
  awaitingReview: 0,
  leftForLater: 0,
  providerNotConfigured: 2,
};
const end = vi.fn();

beforeEach(() => {
  mocks.resolve.mockReturnValue('synthetic-database');
  mocks.pooled.mockReturnValue({ db: {}, pool: { on: vi.fn(), end } });
  mocks.ports.mockReturnValue({ configured: () => [] });
  mocks.reconcile.mockResolvedValue(SUMMARY);
  mocks.refunds.mockResolvedValue({ checked: 0, leftForLater: 0 });
  mocks.incomplete.mockReturnValue([]);
});
afterEach(() => {
  vi.resetAllMocks();
});

let triggerPaymentReconciliation: typeof import('./jobs').triggerPaymentReconciliation;
beforeAll(async () => {
  ({ triggerPaymentReconciliation } = await import('./jobs'));
}, 60_000);

const scope = { kind: 'system', job: 'process-payment-reconciliation' } as never;

it('reports nothing and names no provider when every chosen provider is complete', async () => {
  const result = await triggerPaymentReconciliation(scope);
  expect(result).toMatchObject({ providerNotConfigured: 2, incompleteProviders: [] });
  expect(mocks.report).not.toHaveBeenCalled();
});

it('reports a chosen provider with incomplete settings and names it, while still checking', async () => {
  mocks.incomplete.mockReturnValue([
    { key: 'sslcommerz', name: 'SSLCOMMERZ', missing: ['SSLCOMMERZ_STORE_ID', 'SSLCOMMERZ_MODE'] },
  ]);
  const result = await triggerPaymentReconciliation(scope);
  expect(result).toMatchObject({ incompleteProviders: ['sslcommerz'], providerNotConfigured: 2 });
  expect(mocks.reconcile).toHaveBeenCalledOnce();
  expect(mocks.report).toHaveBeenCalledOnce();
  const [where, error, extra] = mocks.report.mock.calls[0] ?? [];
  expect(where).toBe('triggerPaymentReconciliation');
  expect((error as Error).message).toBe(
    'payment provider sslcommerz is chosen but its settings are incomplete or not valid: SSLCOMMERZ_STORE_ID, SSLCOMMERZ_MODE',
  );
  expect(extra).toEqual({ step: 'provider settings incomplete', provider: 'sslcommerz' });
  expect(end).toHaveBeenCalledOnce();
});
