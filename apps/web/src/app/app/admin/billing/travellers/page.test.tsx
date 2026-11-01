import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { navigationState, renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  getTravellerBilling: vi.fn(),
  listTravellerNeedsCheck: vi.fn(),
}));

vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'owner@example.com' }),
}));
vi.mock('../../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: (...args: unknown[]) => mocks.staffPrincipal(...args),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getTravellerBilling: (...args: unknown[]) => mocks.getTravellerBilling(...args),
  listTravellerNeedsCheck: (...args: unknown[]) => mocks.listTravellerNeedsCheck(...args),
}));
vi.mock('./actions', () => ({
  recordTravellerRefundAction: async () => ({ ok: true, message: '' }),
}));
// The disclosures draw their forms only once opened in a browser; here they are drawn at once, so
// the real forms (and their hidden fields) are part of what is checked.
vi.mock('../../organizations/[orgId]/refund-feedback', () => ({
  useRefundReport: () => () => undefined,
  RefundFeedback: ({ children }: { readonly children: ReactNode }) => (
    <>
      <output tabIndex={-1} className="field-msg field-msg-ok" />
      {children}
    </>
  ),
  LazyDisclosure: ({
    title,
    children,
  }: { readonly title: string; readonly children: ReactNode }) => (
    <details className="disclosure u-mt-100">
      <summary>
        <span className="disclosure-title">{title}</span>
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  ),
}));

const { PERSON_REFUNDS_UNAVAILABLE } = await import('@visastack/services');
const { default: Page } = await import('./page');

const NOW = new Date('2026-10-31T06:00:00Z');
const SCOPE = { kind: 'staff', platformAction: 'BILLING_REFUND_MANAGE' };
const PAYER = '9d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6';
const LIVE_ENTRY = '0f8b6c1e-2d3a-4b5c-8d6e-7f8091a2b3c4';
const TEST_ENTRY = '2b3c4d5e-6f70-4a81-92b3-c4d5e6f7a8b9';
const SPENT_ENTRY = '3c4d5e6f-7081-4a92-a3b4-d5e6f7a8b9c0';
const HELD = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const SPENT_HELD = '4d5e6f70-8192-4aa3-b4c5-e6f7a8b9c0d1';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DAY = 24 * 60 * 60 * 1000;

/**
 * What the services return, with the neighbours a careless page might print seeded beside it: the
 * person's account id, name and email. None of them may ever reach the page.
 */
const secrets = {
  payerAccountId: PAYER,
  accountId: PAYER,
  name: 'Rahim Uddin',
  displayName: 'Rahim Uddin',
  email: 'rahim.uddin@example.com',
};

function person(overrides: Record<string, unknown> = {}) {
  return {
    ...secrets,
    code: '9D1E2F3A4B5C',
    shortCode: '9D1E2F3A',
    plan: { planName: 'Traveller Plus', renews: true, paidUntil: new Date('2026-11-27T17:59:59Z') },
    invoices: [
      {
        ...secrets,
        id: 'a5b6c7d8-0000-4000-8000-000000000001',
        invoiceRef: 'TP-9D1E2F3A-2',
        planName: 'Traveller Plus',
        amountMinorUnits: 150000,
        collectedAmountMinorUnits: 150000,
        currency: 'BDT',
        statusLabel: 'Paid',
        periodStart: new Date('2026-10-27T18:00:00Z'),
        periodEnd: new Date('2026-11-27T18:00:00Z'),
        renewal: true,
      },
    ],
    payments: [
      {
        ...secrets,
        id: LIVE_ENTRY,
        invoiceRef: 'TP-9D1E2F3A-2',
        kind: 'ONLINE',
        mode: 'LIVE',
        amountMinorUnits: 150000,
        currency: 'BDT',
        collectedDate: new Date('2026-10-28T00:00:00Z'),
        refundableMinorUnits: 150000,
        refundWindowEndsAt: new Date(new Date('2026-10-28T00:00:00Z').getTime() + 7 * DAY),
      },
      {
        ...secrets,
        id: TEST_ENTRY,
        invoiceRef: 'TP-9D1E2F3A-1',
        kind: 'ONLINE',
        mode: 'TEST',
        amountMinorUnits: 50000,
        currency: 'BDT',
        collectedDate: new Date('2026-10-10T00:00:00Z'),
        refundableMinorUnits: 50000,
        refundWindowEndsAt: new Date(new Date('2026-10-10T00:00:00Z').getTime() + 7 * DAY),
      },
      {
        ...secrets,
        id: SPENT_ENTRY,
        invoiceRef: 'TP-9D1E2F3A-0',
        kind: 'ONLINE',
        mode: 'LIVE',
        amountMinorUnits: 70000,
        currency: 'BDT',
        collectedDate: new Date('2026-10-29T00:00:00Z'),
        refundableMinorUnits: 0,
        refundWindowEndsAt: new Date(new Date('2026-10-29T00:00:00Z').getTime() + 7 * DAY),
      },
    ],
    held: [
      {
        ...secrets,
        id: HELD,
        invoiceRef: 'TP-9D1E2F3A-3',
        amountMinorUnits: 30000,
        remainingMinorUnits: 30000,
        currency: 'BDT',
        reasonCode: 'already_covered',
        since: new Date('2026-10-30T10:00:00Z'),
        paidOn: new Date('2026-10-30T10:00:00Z'),
        refundWindowEndsAt: new Date(
          new Date('2026-10-30T10:00:00Z').getTime() + 7 * 24 * 60 * 60 * 1000,
        ),
      },
      {
        ...secrets,
        id: SPENT_HELD,
        invoiceRef: 'TP-9D1E2F3A-4',
        amountMinorUnits: 20000,
        remainingMinorUnits: 0,
        currency: 'BDT',
        reasonCode: 'period_over',
        since: new Date('2026-10-30T11:00:00Z'),
        paidOn: new Date('2026-10-30T11:00:00Z'),
        refundWindowEndsAt: new Date(
          new Date('2026-10-30T11:00:00Z').getTime() + 7 * 24 * 60 * 60 * 1000,
        ),
      },
    ],
    refunds: [
      {
        ...secrets,
        id: 'b6c7d8e9-0000-4000-8000-000000000002',
        invoiceRef: 'TP-9D1E2F3A-0',
        amountMinorUnits: 70000,
        currency: 'BDT',
        status: 'CONFIRMED',
        reference: 'GW-REFUND-11',
        refundedOn: new Date('2026-10-29T00:00:00Z'),
      },
    ],
    ...overrides,
  };
}

