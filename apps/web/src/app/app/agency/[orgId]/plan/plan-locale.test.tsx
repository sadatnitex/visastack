import type { AgencyInvoiceView } from '@visastack/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationState, renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

/**
 * Plan, Usage and Invoices are payment and AI wording, which waits for the owner sign-off. Under
 * Bengali these screens must read exactly as they do in English, in every state, with no raw keys.
 */

const ORG = '11111111-2222-4333-8444-555555555555';
const DAY = 24 * 60 * 60 * 1000;
const mocks = vi.hoisted(() => ({ usage: vi.fn(), list: vi.fn(), access: vi.fn() }));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'owner@acme.example.com' }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getUsageForOrganization: (...args: unknown[]) => mocks.usage(...args),
  getPendingDowngradeForOrganization: async () => undefined,
  listPlans: async () => [],
  listAgencyInvoices: (...args: unknown[]) => mocks.list(...args),
  refreshInvoicePaymentAttempts: async () => undefined,
}));
vi.mock('../console-data', () => ({
  loadOrgAccess: (...args: unknown[]) => mocks.access(...args),
}));
vi.mock('../billing-status-notice', () => ({
  loadBillingNotice: async () => null,
  BillingStatusNotice: () => null,
}));
vi.mock('../../../../../lib/providers', () => ({
  paymentPorts: () => ({ configured: () => [] }),
}));
vi.mock('../../../../../lib/payment-providers', () => ({ onlineOffers: () => ({}) }));
vi.mock('../../../../../lib/admin', () => ({ isPlatformOwnerAccount: async () => false }));
vi.mock('./invoices/actions', () => ({
  startPaymentAction: async () => ({ ok: true, message: '' }),
  checkPaymentAction: async () => ({ ok: true, message: '' }),
  submitClaimAction: async () => ({ ok: true, message: '' }),
}));

const { default: PlanPage } = await import('./page');
const { default: InvoicesPage } = await import('./invoices/page');
const { InvoiceCard } = await import('./invoices/invoice-card');

const BENGALI = /[ঀ-৿]/;

function usage() {
  return {
    ok: true,
    value: {
      planAssigned: true,
      plan: { name: 'Agency Growth', key: 'agency_growth', periodDays: 30 },
      meters: [
        {
          key: 'seats',
          entitlement: 'seats',
          label: 'Team Members',
          definition: 'Team Members definition.',
          used: 1,
          allowed: 5,
          shownOnly: false,
        },
      ],
      entitlements: {
        bypassLimits: false,
        plan: {
          price: { priceMinorUnits: 250000, currency: 'BDT' },
          nextPrice: {
            priceMinorUnits: 300000,
            currency: 'BDT',
            from: new Date('2026-12-01T00:00:00Z'),
          },
        },
        features: null,
        agencyFeatures: { ai_agency_tools: { included: true, dailyLimit: 500 } },
      },
    },
  };
}

function invoice(overrides: Partial<AgencyInvoiceView> = {}): AgencyInvoiceView {
  return {
    id: 'inv-1',
    invoiceRef: 'INV-2026-001',
    currency: 'BDT',
    status: 'OPEN',
    state: 'OPEN',
    partlyPaid: false,
    invoicedAmountMinorUnits: 125050,
    collectedAmountMinorUnits: 0,
    outstandingMinorUnits: 125050,
    refundedMinorUnits: 0,
    creditMinorUnits: 0,
    periodStart: new Date('2026-10-01T00:00:00Z'),
    periodEnd: new Date('2026-10-31T00:00:00Z'),
    dueDate: new Date(Date.now() + 14 * DAY),
    recentAttemptStartedAt: null,
    strandedPayment: false,
    attempts: [],
    claims: [],
    receipts: [],
    ...overrides,
  };
}

/** The page as a reader of this language hears it. */
async function both(node: () => Promise<string> | string) {
  const read = async (locale: 'en' | 'bn') => {
    current.holder = null;
    current.locale = locale;
    return textOf(await node());
  };
  return { en: await read('en'), bn: await read('bn') };
}

beforeEach(() => {
  navigationState.pathname = `/app/agency/${ORG}/plan`;
  mocks.access.mockResolvedValue({ admin: true });
  mocks.usage.mockResolvedValue(usage());
  mocks.list.mockResolvedValue({ ok: true, value: [invoice()] });
});
afterEach(() => {
  current.locale = 'en';
});

describe('Plan and Usage under Bengali', () => {
  it('reads exactly as English with the plan, price and AI wording held (plan shown)', async () => {
    const { en, bn } = await both(() =>
      renderServer(PlanPage({ params: Promise.resolve({ orgId: ORG }) })),
    );
    expect(en).toContain('the price is BDT 3,000.00');
    expect(bn).toBe(en);
    expect(bn).not.toMatch(BENGALI);
    expect(bn).not.toMatch(/appAgency\./);
  });

  it('reads exactly as English when the plan cannot be read for this person', async () => {
    mocks.usage.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const { en, bn } = await both(() =>
      renderServer(PlanPage({ params: Promise.resolve({ orgId: ORG }) })),
    );
    expect(en).toContain("You don't have access to this organization's plan.");
    expect(en).not.toContain('Current Plan');
    expect(bn).toBe(en);
  });
});

describe('Invoices under Bengali', () => {
  const page = () => renderServer(InvoicesPage({ params: Promise.resolve({ orgId: ORG }) }));

  it('reads exactly as English with invoices listed (rows state)', async () => {
    const { en, bn } = await both(page);
    expect(en).toContain('INV-2026-001');
    expect(bn).toBe(en);
    expect(bn).not.toMatch(BENGALI);
  });

  it('reads exactly as English with no invoices (empty state)', async () => {
    mocks.list.mockResolvedValue({ ok: true, value: [] });
    const { en, bn } = await both(page);
    expect(en).toContain('No invoices yet.');
    expect(bn).toBe(en);
  });

  it('reads exactly as English for a member who may not see invoices', async () => {
    mocks.list.mockResolvedValue({ ok: false, error: { code: 'forbidden', message: 'no' } });
    const { en, bn } = await both(page);
    expect(en).toContain('Only owners and admins can see and pay invoices.');
    expect(bn).toBe(en);
  });

  it.each([
    ['open and owed', invoice()],
    [
      'paid with a receipt',
      invoice({
        status: 'PAID',
        state: 'PAID',
        collectedAmountMinorUnits: 125050,
        outstandingMinorUnits: 0,
        receipts: [
          {
            id: 'rc1',
            receiptNumber: 'RCP-1',
            amountMinorUnits: 125050,
            currency: 'BDT',
            issuedAt: new Date('2026-10-28T00:00:00Z'),
          } as never,
        ],
      }),
    ],
    ['overdue', invoice({ dueDate: new Date(Date.now() - 2 * DAY) })],
  ])('reads exactly as English on the invoice card: %s', async (_name, view) => {
    const { en, bn } = await both(() =>
      renderServer(
        InvoiceCard({
          invoice: view,
          organizationId: ORG,
          online: { BDT: 'pay' },
          latestDate: '2026-10-28',
        }),
      ),
    );
    expect(en).toContain('INV-2026-001');
    expect(bn).toBe(en);
  });
});
