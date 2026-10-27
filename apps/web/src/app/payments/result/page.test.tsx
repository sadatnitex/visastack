import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ view: vi.fn(), signed: vi.fn() }));
vi.mock('../../../lib/public-db', () => ({
  withPublicDb: async (work: (db: unknown) => unknown) => work({}),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getPaymentResultView: mocks.view,
}));
vi.mock('../../../lib/payment-result', () => ({ verifyPaymentResultParams: mocks.signed }));

const { default: Page } = await import('./page');

const TRAN = 'VSP0123456789abcdef0123456789';
const render = async (params: Record<string, string>) =>
  new JSDOM(renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }))).window
    .document;

beforeEach(() => {
  mocks.view.mockReset();
  mocks.signed.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('the payment result page', () => {
  const states = [
    ['received', 'Payment Received', 'We have received your payment'],
    ['confirming', 'We Are Confirming Your Payment', 'you do not need to pay again'],
    ['not_completed', 'Payment Not Completed', 'Nothing was charged'],
    ['needs_check', 'Payment Needs a Check', 'We will contact you'],
  ] as const;

  for (const [state, heading, phrase] of states) {
    it(`shows "${heading}" from the payment own state`, async () => {
      mocks.signed.mockReturnValue(true);
      mocks.view.mockResolvedValue({
        state,
        invoiceRef: 'INV-100',
        amountMinorUnits: 125050,
        currency: 'BDT',
      });
      const document = await render({ t: TRAN, x: '9999999999', s: 'sig' });
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      expect(document.querySelector('h1')?.textContent).toBe(heading);
      expect(document.body.textContent).toContain(phrase);
      expect(document.body.textContent).toContain('Invoice INV-100: BDT 1250.50');
      expect(mocks.view.mock.calls[0]?.[1]).toBe(TRAN);
    });
  }

  it('shows a neutral message, and reads nothing, for an unsigned, expired or unknown address', async () => {
    mocks.signed.mockReturnValue(false);
    const unsigned = await render({ t: TRAN, o: 'received' });
    expect(unsigned.querySelector('h1')?.textContent).toBe(
      'This Payment Link Is No Longer Available',
    );
    expect(unsigned.body.textContent).not.toContain('Payment Received');
    expect(mocks.view).not.toHaveBeenCalled();
    mocks.signed.mockReturnValue(true);
    mocks.view.mockResolvedValue(null);
    const unknown = await render({ t: TRAN, x: '9999999999', s: 'sig' });
    expect(unknown.querySelector('h1')?.textContent).toBe(
      'This Payment Link Is No Longer Available',
    );
    const empty = await render({});
    expect(empty.querySelector('h1')?.textContent).toBe('This Payment Link Is No Longer Available');
  });

  it('never takes the answer from the address: an address claiming success shows the real state', async () => {
    mocks.signed.mockReturnValue(true);
    mocks.view.mockResolvedValue({
      state: 'not_completed',
      invoiceRef: 'INV-100',
      amountMinorUnits: 100,
      currency: 'BDT',
    });
    const document = await render({
      t: TRAN,
      x: '9999999999',
      s: 'sig',
      state: 'received',
      o: 'success',
    });
    expect(document.querySelector('h1')?.textContent).toBe('Payment Not Completed');
  });

  it('falls back to the neutral message when the lookup fails', async () => {
    mocks.signed.mockReturnValue(true);
    mocks.view.mockRejectedValue(new Error('database down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const document = await render({ t: TRAN, x: '9999999999', s: 'sig' });
    expect(document.querySelector('h1')?.textContent).toBe(
      'This Payment Link Is No Longer Available',
    );
  });
});