const NEEDS = [
  {
    ...secrets,
    kind: 'held',
    paymentAttemptId: HELD,
    shortCode: '9D1E2F3A',
    invoiceRef: 'TP-9D1E2F3A-3',
    amountMinorUnits: 30000,
    currency: 'BDT',
    reasonCode: 'invoice_void',
    since: new Date('2026-10-30T10:00:00Z'),
  },
  {
    ...secrets,
    kind: 'confirming',
    paymentAttemptId: '5e6f7081-92a3-4b4c-85d6-f7a8b9c0d1e2',
    shortCode: '7A8B9C0D',
    invoiceRef: 'TP-7A8B9C0D-1',
    amountMinorUnits: 99900,
    currency: 'BDT',
    reasonCode: null,
    since: new Date('2026-10-31T05:00:00Z'),
  },
];

function found(people: readonly unknown[], refundsAvailable = true) {
  return { ok: true, value: { refundsAvailable, people } };
}

/** The page with its refund forms' hidden fields (the only place payment ids may travel) taken out. */
function visible(html: string): string {
  return html.replace(/<input type="hidden"[^>]*>/g, '');
}

async function render(code?: string): Promise<string> {
  return renderServer(Page(code === undefined ? {} : { searchParams: Promise.resolve({ code }) }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  navigationState.pathname = '/app/admin/billing/travellers';
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.listTravellerNeedsCheck.mockResolvedValue({ ok: true, value: NEEDS });
  mocks.getTravellerBilling.mockResolvedValue(found([person()]));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Platform > Traveller Billing (ADR 0025 T6b)', () => {
  it('shows anyone but the platform owner the restricted page, and reads nothing', async () => {
    mocks.staffPrincipal.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'x' },
    });
    const html = await render('9D1E2F3A');
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('BILLING_REFUND_MANAGE');
    expect(textOf(html)).toContain('This area is restricted to platform administrators.');
    expect(textOf(html)).not.toContain('Needs a Check');
    expect(textOf(html)).not.toContain('Find a Traveller');
    expect(mocks.listTravellerNeedsCheck).not.toHaveBeenCalled();
    expect(mocks.getTravellerBilling).not.toHaveBeenCalled();
  });

  it('shows the restricted page when a service refuses the scope', async () => {
    mocks.listTravellerNeedsCheck.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'Only the platform owner can see traveller billing.' },
    });
    expect(textOf(await render())).toContain('restricted to platform administrators');
  });

  it('lists the payments that need a check, each with a link that looks the traveller up', async () => {
    const html = await render();
    const text = textOf(html);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text).toContain('Traveller Billing');
    expect(text).toContain('Needs a Check');
    expect(mocks.listTravellerNeedsCheck.mock.calls[0]?.[1]).toEqual(SCOPE);
    expect(mocks.listTravellerNeedsCheck.mock.calls[0]?.[2]).toEqual({ now: NOW });
    expect(text).toContain('9D1E2F3A');
    expect(text).toContain('TP-9D1E2F3A-3');
    expect(text).toContain('BDT 300.00');
    expect(text).toContain('The invoice was cancelled.');
    expect(text).toContain('Still confirming with the payment gateway after 30 minutes.');
    expect(text).toContain('7A8B9C0D');
    expect(text).toContain('BDT 999.00');
    expect(text).toContain('30 Oct 2026, 16:00');
    expect(html).toContain('href="/app/admin/billing/travellers?code=TP-9D1E2F3A-3"');
    expect(html).toContain('href="/app/admin/billing/travellers?code=TP-7A8B9C0D-1"');
    // No code asked for: the search form only, and no lookup.
    expect(text).toContain('Find a Traveller');
    expect(text).toContain('Reference Code or Purchase Reference');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="code"');
    expect(mocks.getTravellerBilling).not.toHaveBeenCalled();
    expect(await axeViolations(html)).toEqual([]);
  });

  it('says so when nothing needs a check', async () => {
    mocks.listTravellerNeedsCheck.mockResolvedValue({ ok: true, value: [] });
    expect(textOf(await render())).toContain('No traveller payment needs a check.');
  });

  it("shows one traveller's plan, purchases, payments, held payments and refunds", async () => {
    const html = await render(' tp-9d1e2f3a-2 ');
    const text = textOf(html);
    expect(mocks.getTravellerBilling.mock.calls[0]?.[1]).toEqual(SCOPE);
    expect(mocks.getTravellerBilling.mock.calls[0]?.[2]).toEqual({
      code: 'tp-9d1e2f3a-2',
      now: NOW,
    });
    // One traveller: the heading shows the short code.
    expect(text).toContain('Reference Code 9D1E2F3A');
    expect(text).not.toContain('9D1E2F3A4B5C');
    expect(html).toContain('value="tp-9d1e2f3a-2"');
    // Plan.
    expect(text).toContain('Traveller Plus');
    expect(text).toMatch(/Renewing Yes/);
    expect(text).toContain('Paid Until 27 Nov 2026, 23:59');
    // Purchases, as a real table.
    expect(html).toContain('<caption class="sr-only">Purchases of 9D1E2F3A</caption>');
    expect(text).toContain('Traveller Plus (renewal)');
    expect(text).toContain('28 Oct 2026 to 27 Nov 2026');
    expect(text).toContain('Paid');
    // Payments.
    expect(text).toContain('Test or Live');
    expect(text).toContain('Test Payment');
    expect(text).toContain('Live');
    expect(text).toContain('BDT 1,500.00');
    expect(text).toContain('Can Still Go Back');
    expect(text).toContain('Nothing');
    expect(text).toContain('4 Nov 2026, 06:00');
    // Held payments, in plain words.
    expect(text).toContain(
      'A paid period already covered this time, so the payment was kept for a refund.',
    );
    expect(text).toContain(
      'The period this payment was for had already ended, so it was kept for a refund.',
    );
    // Refunds made.
    expect(text).toContain('Refunds Made');
    expect(text).toContain('GW-REFUND-11');
    expect(text).toContain('Refunded');
    expect(text).toContain('29 Oct 2026');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('WP-SB9: folds each part of a traveller with its count, held payments open first', async () => {
    const html = await render('tp-9d1e2f3a-2');
    const groups = html.match(/<details class="collapsible-group"[^>]*>/g) ?? [];
    expect(groups.length).toBeGreaterThanOrEqual(5);
    expect(groups.filter((group) => /\sopen/.test(group))).toHaveLength(1);
    // This traveller has a held payment, which is what Needs a Check sends the owner here for.
    expect(groups.find((group) => /\sopen/.test(group))).toMatch(/id="traveller-[^"]+-held"/);
    for (const title of ['Plan', 'Purchases', 'Payments', 'Held Payments', 'Refunds Made']) {
      expect(html).toContain(`<span class="collapsible-group-title">${title}</span>`);
    }
    expect(html).toMatch(
      /Purchases<\/span><span class="collapsible-group-count" aria-hidden="true">\d+<\/span><span class="sr-only">, \d+ items?<\/span>/,
    );
  });

  it('marks a payment past the 7 days as Outside 7 Days, and only that one', async () => {
    const html = await render('9D1E2F3A');
    expect(textOf(html).match(/Outside 7 Days/g)).toHaveLength(1);
    // The badge sits in the row of the test payment of 10 Oct, whose 7 days ended on 17 Oct.
    const row = html.split('<tr>').find((part) => part.includes('Outside 7 Days')) ?? '';
    expect(textOf(row)).toContain('TP-9D1E2F3A-1');
    expect(textOf(row)).toContain('17 Oct 2026');
  });

  it('offers Record Refund for each payment and held payment with something left, with the exact amount', async () => {
    const html = await render('9D1E2F3A');
    const text = textOf(html);
    // Two payments and one held payment have something left; the spent ones get no form.
    expect(html.match(/name="sourceId"/g)).toHaveLength(3);
    expect(html).toContain(
      `name="sourceKind" value="entry"/><input type="hidden" name="sourceId" value="${LIVE_ENTRY}"`,
    );
    expect(html).toContain(`name="sourceId" value="${TEST_ENTRY}"`);
    expect(html).toContain(
      `name="sourceKind" value="held"/><input type="hidden" name="sourceId" value="${HELD}"`,
    );
    expect(html).not.toContain(SPENT_ENTRY);
    expect(html).not.toContain(SPENT_HELD);
    expect(html).toContain('name="expectedAmountMinorUnits" value="150000"');
    expect(html).toContain('name="expectedAmountMinorUnits" value="50000"');
    expect(html).toContain('name="expectedAmountMinorUnits" value="30000"');
    expect(html.match(/name="idempotencyKey" value="[0-9a-f-]{36}"/g)).toHaveLength(3);
    // The amount is never typed: no amount field, only the amount stated.
    expect(html).not.toContain('name="amount"');
    expect(text).toContain(
      'This records a refund of BDT 1,500.00, all that is left of this payment.',
    );
    expect(text).toContain(
      'This records a refund of BDT 300.00, all that is left of this payment.',
    );
    expect(text).toContain('Record Refund (TP-9D1E2F3A-2)');
    expect(text).toContain('Record Refund (TP-9D1E2F3A-1, Test Payment)');
    expect(text).toContain('Record Refund (TP-9D1E2F3A-3, Held Payment)');
    // The payment past the 7 days says so before anything is recorded.
    expect(text.match(/This payment is more than 7 days old\./g)).toHaveLength(1);
    // The refund day starts on today in Bangladesh, and cannot be before the money came in.
    expect(html.match(/name="refundedOn" value="2026-10-31"/g)).toHaveLength(3);
    expect(html).toContain('min="2026-10-28" max="2026-10-31"');
    expect(html).toContain('min="2026-10-30" max="2026-10-31"');
    expect(text).toContain('Refund Reference');
    expect(text).toContain('Refunded On');
    expect(text).toContain('Reason');
  });

  it('never shows a name, an email or an account id', async () => {
    for (const people of [[person()], [person(), person({ code: '9D1E2F3A0000' })]]) {
      mocks.getTravellerBilling.mockResolvedValue(found(people));
      const html = await render('9D1E2F3A');
      const shown = visible(html);
      expect(shown).not.toMatch(UUID);
      expect(shown).not.toContain('@');
      expect(shown).not.toContain('Rahim');
      expect(html).not.toContain(PAYER);
    }
    mocks.getTravellerBilling.mockResolvedValue(found([person()], false));
    const unavailable = await render('9D1E2F3A');
    expect(unavailable).not.toMatch(UUID);
    expect(unavailable).not.toContain('@');
  });

  it('tells apart travellers who share a short code by their longer code', async () => {
    mocks.getTravellerBilling.mockResolvedValue(
      found([person(), person({ code: '9D1E2F3A0000' })]),
    );
    const html = await render('9D1E2F3A');
    const text = textOf(html);
    expect(text).toContain('Reference Code 9D1E2F3A4B5C');
    expect(text).toContain('Reference Code 9D1E2F3A0000');
    expect(text).not.toContain('Reference Code 9D1E2F3A ');
    expect(text).toContain('Another traveller shares the short code 9D1E2F3A');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('says refunds are not available yet, and offers no refund form', async () => {
    mocks.getTravellerBilling.mockResolvedValue(found([person()], false));
    const html = await render('9D1E2F3A');
    const text = textOf(html);
    expect(text).toContain(PERSON_REFUNDS_UNAVAILABLE);
    expect(text).toContain('Refunds for travellers are not available yet.');
    expect(html).not.toContain('name="sourceId"');
    expect(text).not.toContain('Record Refund');
    // What happened is still shown.
    expect(text).toContain('Refunds Made');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('says when no traveller matches, and when the code cannot be one', async () => {
    mocks.getTravellerBilling.mockResolvedValue(found([]));
    expect(textOf(await render('ABCDEF12'))).toContain(
      'No traveller has that reference code or purchase reference.',
    );
    mocks.getTravellerBilling.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        message: 'Enter a reference code (8 or more letters and digits) or a purchase reference.',
      },
    });
    const html = await render('xyz');
    expect(textOf(html)).toContain(
      'Enter a reference code (8 or more letters and digits) or a purchase reference.',
    );
    expect(html).toContain('aria-invalid="true"');
    expect(await axeViolations(html)).toEqual([]);
  });
});
