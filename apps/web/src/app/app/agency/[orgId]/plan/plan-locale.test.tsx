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
 * Plan, Usage and Invoices under Bengali: the owner signed off the payment and AI wording
 * (2026-11-12), so every message with a register draft shows in Bengali, in every state, with no
 * raw keys. Amounts and billing dates keep the English form their helpers write.
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

const { appAgencyCatalog } = await import('../../../../../i18n/app-agency');
const { default: PlanPage } = await import('./page');
const { default: InvoicesPage } = await import('./invoices/page');
const { InvoiceCard } = await import('./invoices/invoice-card');
const { primeLocale } = await import('../../../../../lib/i18n-server');
const bnCat = appAgencyCatalog.bn as Record<string, string>;

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
  it('shows the plan wording in Bengali (signed off 2026-11-12) and keeps the price line English (plan shown)', async () => {
    const { en, bn } = await both(() =>
      renderServer(PlanPage({ params: Promise.resolve({ orgId: ORG }) })),
    );
    expect(en).toContain('the price is BDT 3,000.00');
    // The price line holds an English date and amount from helpers that do not follow the reader language.
    expect(bn).toContain('the price is BDT 3,000.00');
    expect(bn).toMatch(BENGALI);
    // Every Bengali message whose English shows on the English page shows in Bengali on this page.
    const enCat = appAgencyCatalog.en as Record<string, string>;
    const shownInEnglish = Object.keys(bnCat).filter(
      (key) =>
        (enCat[key]?.length ?? 0) > 20 &&
        !/\{/.test(enCat[key] ?? '') &&
        en.includes(enCat[key] ?? '\u0000'),
    );
    expect(shownInEnglish.length).toBeGreaterThan(0);
    for (const key of shownInEnglish) expect(bn, key).toContain(bnCat[key]);
    expect(bn).not.toMatch(/appAgency\./);
  });

  it('says the plan is complimentary during the public beta, in Bengali (signed off 2026-11-12)', async () => {
    const base = usage();
    mocks.usage.mockResolvedValue({
      ...base,
      value: { ...base.value, entitlements: { ...base.value.entitlements, bypassLimits: true } },
    });
    const { bn } = await both(() =>
      renderServer(PlanPage({ params: Promise.resolve({ orgId: ORG }) })),
    );
    const key = 'appAgency.appAgencyOrgidPlanPage.complimentaryDuringPublicBetaNoPayment';
    expect(bn).toContain((appAgencyCatalog.bn as Record<string, string>)[key]);
    expect(bn).not.toContain((appAgencyCatalog.en as Record<string, string>)[key]);
  });

  it('says in Bengali that the plan cannot be read for this person', async () => {
    mocks.usage.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const { en, bn } = await both(() =>
      renderServer(PlanPage({ params: Promise.resolve({ orgId: ORG }) })),
    );
    expect(en).toContain("You don't have access to this organization's plan.");
    expect(en).not.toContain('Current Plan');
    expect(bn).toContain(bnCat['appAgency.appAgencyOrgidPlanInvoicesPage.usageBilling']);
    for (const key of ['yourAgencySPlanAndHow', 'youDonTHaveAccessTo'])
      expect(bn, key).toContain(bnCat[`appAgency.appAgencyOrgidPlanPage.${key}`]);
    expect(bn).not.toContain("You don't have access to this organization's plan.");
    expect(bn).not.toMatch(/appAgency\./);
  });

  it('says in Bengali that no access offer is recorded, and that the usage is for information', async () => {
    const base = usage();
    mocks.usage.mockResolvedValue({
      ...base,
      value: {
        ...base.value,
        planAssigned: false,
        plan: null,
        meters: base.value.meters.map((meter) => ({ ...meter, shownOnly: true })),
      },
    });
    const { en, bn } = await both(() =>
      renderServer(PlanPage({ params: Promise.resolve({ orgId: ORG }) })),
    );
    expect(en).toContain('Access Offer Not Recorded');
    for (const key of ['accessOfferNotRecorded', 'anAccessOfferHasNotBeen'])
      expect(bn, key).toContain(bnCat[`appAgency.appAgencyOrgidPlanPage.${key}`]);
    expect(bn).toContain(
      (bnCat['appAgency.appAgencyOrgidPlanPage.shownForYourInformationItDoes'] ?? '?').trim(),
    );
    expect(bn).not.toContain('Access Offer Not Recorded');
    expect(bn).not.toMatch(/appAgency\./);
  });
});

