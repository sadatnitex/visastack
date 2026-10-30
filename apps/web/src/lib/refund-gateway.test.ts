import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  create: vi.fn(),
  report: vi.fn(),
}));
vi.mock('./providers', () => ({
  isPaymentProviderConfigured: mocks.configured,
  createPaymentPort: mocks.create,
}));
vi.mock('./server-error', () => ({ reportServerError: mocks.report }));

const { refundCheckPort, refundPorts, refundSendPort, refundsViaGatewayEnabled } = await import(
  './refund-gateway'
);

const refunding = {
  configured: true,
  provider: 'sslcommerz',
  refund: async () => ({ kind: 'accepted', refundRefId: 'RR1' }),
  queryRefund: async () => ({ status: 'UNKNOWN', refundedAt: null }),
};
const on = (name: string) => (name === 'PAYMENT_REFUNDS_VIA_GATEWAY' ? 'true' : undefined);

beforeEach(() => {
  mocks.configured.mockReturnValue(true);
  mocks.create.mockReturnValue(refunding);
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('refunds through the payment gateway (S18)', () => {
  it('are off unless the switch is exactly "true"', () => {
    for (const value of [undefined, '', 'TRUE', '1', 'yes', ' true']) {
      expect(
        refundsViaGatewayEnabled(() => value),
        String(value),
      ).toBe(false);
      expect(refundSendPort(() => value)).toBeNull();
    }
    expect(refundsViaGatewayEnabled(on)).toBe(true);
    expect(refundSendPort(on)).toBe(refunding);
  });

  it('never make the payment port when the configuration is incomplete', () => {
    mocks.configured.mockReturnValue(false);
    expect(refundSendPort(on)).toBeNull();
    expect(refundCheckPort()).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('turn a payment port that refuses to be made into "no gateway", reported, never a crash', () => {
    mocks.create.mockImplementation(() => {
      throw new Error('PAYMENT_PROVIDER=sslcommerz requires SSLCOMMERZ_STORE_ID');
    });
    expect(refundSendPort(on)).toBeNull();
    expect(refundCheckPort()).toBeNull();
    expect(mocks.report).toHaveBeenCalled();
  });

  it('ignore a configured gateway that cannot refund', () => {
    mocks.create.mockReturnValue({ configured: true, provider: 'other' });
    expect(refundSendPort(on)).toBeNull();
  });

  it('build the payment port once for a page that needs both answers', () => {
    expect(refundPorts(on)).toEqual({ check: refunding, send: refunding });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(refundPorts(() => undefined)).toEqual({ check: refunding, send: null });
  });
});
