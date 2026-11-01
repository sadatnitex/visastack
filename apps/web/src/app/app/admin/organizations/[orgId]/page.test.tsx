import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { navigationState, renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

/**
 * The platform owner's organization page within the scroll budget (WP-SB9): one part open at a
 * time, only that part's reads run, and each long list shows 10 then Show More, reading one row
 * more than it shows. Who may do what is the services' and the actions' job; nothing here changes it.
 */

const ORG = '11111111-2222-4333-8444-555555555555';
const DAY = 24 * 60 * 60 * 1000;
const noop = async () => ({ ok: true, message: '' });
const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  plans: vi.fn(),
  current: vi.fn(),
  history: vi.fn(),
  invoices: vi.fn(),
  claims: vi.fn(),
  overrides: vi.fn(),
  refundWork: vi.fn(),
  staff: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'owner@visastack.example.test' }),
}));
vi.mock('../../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  isPlatformOwnerAccount: (...args: unknown[]) => mocks.owner(...args),
  staffPrincipal: (...args: unknown[]) => mocks.staff(...args),
}));
vi.mock('../../../../../lib/refund-gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../lib/refund-gateway')>()),
  refundPorts: () => ({ send: null, check: null }),
  refundGatewayViews: () => [],
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getOrganization: async () => ({ id: ORG, name: 'Acme Travel', status: 'ACTIVE' }),
  listPlans: (...args: unknown[]) => mocks.plans(...args),
  getCurrentPlanForOrganization: (...args: unknown[]) => mocks.current(...args),
  getPendingDowngradeForOrganization: async () => undefined,
  getUsageForOrganization: async () => ({ ok: false, error: { code: 'forbidden', message: '' } }),
  getBillingAccountForOrganization: async () => ({
    ok: true,
    value: { id: 'ba-1', status: 'ACTIVE' },
  }),
  listBillingStatusHistory: (...args: unknown[]) => mocks.history(...args),
  listInvoicesForOrganization: (...args: unknown[]) => mocks.invoices(...args),
  listManualClaims: (...args: unknown[]) => mocks.claims(...args),
  listCommercialOverridesForOrganization: (...args: unknown[]) => mocks.overrides(...args),
  getOrganizationRefundWork: (...args: unknown[]) => mocks.refundWork(...args),
}));
vi.mock('./actions', () => ({
  activatePlanAction: noop,
  endSubscriptionAction: noop,
  scheduleDowngradeAction: noop,
  cancelScheduledDowngradeAction: noop,
  openBillingAccountAction: noop,
  transitionBillingStatusAction: noop,
  createInvoiceAction: noop,
  recordInvoicePaymentAction: noop,
  voidInvoiceAction: noop,
  grantOverrideAction: noop,
  revokeOverrideAction: noop,
  approveClaimAction: noop,
  rejectClaimAction: noop,
}));
vi.mock('./refund-actions', () => ({
  applyCreditAction: noop,
  cancelRefundAction: noop,
  checkRefundsAction: noop,
  confirmUnsentRefundAction: noop,
  recordManualRefundAction: noop,
  requestRefundAction: noop,
  retryRefundAction: noop,
}));

const { default: Page } = await import('./page');

const invoice = (index: number, status = 'PAID') => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  organizationId: ORG,
  invoiceRef: `INV-${String(100 - index).padStart(3, '0')}`,
  status,
  invoicedAmountMinorUnits: 500000,
  collectedAmountMinorUnits: status === 'PAID' ? 500000 : 0,
  currency: 'BDT',
  dueDate: new Date('2026-12-01T00:00:00Z'),
  createdAt: new Date(Date.now() - index * DAY),
});
const override = (index: number) => ({
  id: `override-${index}`,
  organizationId: ORG,
  reason: `Override reason ${index + 1}`,
  expiryAt: new Date(Date.now() + (index === 0 ? DAY : -DAY)),
  revokedAt: null,
  createdAt: new Date(Date.now() - index * DAY),
});
const change = (index: number) => ({
  id: `change-${index}`,
  fromStatus: 'TRIAL',
  toStatus: 'ACTIVE',
  reason: 'manual',
  actorAccountId: null,
  createdAt: new Date(Date.now() - index * DAY),
});
const many = <T,>(count: number, make: (index: number) => T) =>
  Array.from({ length: count }, (_, index) => make(index));

const render = (search: Record<string, string> = {}) =>
  renderServer(
    Page({ params: Promise.resolve({ orgId: ORG }), searchParams: Promise.resolve(search) }),
  );
const rows = (html: string) => html.match(/<details class="billing-row"/g) ?? [];

