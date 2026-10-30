import type { AgencyInvoiceView } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../../lib/axe.test-support';
import '../../../../../../lib/next-mocks.test-support';

vi.mock('./actions', () => ({
  startPaymentAction: async () => ({ ok: true, message: '' }),
  checkPaymentAction: async () => ({ ok: true, message: '' }),
  submitClaimAction: async () => ({ ok: true, message: '' }),
}));

const { InvoiceCard } = await import('./invoice-card');

const ORG = '11111111-2222-4333-8444-555555555555';
const DAY = 24 * 60 * 60 * 1000;

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
    attempts: [],
    claims: [],
    receipts: [],
    ...overrides,
  };
}

const render = (view: AgencyInvoiceView, onlineAvailable = true) =>
  renderToStaticMarkup(
    <InvoiceCard
      invoice={view}
      organizationId={ORG}
      onlineAvailable={onlineAvailable}
      latestDate="2026-10-28"
    />,
  );

const attempt = (status: 'REDIRECTED' | 'RECORDED' | 'HELD_FOR_REVIEW' | 'FAILED') => ({
  id: `a-${status}`,
  status,
  amountMinorUnits: 125050,
  currency: 'BDT',
  createdAt: new Date('2026-10-27T10:00:00Z'),
  redirectedAt: new Date('2026-10-27T10:00:30Z'),
  recordedAt: status === 'RECORDED' ? new Date('2026-10-27T10:05:00Z') : null,
  reasonCode: null,
  merchantTranId: null,
});

const claim = (status: 'SUBMITTED' | 'APPROVED' | 'REJECTED', withProof = false) => ({
  id: `c-${status}`,
  invoiceId: 'inv-1',
  invoiceRef: 'INV-2026-001',
  invoiceOutstandingMinorUnits: 125050,
  method: 'BANK_TRANSFER' as const,
  reference: 'TRX-1',
  amountMinorUnits: 50000,
  currency: 'BDT',
  paidOn: new Date('2026-10-25T00:00:00Z'),
  note: null,
  status,
  decidedAt: status === 'SUBMITTED' ? null : new Date('2026-10-26T00:00:00Z'),
  decisionReason: status === 'REJECTED' ? 'We found no transfer with this reference' : null,
  createdAt: new Date('2026-10-25T08:00:00Z'),
  hasProofFile: withProof,
  submittedByAccountId: null,
  decidedByAccountId: null,
});

const receipt = {
  id: 'r-1',
  receiptNumber: 7,
  number: 'R-000007',
  invoiceId: 'inv-1',
  invoiceRef: 'INV-2026-001',
  amountMinorUnits: 125050,
  currency: 'BDT',
  kind: 'ONLINE',
  collectedDate: new Date('2026-10-27T10:05:00Z'),
  issuedAt: new Date('2026-10-27T10:05:00Z'),
};

