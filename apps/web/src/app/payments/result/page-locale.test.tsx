import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bengaliMarking } from '../../../lib/bengali-marked.test-support';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));
vi.mock('next/navigation', () => ({
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
}));
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../lib/locale', () => ({ getLocale: async () => current.locale }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));
const mocks = vi.hoisted(() => ({ view: vi.fn(), signed: vi.fn() }));
vi.mock('../../../lib/public-db', () => ({
  withPublicDb: async (work: (db: unknown) => unknown) => work({}),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getPaymentResultView: mocks.view,
}));
vi.mock('../../../lib/payment-result', () => ({ verifyPaymentResultParams: mocks.signed }));

import { paymentsCatalog } from '../../../i18n/payments';

const { default: Page } = await import('./page');
const TRAN = 'VSP0123456789abcdef0123456789';
const BENGALI = /[ঀ-৿]/;
const GO = paymentsCatalog.bn['payments.paymentsResultPage.goToWorkspace'];

async function render(locale: 'en' | 'bn', params: Record<string, string>) {
  current.locale = locale;
  current.holder = null;
  return new JSDOM(renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) })))
    .window.document;
}

beforeEach(() => {
  mocks.view.mockReset();
  mocks.signed.mockReset();
});
afterEach(() => {
  current.locale = 'en';
});

describe('the payment result page under Bengali', () => {
  it.each(['received', 'confirming', 'not_completed', 'needs_check'])(
    'state %s: the workspace button is Bengali and every payment sentence stays English',
    async (state) => {
      mocks.signed.mockReturnValue(true);
      mocks.view.mockResolvedValue({
        state,
        invoiceRef: 'INV-100',
        amountMinorUnits: 125050,
        currency: 'BDT',
      });
      const params = { t: TRAN, x: '9999999999', s: 'sig' };
      const bn = await render('bn', params);
      const en = await render('en', params);
      expect(en.body.textContent).not.toMatch(BENGALI);
      // The heading, amounts and invoice line are payment wording: identical to English.
      expect(bn.querySelector('h1')?.textContent).toBe(en.querySelector('h1')?.textContent);
      expect(bn.body.textContent).toContain('Invoice INV-100');
      expect(bn.querySelector('a[href="/app"]')?.textContent).toBe(GO);
    },
  );

  it('the unavailable state keeps its English message', async () => {
    mocks.signed.mockReturnValue(false);
    const bn = await render('bn', { t: TRAN });
    expect(bn.querySelector('h1')?.textContent).toBe('This Payment Link Is No Longer Available');
  });
});

describe('live Bengali keys of the payment result page', () => {
  it('live N, rendered N', async () => {
    mocks.signed.mockReturnValue(true);
    mocks.view.mockResolvedValue({
      state: 'received',
      invoiceRef: 'I',
      amountMinorUnits: 1,
      currency: 'BDT',
    });
    const bn = await render('bn', { t: TRAN, x: '9999999999', s: 'sig' });
    const live = Object.values(paymentsCatalog.bn);
    expect(live.filter((v) => !(bn.body.textContent ?? '').includes(v))).toEqual([]);
  });
});

describe('the payment result page, language of parts', () => {
  it('marks the Bengali on an English page lang="bn"', async () => {
    mocks.signed.mockReturnValue(true);
    mocks.view.mockResolvedValue({
      state: 'received',
      invoiceRef: 'INV-100',
      amountMinorUnits: 125050,
      currency: 'BDT',
    });
    const doc = await render('bn', { t: TRAN, x: '9999999999', s: 'sig' });
    const r = bengaliMarking(doc.body.innerHTML);
    expect(r.unmarked).toEqual([]);
    expect(r.marked).toBeGreaterThan(0);
  });
});
