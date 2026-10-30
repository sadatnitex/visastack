import { paymentPortResolver } from '@visastack/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ports: vi.fn(),
  report: vi.fn(),
}));
vi.mock('./providers', () => ({ paymentPorts: mocks.ports }));
vi.mock('./server-error', () => ({ reportServerError: mocks.report }));

const { refundCheckPort, refundPorts, refundSendPort, refundsViaGatewayEnabled } = await import(
  './refund-gateway'
);

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

  it('ask only for gateways that can refund, and give "no gateway" when none is configured', () => {
    mocks.ports.mockReturnValue(none);
    expect(refundSendPort(on)).toBeNull();
    expect(refundCheckPort()).toBeNull();
    expect(mocks.ports).toHaveBeenCalledWith({ refundsOnly: true });
  });

  it('turn payment ports that refuse to be made into "no gateway", reported, never a crash', () => {
    mocks.ports.mockImplementation(() => {
      throw new Error('PAYMENT_PROVIDER=sslcommerz requires SSLCOMMERZ_STORE_ID');
    });
    expect(refundSendPort(on)).toBeNull();
    expect(refundCheckPort()).toBeNull();
    expect(mocks.report).toHaveBeenCalled();
  });

  it('build the payment ports once for a page that needs both answers', () => {
    expect(refundPorts(on)).toEqual({ check: gateways, send: gateways });
    expect(mocks.ports).toHaveBeenCalledTimes(1);
    expect(refundPorts(() => undefined)).toEqual({ check: gateways, send: null });
  });
});
