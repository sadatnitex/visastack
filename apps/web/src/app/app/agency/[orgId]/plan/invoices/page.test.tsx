import type { AgencyInvoiceView } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../../lib/axe.test-support';
import {
  navigationState,
  renderServer,
  textOf,
} from '../../../../../../lib/next-mocks.test-support';

/**
 * The agency Invoices page within the scroll budget (WP-SB9): compact rows, one open (the newest
 * that still asks for money), 10 then Show More, and the read asks for one row more than it shows.
 * What each invoice offers (pay, report, receipts) is pinned in invoice-card.test.tsx; who may read
 * is the service's job (agency-invoices.test.ts).
 */

const ORG = '11111111-2222-4333-8444-555555555555';
const DAY = 24 * 60 * 60 * 1000;
const mocks = vi.hoisted(() => ({ list: vi.fn(), refresh: vi.fn() }));

vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'owner@acme.example.com' }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listAgencyInvoices: (...args: unknown[]) => mocks.list(...args),
  refreshInvoicePaymentAttempts: (...args: unknown[]) => mocks.refresh(...args),
}));
vi.mock('../../../../../../lib/providers', () => ({
  paymentPorts: () => ({ configured: () => [] }),
}));
vi.mock('../../../../../../lib/payment-providers', () => ({ onlineOffers: () => ({}) }));
vi.mock('../../../../../../lib/admin', () => ({ isPlatformOwnerAccount: async () => false }));
vi.mock('../../billing-status-notice', () => ({
  loadBillingNotice: async () => null,
  BillingStatusNotice: () => null,
}));
vi.mock('./actions', () => ({
  startPaymentAction: async () => ({ ok: true, message: '' }),
  checkPaymentAction: async () => ({ ok: true, message: '' }),
  submitClaimAction: async () => ({ ok: true, message: '' }),
}));

const { default: Page } = await import('./page');

function invoice(index: number, overrides: Partial<AgencyInvoiceView> = {}): AgencyInvoiceView {
  return {
    id: `inv-${index}`,
    invoiceRef: `INV-2026-${String(100 - index).padStart(3, '0')}`,
    currency: 'BDT',
    status: 'PAID',
    state: 'PAID',
    partlyPaid: false,
    invoicedAmountMinorUnits: 125050,
    collectedAmountMinorUnits: 125050,
    outstandingMinorUnits: 0,
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
const many = (count: number) => Array.from({ length: count }, (_, index) => invoice(index));
const render = (show?: string) =>
  renderServer(
    Page({
      params: Promise.resolve({ orgId: ORG }),
      ...(show === undefined ? {} : { searchParams: Promise.resolve({ show }) }),
    }),
  );
const rows = (html: string) => html.match(/<details class="billing-row"/g) ?? [];

beforeEach(() => {
  navigationState.pathname = `/app/agency/${ORG}/plan/invoices`;
  mocks.list.mockReset().mockResolvedValue({ ok: true, value: many(11) });
  mocks.refresh.mockReset();
});

describe('the agency Invoices page within the scroll budget (WP-SB9)', () => {
  it('shows the newest 10 invoices as compact rows, then Show More', async () => {
    const html = await render();
    expect(mocks.list).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ actorAccountId: 'acct-1', organizationId: ORG, limit: 11 }),
    );
    expect(rows(html)).toHaveLength(10);
    expect(html).toContain(`href="/app/agency/${ORG}/plan/invoices?show=20#invoice-row-10"`);
    expect(textOf(html)).toContain('Showing the first 10 invoices.');
    // The closed row still says the reference, the state and the amount.
    expect(textOf(html)).toMatch(/INV-2026-100\s*BDT\s1,250\.50, due .*Paid/);
  });

  it('opens the newest invoice that still asks for money, and only that one', async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      value: [
        invoice(0),
        invoice(1, {
          status: 'OPEN',
          state: 'OPEN',
          collectedAmountMinorUnits: 0,
          outstandingMinorUnits: 125050,
          dueDate: new Date(Date.now() - 2 * DAY),
        }),
        invoice(2, { status: 'OPEN', state: 'OPEN', outstandingMinorUnits: 125050 }),
      ],
    });
    const html = await render();
    expect(html.match(/<details class="billing-row"[^>]*\sopen/g)).toHaveLength(1);
    expect(html).toContain('id="invoice-row-1" open');
    // Overdue shows on the closed row too, as a word.
    expect(textOf(html)).toMatch(/INV-2026-099.*Overdue/);
    expect(textOf(html)).toContain('Showing all 3 invoices.');
  });

  it('opens the newest when nothing is owed, and grows by the address step', async () => {
    mocks.list.mockResolvedValue({ ok: true, value: many(13) });
    const html = await render('20');
    expect(mocks.list).toHaveBeenLastCalledWith({}, expect.objectContaining({ limit: 21 }));
    expect(rows(html)).toHaveLength(13);
    expect(html).toContain('id="invoice-row-0" open');
    expect(html).not.toContain('?show=');
    await render('junk');
    expect(mocks.list).toHaveBeenLastCalledWith({}, expect.objectContaining({ limit: 11 }));
  });

  it('still tells members who are not owners or admins that invoices are not for them', async () => {
    mocks.list.mockResolvedValue({ ok: false, error: { code: 'forbidden', message: 'no' } });
    const html = await render();
    expect(textOf(html)).toContain('Only owners and admins can see and pay invoices.');
    expect(rows(html)).toHaveLength(0);
  });

  it('passes the automated accessibility rules with a full page of rows', async () => {
    expect(await axeViolations(await render())).toEqual([]);
  });
});