describe('an invoice card on the agency Invoices page', () => {
  it('offers Pay Online and I Paid Another Way on an open BDT invoice, and shows what is owed', () => {
    const html = render(invoice());
    expect(html).toContain('INV-2026-001');
    expect(html).toContain('>Open<');
    expect(html).toContain('Pay Online');
    expect(html).toContain('I Paid Another Way');
    expect(html).toContain('BDT\u00a01,250.50');
    expect(html).toContain('name="amount"');
    expect(html).toContain('value="1250.50"');
  });

  it('does not offer online payment when it is switched off or the invoice is not in BDT', () => {
    expect(render(invoice(), false)).not.toContain('Pay Online');
    const usd = render(invoice({ currency: 'USD' }));
    expect(usd).not.toContain('Pay Online');
    expect(usd).toContain('I Paid Another Way');
  });

  it('shows a recent payment first, with Check Status and Start Another Payment, never a Continue link', () => {
    const html = render(
      invoice({
        state: 'PAYMENT_STARTED',
        recentAttemptStartedAt: new Date(),
        attempts: [attempt('REDIRECTED')],
      }),
    );
    expect(html).toContain('Check it before paying again.');
    expect(html).toContain('Check Status');
    expect(html).toContain('Start Another Payment');
    expect(html).not.toContain('Continue');
    expect(html).not.toContain('>Pay Online<');
    expect(html).toContain('Payment Started');
  });

  it('shows a waiting report as Payment Reported and offers no second report', () => {
    const html = render(invoice({ state: 'PAYMENT_REPORTED', claims: [claim('SUBMITTED')] }));
    expect(html).toContain('Payment Reported');
    expect(html).toContain('Waiting for confirmation');
    expect(html).toContain('Waiting for Confirmation');
    expect(html).not.toContain('Report This Payment');
  });

  it('shows the reason a report was not accepted, and a proof download for the agency', () => {
    const html = render(invoice({ claims: [claim('REJECTED', true)] }));
    expect(html).toContain('Not Accepted');
    expect(html).toContain('We found no transfer with this reference');
    expect(html).toContain(`/api/billing/proof/${ORG}/c-REJECTED`);
    expect(html).toContain('Report This Payment');
  });

  it('offers no payment while an online payment is held for a check, but keeps the report form', () => {
    const html = render(invoice({ state: 'NEEDS_CHECK', attempts: [attempt('HELD_FOR_REVIEW')] }));
    expect(html).not.toContain('Pay Online');
    expect(html).toContain('Payment Needs a Check');
    expect(html).toContain('I Paid Another Way');
  });

  it('says Payment Needs a Check on a paid invoice that also holds an online payment, with no payment actions', () => {
    const html = render(
      invoice({
        status: 'PAID',
        state: 'NEEDS_CHECK',
        collectedAmountMinorUnits: 125050,
        outstandingMinorUnits: 0,
        attempts: [attempt('HELD_FOR_REVIEW')],
      }),
    );
    expect(html).toContain('Payment Needs a Check');
    expect(html).not.toContain('Pay Online');
    expect(html).not.toContain('I Paid Another Way');
  });

  it('shows a paid invoice with its receipt link and no payment actions', () => {
    const html = render(
      invoice({
        status: 'PAID',
        state: 'PAID',
        collectedAmountMinorUnits: 125050,
        outstandingMinorUnits: 0,
        attempts: [attempt('RECORDED')],
        receipts: [receipt],
      }),
    );
    expect(html).toContain('>Paid<');
    expect(html).toContain('Receipt R-000007');
    expect(html).toContain(`/app/agency/${ORG}/plan/invoices/receipts/r-1`);
    expect(html).not.toContain('Pay Online');
    expect(html).not.toContain('I Paid Another Way');
  });

  it('says Payment Needs a Check in plain words, without gateway codes', () => {
    const html = render(
      invoice({
        state: 'NEEDS_CHECK',
        attempts: [{ ...attempt('HELD_FOR_REVIEW'), reasonCode: null }],
      }),
    );
    expect(html).toContain('Payment Needs a Check');
    expect(html).toContain('VisaStack will contact you.');
    expect(html).not.toContain('HELD_FOR_REVIEW');
    expect(html).not.toContain('already_paid');
  });

  it('never prints a payment reference or a gateway identifier for the agency list', () => {
    const html = render(
      invoice({
        attempts: [attempt('REDIRECTED')],
        claims: [claim('SUBMITTED', true)],
        state: 'PAYMENT_REPORTED',
      }),
    );
    expect(html).not.toContain('TRX-1');
    expect(html).not.toContain('VSP');
  });

  it('passes the accessibility scan in every state', async () => {
    const views = [
      invoice(),
      invoice({
        recentAttemptStartedAt: new Date(),
        state: 'PAYMENT_STARTED',
        attempts: [attempt('REDIRECTED')],
      }),
      invoice({ state: 'PAYMENT_REPORTED', claims: [claim('SUBMITTED', true)] }),
      invoice({ state: 'NEEDS_CHECK', attempts: [attempt('HELD_FOR_REVIEW')] }),
      invoice({
        status: 'PAID',
        state: 'PAID',
        collectedAmountMinorUnits: 125050,
        outstandingMinorUnits: 0,
        claims: [claim('APPROVED'), claim('REJECTED')],
        attempts: [attempt('RECORDED'), attempt('FAILED')],
        receipts: [receipt],
      }),
      invoice({ status: 'VOID', state: 'VOID' }),
      invoice({ state: 'REFUNDED', outstandingMinorUnits: 0, refundedMinorUnits: 125050 }),
      invoice({
        status: 'PARTIALLY_PAID',
        state: 'PARTLY_REFUNDED',
        collectedAmountMinorUnits: 100000,
        outstandingMinorUnits: 0,
        refundedMinorUnits: 25050,
        creditMinorUnits: 50000,
      }),
    ];
    for (const view of views) {
      expect(await axeViolations(render(view)), view.state).toEqual([]);
    }
  }, 60_000);

  it('shows a refunded invoice as refunded, with nothing to pay and no way to pay (S18)', () => {
    for (const view of [
      invoice({ state: 'REFUNDED', outstandingMinorUnits: 0, refundedMinorUnits: 125050 }),
      invoice({
        status: 'PARTIALLY_PAID',
        state: 'PARTLY_REFUNDED',
        collectedAmountMinorUnits: 100000,
        outstandingMinorUnits: 0,
        refundedMinorUnits: 25050,
      }),
    ]) {
      const html = render(view);
      expect(html).toContain(view.state === 'REFUNDED' ? 'Refunded' : 'Partly Refunded');
      expect(html).toContain('<dt>Refunded</dt>');
      expect(html).not.toContain('Pay Online');
      expect(html).not.toContain('Report This Payment');
    }
  });

  it('says when part of an invoice was paid by a credit from an earlier payment (S18)', () => {
    const html = render(
      invoice({
        status: 'PAID',
        state: 'PAID',
        collectedAmountMinorUnits: 125050,
        outstandingMinorUnits: 0,
        creditMinorUnits: 50000,
      }),
    );
    expect(html).toContain('Credit from an earlier payment');
  });

  it('never offers a way to pay a refunded invoice, even while a payment on it needs a check (S18 round 2)', () => {
    const html = render(
      invoice({
        status: 'PARTIALLY_PAID',
        state: 'NEEDS_CHECK',
        collectedAmountMinorUnits: 100000,
        outstandingMinorUnits: 0,
        refundedMinorUnits: 25050,
        attempts: [attempt('HELD_FOR_REVIEW')],
      }),
    );
    expect(html).not.toContain('Pay Online');
    expect(html).not.toContain('Report This Payment');
    expect(html).toContain('<dt>Kept After Refunds</dt>');
    expect(html).not.toContain('<dt>Due</dt>');
    expect(html).not.toContain('<dt>Paid So Far</dt>');
  });
});
