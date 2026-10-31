import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { navigationState, renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

/**
 * Billing History (ADR 0025 T5): what a traveller sees of their own purchases, the PDF links, the
 * refund request path, and that nothing billing-related is read or shown while paid plans are off
 * for someone who never bought. Who may read which rows is the services' job
 * (person-billing-history.test.ts); this pins how the page asks and what it renders.
 */

const SELF = { kind: 'self-scope-stand-in' };
const mocks = vi.hoisted(() => ({
  hasOwnBilling: vi.fn(),
  listOwnBilling: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com', self: SELF }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  hasOwnBilling: (...args: unknown[]) => mocks.hasOwnBilling(...args),
  listOwnBilling: (...args: unknown[]) => mocks.listOwnBilling(...args),
}));

const { default: Page } = await import('./page');

const PAID_AT = new Date('2026-10-30T06:00:00Z');
const paid = {
  id: '11111111-2222-4333-8444-555555555555',
  invoiceRef: 'TP-A1B2C3D4-2',
  planName: 'Traveller Plus',
  amountMinorUnits: 49_900,
  currency: 'BDT',
  status: 'paid',
  statusLabel: 'Paid',
  periodStart: new Date('2026-10-30T06:00:00Z'),
  periodEnd: new Date('2026-11-29T06:00:00Z'),
  paidAt: PAID_AT,
  testPayment: false,
  refundableUntil: new Date(PAID_AT.getTime() + 7 * 24 * 60 * 60 * 1000),
  receipts: [
    {
      id: '66666666-7777-4888-8999-000000000000',
      receiptNumber: 1,
      number: 'R-000001',
      amountMinorUnits: 49_900,
      currency: 'BDT',
      issuedAt: PAID_AT,
      mode: 'LIVE',
    },
  ],
};
const waiting = {
  ...paid,
  id: '22222222-2222-4333-8444-555555555555',
  invoiceRef: 'TP-A1B2C3D4-1',
  status: 'waiting',
  statusLabel: 'Waiting for Payment',
  paidAt: null,
  refundableUntil: null,
  receipts: [],
};

beforeEach(() => {
  navigationState.pathname = '/app/account/plan/billing';
  mocks.hasOwnBilling.mockReset().mockResolvedValue(false);
  mocks.listOwnBilling.mockReset().mockResolvedValue({ ok: true, value: [paid, waiting] });
  vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'true');
  vi.stubEnv('SUPPORT_EMAIL', 'help@vs.example.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Billing History while paid plans are switched off', () => {
  it('is not found, and lists nothing, for someone who never bought', async () => {
    vi.stubEnv('TRAVELLER_PLANS_ENABLED', '');
    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.hasOwnBilling).toHaveBeenCalledWith({}, SELF);
    expect(mocks.listOwnBilling).not.toHaveBeenCalled();
  });

  it('still shows what someone bought while they were on', async () => {
    vi.stubEnv('TRAVELLER_PLANS_ENABLED', '');
    mocks.hasOwnBilling.mockResolvedValue(true);
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('TP-A1B2C3D4-2');
    expect(mocks.listOwnBilling).toHaveBeenCalledWith({}, SELF);
  });
});

describe('Billing History', () => {
  it("lists the person's own purchases with plan, amount, status, period and receipts", async () => {
    const html = await renderServer(Page());
    const text = textOf(html);
    expect(text).toContain('Billing History');
    // With the switch on the list is read straight away, with the session's own scope only.
    expect(mocks.hasOwnBilling).not.toHaveBeenCalled();
    expect(mocks.listOwnBilling).toHaveBeenCalledWith({}, SELF);
    expect(text).toContain('Traveller Plus');
    expect(text).toMatch(/BDT\s499\.00/);
    expect(text).toContain('Paid On 30 Oct 2026');
    expect(text).toContain('Waiting for Payment');
    expect(text).toContain('You owe nothing');
    expect(text).toContain('Receipt R-000001');
    // Newest first, as the service returns them.
    expect(text.indexOf('TP-A1B2C3D4-2')).toBeLessThan(text.indexOf('TP-A1B2C3D4-1'));
  });

  it('links each invoice and receipt to its own PDF, with no download attribute', async () => {
    const html = await renderServer(Page());
    expect(html).toContain(`href="/app/account/plan/billing/invoices/${paid.id}/pdf"`);
    expect(html).toContain(`href="/app/account/plan/billing/invoices/${waiting.id}/pdf"`);
    expect(html).toContain(`href="/app/account/plan/billing/receipts/${paid.receipts[0]?.id}/pdf"`);
    const links = [...html.matchAll(/<a\b[^>]*\/pdf"[^>]*>/g)].map((m) => m[0]);
    expect(links).toHaveLength(3);
    for (const link of links) expect(link).not.toMatch(/\bdownload\b/);
    expect(textOf(html)).toContain('Download Invoice (PDF) TP-A1B2C3D4-2');
    expect(textOf(html)).toContain('Download Receipt (PDF) R-000001');
  });

  it('offers a refund request for a paid purchase inside 7 days, with the reference filled in', async () => {
    const html = await renderServer(Page());
    const mailtos = [...html.matchAll(/href="(mailto:[^"]*)"/g)].map((m) => m[1] ?? '');
    // Only the paid purchase in its window: never the unpaid one.
    expect(mailtos).toHaveLength(1);
    const link = new URL((mailtos[0] ?? '').replaceAll('&amp;', '&'));
    expect(link.pathname).toBe('help@vs.example.test');
    expect(link.searchParams.get('subject')).toBe('Refund Request TP-A1B2C3D4-2');
    expect(link.searchParams.get('body')).toBe(
      'Please refund my purchase TP-A1B2C3D4-2, paid on 30 Oct 2026.',
    );
    const text = textOf(html);
    expect(text).toContain('Request a Refund for TP-A1B2C3D4-2');
    expect(text).toContain('You can ask for a full refund until 6 Nov 2026');
    expect(text).toContain('you do not need to give a reason');
  });

  it('says how to ask through Help and Support when no support inbox is set up', async () => {
    vi.stubEnv('SUPPORT_EMAIL', '');
    const html = await renderServer(Page());
    expect(html).not.toContain('mailto:');
    expect(html).toContain('href="/app/help#contact"');
    expect(textOf(html)).toContain('and quote TP-A1B2C3D4-2');
  });

  it('offers no refund once the window has passed, after a refund, or for a test payment', async () => {
    mocks.listOwnBilling.mockResolvedValue({
      ok: true,
      value: [
        { ...paid, refundableUntil: null },
        {
          ...paid,
          id: '33333333-2222-4333-8444-555555555555',
          status: 'refunded',
          statusLabel: 'Refunded',
          paidAt: null,
          refundableUntil: null,
        },
        {
          ...paid,
          id: '44444444-2222-4333-8444-555555555555',
          testPayment: true,
          refundableUntil: null,
        },
      ],
    });
    const html = await renderServer(Page());
    expect(html).not.toContain('mailto:');
    expect(textOf(html)).not.toContain('Request a Refund');
    expect(textOf(html)).toContain('Test Payment');
    expect(textOf(html)).toContain('The money paid for this was refunded.');
  });

  it('shows a plain empty state with no billing figures', async () => {
    mocks.listOwnBilling.mockResolvedValue({ ok: true, value: [] });
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('No Purchases Yet');
    expect(text).not.toMatch(/\bBDT\b|Refund|Receipt R-/);
  });

  it('is not found when the service refuses the scope', async () => {
    mocks.listOwnBilling.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'no' },
    });
    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('passes the automated accessibility rules, with purchases and when empty', async () => {
    expect(await axeViolations(await renderServer(Page()))).toEqual([]);
    mocks.listOwnBilling.mockResolvedValue({ ok: true, value: [] });
    expect(await axeViolations(await renderServer(Page()))).toEqual([]);
  });
});
