import { paymentPortResolver } from '@visastack/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ports: vi.fn(),
  report: vi.fn(),
}));
vi.mock('./providers', () => ({ paymentPorts: mocks.ports }));
vi.mock('./server-error', () => ({ reportServerError: mocks.report }));

const {
  refundCheckPort,
  refundGatewayViews,
  refundPorts,
  refundSendPort,
  refundsViaGatewayEnabled,
} = await import('./refund-gateway');

const refunding = {
  configured: true,
  mode: 'LIVE' as const,
  provider: 'sslcommerz',
  storeId: 'store',
  createCheckout: async () => ({ redirectUrl: 'https://x.invalid', sessionKey: 'k' }),
  validatePayment: async () => {
    throw new Error('not used');
  },
  queryByMerchantTranId: async () => {
    throw new Error('not used');
  },
  verifyIpnSignature: () => false,
  refund: async () => ({ kind: 'accepted' as const, refundRefId: 'RR1' }),
  queryRefund: async () => ({ status: 'UNKNOWN' as const, refundedAt: null }),
};
const gateways = paymentPortResolver([{ port: refunding, currencies: ['BDT'] }]);
const none = paymentPortResolver([]);
const on = (name: string) => (name === 'PAYMENT_REFUNDS_VIA_GATEWAY' ? 'true' : undefined);

beforeEach(() => {
  mocks.ports.mockReturnValue(gateways);
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('refunds through the payment gateway (S18, S19 step 0)', () => {
  it('are off unless the switch is exactly "true"', () => {
    for (const value of [undefined, '', 'TRUE', '1', 'yes', ' true']) {
      expect(
        refundsViaGatewayEnabled(() => value),
        String(value),
      ).toBe(false);
      expect(refundSendPort(() => value)).toBeNull();
    }
    expect(refundsViaGatewayEnabled(on)).toBe(true);
    expect(refundSendPort(on)).toBe(gateways);
  });

  it('give "no gateway" when no configured provider can refund, and every configured one otherwise (round 3)', () => {
    mocks.ports.mockReturnValue(none);
    expect(refundSendPort(on)).toBeNull();
    expect(refundCheckPort()).toBeNull();
    // A configured provider that cannot refund alone: still no gateway.
    const { refund: _refund, queryRefund: _query, ...payOnly } = refunding;
    const cannot = paymentPortResolver([{ port: payOnly, currencies: ['USD'] }]);
    mocks.ports.mockReturnValue(cannot);
    expect(refundCheckPort()).toBeNull();
    // Beside one that can, both are passed on, so the services can tell "switched off" from
    // "cannot refund".
    const mixed = paymentPortResolver([
      { port: refunding, currencies: ['BDT'] },
      { port: { ...payOnly, provider: 'otherpay' }, currencies: ['USD'] },
    ]);
    mocks.ports.mockReturnValue(mixed);
    expect(refundCheckPort()).toBe(mixed);
    expect(mixed.configured()).toHaveLength(2);
  });

  it('offer the gateway refund on the admin view only for providers that can refund (round 4)', () => {
    const { refund: _refund, queryRefund: _query, ...payOnly } = refunding;
    const mixed = paymentPortResolver([
      { port: refunding, currencies: ['BDT'] },
      { port: { ...payOnly, provider: 'otherpay' }, currencies: ['USD'] },
    ]);
    expect(refundGatewayViews(mixed)).toEqual([{ provider: 'sslcommerz', mode: 'LIVE' }]);
    expect(refundGatewayViews(null)).toEqual([]);
    expect(
      refundGatewayViews(paymentPortResolver([{ port: payOnly, currencies: ['USD'] }])),
    ).toEqual([]);
  });

  it('build the payment ports once for a page that needs both answers', () => {
    expect(refundPorts(on)).toEqual({ check: gateways, send: gateways });
    expect(mocks.ports).toHaveBeenCalledTimes(1);
    expect(refundPorts(() => undefined)).toEqual({ check: gateways, send: null });
  });
});
