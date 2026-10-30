import type { OrganizationRefundWork, RefundRequestView } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';
import '../../../../../lib/next-mocks.test-support';

const noop = async () => ({ ok: true, message: '' });
vi.mock('./refund-actions', () => ({
  applyCreditAction: noop,
  cancelRefundAction: noop,
  checkRefundsAction: noop,
  confirmUnsentRefundAction: noop,
  recordManualRefundAction: noop,
  requestRefundAction: noop,
  retryRefundAction: noop,
}));

const { RefundsCard } = await import('./refund-panel');
const { REFUNDS_IN_PANEL } = await import('../../../../../lib/refund-gateway');

const ORG = '11111111-2222-4333-8444-555555555555';
const at = new Date('2026-10-28T08:00:00Z');

const request = (overrides: Partial<RefundRequestView>): RefundRequestView => ({
  id: 'r1',
  invoiceId: 'i1',
  invoiceRef: 'INV-1',
  method: 'PROVIDER',
  status: 'SUBMITTED',
  amountMinorUnits: 150000,
  currency: 'BDT',
  fromHeldPayment: false,
  reason: 'Agency overpaid',
  reference: 'RR1',
  failureCode: null,
  createdAt: at,
  confirmedAt: null,
  refundedOn: null,
  ...overrides,
});

const work = (overrides: Partial<OrganizationRefundWork> = {}): OrganizationRefundWork => ({
  available: true,
  more: false,
  creditTargets: [],
  held: [],
  requests: [],
  entries: [
    {
      id: 'e1',
      invoiceId: 'i1',
      invoiceRef: 'INV-1',
      kind: 'ONLINE',
      amountMinorUnits: 150000,
      currency: 'BDT',
      reference: 'BANK1',
      createdAt: at,
      paidOn: at,
      refundableMinorUnits: 150000,
      viaGateway: true,
    },
  ],
  ...overrides,
});

const render = (props: Partial<Parameters<typeof RefundsCard>[0]> = {}) =>
  renderToStaticMarkup(
    <RefundsCard
      organizationId={ORG}
      work={work()}
      gatewayAvailable
      checkAvailable
      latestDate="2026-10-30"
      {...props}
    />,
  );

describe('the Refunds and Credits card (S18)', () => {
  it('offers the gateway refund only when refunds through the gateway are switched on and set up', () => {
    const on = render();
    expect(on).toContain('Refund (INV-1)');
    expect(on).not.toContain(REFUNDS_IN_PANEL.slice(0, 40));
    const off = render({ gatewayAvailable: false });
    expect(off).not.toContain('Refund (INV-1)');
    expect(off).toContain('Record a Refund Made Outside VisaStack (INV-1)');
    expect(off).toContain('Refunds are made in the payment gateway&#x27;s merchant panel');
  });

  it('draws no form, and no idempotency key, until a disclosure is opened', () => {
    const html = render();
    expect(html).not.toContain('name="idempotencyKey"');
    expect(html).not.toContain('<form');
  });

  it('says when it shows only the most recent payments', () => {
    expect(render({ work: work({ more: true }) })).toContain(
      'Showing the 25 most recent payments that can still be refunded',
    );
  });

  it('shows a refund the ledger refused as Needs a Check, and unconfirmed ones with both choices', () => {
    const html = render({
      work: work({
        requests: [
          request({ id: 'r1', failureCode: 'ledger_refused' }),
          request({ id: 'r2', status: 'REQUESTED', reference: null }),
          request({
            id: 'r3',
            method: 'MANUAL',
            status: 'CONFIRMED',
            reference: 'BANK-OUT',
            refundedOn: new Date('2026-10-27T00:00:00Z'),
          }),
        ],
      }),
    });
    expect(html).toContain('Needs a Check');
    expect(html).toContain('It Went Through (INV-1)');
    expect(html).toContain('It Did Not Go Through (INV-1)');
    expect(html).toContain('id="refund-line-r2"');
    expect(html).toMatch(/refunded on [^;]*27/);
    expect(html).toContain('recorded on');
  });

  it('passes the accessibility scan', async () => {
    expect(await axeViolations(render())).toEqual([]);
    expect(await axeViolations(render({ gatewayAvailable: false }))).toEqual([]);
  }, 60_000);
});