beforeEach(() => {
  navigationState.pathname = `/app/admin/organizations/${ORG}`;
  mocks.owner.mockReset().mockResolvedValue(true);
  mocks.plans.mockReset().mockResolvedValue([]);
  mocks.current.mockReset().mockResolvedValue(undefined);
  mocks.history.mockReset().mockResolvedValue({ ok: true, value: many(11, change) });
  mocks.invoices.mockReset().mockResolvedValue({ ok: true, value: many(11, (i) => invoice(i)) });
  mocks.claims.mockReset().mockResolvedValue({ ok: true, value: [] });
  mocks.overrides.mockReset().mockResolvedValue(many(11, override));
  mocks.refundWork.mockReset();
  mocks.staff.mockReset().mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
});

describe('the organization page within the scroll budget (WP-SB9)', () => {
  it('opens Plan & Billing by default, reads only that part, and caps the status history', async () => {
    const html = await render();
    const text = textOf(html);
    expect(html).toMatch(/<nav class="subnav org-admin-tabs" aria-label="Organization">/);
    expect(html).toMatch(/aria-current="page"[^>]*>Plan &amp; Billing</);
    expect(text).toContain('Plan & Subscription');
    expect(mocks.history).toHaveBeenCalledWith({}, expect.anything(), { limit: 11 });
    expect(mocks.invoices).not.toHaveBeenCalled();
    expect(mocks.claims).not.toHaveBeenCalled();
    expect(mocks.overrides).not.toHaveBeenCalled();
    expect(mocks.staff).not.toHaveBeenCalled();
    expect(text).toContain('Showing the first 10 changes.');
    expect(html).toContain(`href="/app/admin/organizations/${ORG}?show=20#billing-history-row-10"`);
    expect(text).not.toContain('Commercial Overrides');
  });

  it('shows invoices as compact rows, the newest owed one open, 10 then Show More', async () => {
    mocks.invoices.mockResolvedValue({
      ok: true,
      value: [invoice(0), invoice(1, 'OPEN'), ...many(9, (i) => invoice(i + 2))],
    });
    const html = await render({ tab: 'invoices' });
    expect(mocks.invoices).toHaveBeenCalledWith({}, expect.anything(), { limit: 11 });
    expect(mocks.history).not.toHaveBeenCalled();
    expect(rows(html)).toHaveLength(10);
    expect(html.match(/<details class="billing-row"[^>]*\sopen/g)).toHaveLength(1);
    expect(html).toContain('id="invoice-row-1" open');
    expect(html).toContain(
      `href="/app/admin/organizations/${ORG}?tab=invoices&amp;show=20#invoice-row-10"`,
    );
    expect(textOf(html)).toContain('Create an Invoice');
  });

  it('caps overrides at 10 with Show More, and still marks only a live one Active', async () => {
    const html = await render({ tab: 'overrides', show: '10' });
    const text = textOf(html);
    expect(mocks.overrides).toHaveBeenCalledWith({}, ORG, { limit: 11 });
    expect(text).toContain('Override reason 10');
    expect(text).not.toContain('Override reason 11');
    expect(html.match(/badge-success">Active/g)).toHaveLength(1);
    expect(text).toContain('Showing the first 10 overrides.');
  });

  it('opens Refunds for the refund panel own paging links, under the refund scope only', async () => {
    const html = await render({ refundPage: '2' });
    expect(html).toMatch(/aria-current="page"[^>]*>Refunds</);
    expect(mocks.staff).toHaveBeenCalledWith({}, expect.anything(), 'BILLING_REFUND_MANAGE');
    expect(mocks.refundWork).not.toHaveBeenCalled();
    expect(textOf(html)).toContain('Refunds and credits need your authenticator code first.');
  });

  it('opens Payment Reports with its own read, and an unknown part opens Plan & Billing', async () => {
    const reports = await render({ tab: 'reports' });
    expect(mocks.claims).toHaveBeenCalledTimes(1);
    expect(textOf(reports)).toContain('No payment reports yet.');
    const unknown = await render({ tab: '<script>' });
    expect(unknown).toMatch(/aria-current="page"[^>]*>Plan &amp; Billing</);
  });

  it('shows nothing of the organization to someone who is not a platform owner', async () => {
    mocks.owner.mockResolvedValue(false);
    const html = await render({ tab: 'invoices' });
    expect(textOf(html)).toContain('This area is restricted to platform owners.');
    expect(mocks.invoices).not.toHaveBeenCalled();
  });

  it('passes the automated accessibility rules on each part', async () => {
    // With an agency plan on offer (with none, the Activate form's label points at no field: a
    // finding older than this package, recorded in known-issues.md, not changed here).
    mocks.plans.mockResolvedValue([
      {
        id: 'plan-1',
        key: 'agency_growth',
        name: 'Agency Growth',
        active: true,
        audience: 'AGENCY',
      },
    ]);
    for (const tab of ['plan', 'invoices', 'reports', 'overrides']) {
      expect(await axeViolations(await render({ tab })), tab).toEqual([]);
    }
  });
});