describe('Invoices under Bengali', () => {
  const page = () => renderServer(InvoicesPage({ params: Promise.resolve({ orgId: ORG }) }));

  const inv = (key: string) => bnCat[`appAgency.appAgencyOrgidPlanInvoicesPage.${key}`] ?? key;

  it('shows the invoices page in Bengali with invoices listed (rows state)', async () => {
    const { en, bn } = await both(page);
    expect(en).toContain('INV-2026-001');
    expect(bn).toContain('INV-2026-001');
    expect(bn).toContain(inv('invoices'));
    expect(bn).toContain(inv('payAnInvoiceOnlineOrTell'));
    expect(bn).not.toContain('Pay an invoice online or tell us');
    expect(bn).not.toMatch(/appAgency\./);
  });

  it('shows the invoices page in Bengali with no invoices (empty state)', async () => {
    mocks.list.mockResolvedValue({ ok: true, value: [] });
    const { en, bn } = await both(page);
    expect(en).toContain('No invoices yet.');
    expect(bn).toContain(inv('noInvoicesYetWhenVisastackIssues'));
    expect(bn).not.toContain('No invoices yet.');
  });

  it('says in Bengali that a member may not see invoices', async () => {
    mocks.list.mockResolvedValue({ ok: false, error: { code: 'forbidden', message: 'no' } });
    const { en, bn } = await both(page);
    expect(en).toContain('Only owners and admins can see and pay invoices.');
    expect(bn).toContain(inv('onlyOwnersAndAdminsCanSee'));
    expect(bn).not.toContain('Only owners and admins can see and pay invoices.');
  });

  const card = (key: string) =>
    bnCat[`appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.${key}`] ?? key;
  const claim = {
    id: 'cl1',
    method: 'BANK_TRANSFER',
    amountMinorUnits: 125050,
    currency: 'BDT',
    paidOn: new Date('2026-10-20T00:00:00Z'),
    status: 'SUBMITTED',
    decisionReason: null,
    hasProofFile: true,
    createdAt: new Date('2026-10-20T00:00:00Z'),
  } as never;
  const attempt = {
    id: 'at1',
    amountMinorUnits: 125050,
    currency: 'BDT',
    status: 'RECORDED',
    mode: 'LIVE',
    createdAt: new Date('2026-10-21T00:00:00Z'),
    redirectedAt: null,
  } as never;
  const receipt = {
    id: 'rc1',
    number: 'RCP-1',
    amountMinorUnits: 125050,
    currency: 'BDT',
    issuedAt: new Date('2026-10-28T00:00:00Z'),
  } as never;

  /** The card as a page renders it: the page primes the reader language first. */
  const drawCard = (view: AgencyInvoiceView, online: 'pay' | null = 'pay') =>
    both(async () => {
      await primeLocale();
      return renderServer(
        InvoiceCard({
          invoice: view,
          organizationId: ORG,
          online: online ? { BDT: online } : {},
          latestDate: '2026-10-28',
        }),
      );
    });

  it.each([
    ['reported, online payment offered', 'pay' as const, 'paymentReportedWeAreCheckingIt'],
    ['reported, no online payment', null, 'paymentReportedWeAreCheckingIt7bdaca'],
  ])('shows a reported payment in Bengali on the invoice card: %s', async (_name, online, key) => {
    const { en, bn } = await drawCard(
      invoice({ state: 'PAYMENT_REPORTED', claims: [claim] }),
      online,
    );
    expect(en).toContain('Payment Reported: we are checking it.');
    expect(bn).toContain(card(key));
    for (const k of ['paymentReports', 'downloadProof']) expect(bn, k).toContain(card(k));
    expect(bn).not.toContain('Payment Reported: we are checking it.');
    expect(bn).not.toMatch(/appAgency\./);
  });

  it('shows the paid card with its online payment and receipt in Bengali', async () => {
    const { en, bn } = await drawCard(
      invoice({
        status: 'PAID',
        state: 'PAID',
        collectedAmountMinorUnits: 125050,
        outstandingMinorUnits: 0,
        attempts: [attempt],
        receipts: [receipt],
      }),
    );
    expect(en).toContain('Online Payments');
    for (const k of ['onlinePayments', 'receipts', 'downloadReceiptPdf'])
      expect(bn, k).toContain(card(k));
    expect(bn).toContain('RCP-1');
    expect(bn).not.toContain('Online Payments');
    expect(bn).not.toMatch(/appAgency\./);
  });

  it('shows the refunded amounts in Bengali on the invoice card', async () => {
    const { en, bn } = await drawCard(
      invoice({
        status: 'PAID',
        state: 'PARTLY_REFUNDED',
        collectedAmountMinorUnits: 25050,
        refundedMinorUnits: 100000,
        outstandingMinorUnits: 0,
      }),
    );
    expect(en).toContain('Kept After Refunds');
    for (const k of ['keptAfterRefunds', 'refunded']) expect(bn, k).toContain(card(k));
    expect(bn).not.toContain('Kept After Refunds');
  });

  it.each([
    ['open and owed', invoice()],
    ['overdue', invoice({ dueDate: new Date(Date.now() - 2 * DAY) })],
  ])('shows the invoice card in Bengali when it is %s', async (_name, view) => {
    const { en, bn } = await drawCard(view);
    expect(en).toContain('Invoiced');
    expect(bn).toContain(card('invoiced'));
    expect(bn).toContain('INV-2026-001');
    expect(bn).not.toContain('Invoiced');
    expect(bn).not.toMatch(/appAgency\./);
  });

  it('names the payment sections in Bengali for screen readers', async () => {
    current.holder = null;
    current.locale = 'bn';
    await primeLocale();
    const html = await renderServer(
      InvoiceCard({
        invoice: invoice({ claims: [claim], attempts: [attempt], receipts: [receipt] }),
        organizationId: ORG,
        online: { BDT: 'pay' },
        latestDate: '2026-10-28',
      }),
    );
    const named = (key: string) => card(key).replace('{invoiceRef}', 'INV-2026-001');
    for (const key of [
      'payInvoiceref',
      'paymentReportsForInvoiceref',
      'onlinePaymentsForInvoiceref',
      'receiptsForInvoiceref',
    ])
      expect(html, key).toContain(`aria-label="${named(key)}"`);
  });
});
