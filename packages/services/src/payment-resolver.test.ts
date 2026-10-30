import { describe, expect, it } from 'vitest';
import { onlineCurrencyRefusal, paymentPortResolver } from './payment-resolver';
import { FakePaymentPort } from './payments.test-support';

describe('the payment port resolver (S19 step 0)', () => {
  it('gives each currency to the earliest configured provider that takes it', () => {
    const first = new FakePaymentPort('firstpay');
    const second = new FakePaymentPort('secondpay');
    const ports = paymentPortResolver([
      { port: first, currencies: ['BDT'] },
      { port: second, currencies: ['bdt', 'USD'] },
    ]);
    expect(ports.configured()).toEqual([first, second]);
    expect(ports.forCurrency('BDT')).toBe(first);
    expect(ports.forCurrency(' usd ')).toBe(second);
    expect(ports.forCurrency('EUR')).toBeNull();
    expect(ports.forProvider('secondpay')).toBe(second);
    expect(ports.forProvider('nobody')).toBeNull();
    expect(ports.forProvider(null)).toBeNull();
  });

  it('leaves out a port that is not configured, has no mode, or repeats a provider', () => {
    const live = new FakePaymentPort('livepay');
    const off = { ...new FakePaymentPort('offpay'), configured: false };
    const noMode = Object.assign(new FakePaymentPort('nomodepay'), { mode: null });
    const repeat = new FakePaymentPort('livepay');
    const ports = paymentPortResolver([
      { port: off as unknown as FakePaymentPort, currencies: ['USD'] },
      { port: noMode as unknown as FakePaymentPort, currencies: ['USD'] },
      { port: live, currencies: ['BDT'] },
      { port: repeat, currencies: ['USD'] },
    ]);
    expect(ports.configured()).toEqual([live]);
    expect(ports.forCurrency('USD')).toBeNull();
    expect(ports.forProvider('offpay')).toBeNull();
    expect(ports.forProvider('nomodepay')).toBeNull();
    expect(ports.currencyRefusal).toBe('Only invoices in Bangladeshi taka can be paid online.');
    expect(paymentPortResolver([]).configured()).toEqual([]);
  });

  it('names the currencies that can be paid online in one plain sentence', () => {
    expect(onlineCurrencyRefusal(['BDT'])).toBe(
      'Only invoices in Bangladeshi taka can be paid online.',
    );
    expect(onlineCurrencyRefusal(['BDT', 'usd', 'BDT'])).toBe(
      'Only invoices in Bangladeshi taka or US dollars can be paid online.',
    );
    expect(onlineCurrencyRefusal(['BDT', 'USD', 'SGD'])).toBe(
      'Only invoices in Bangladeshi taka, US dollars or SGD can be paid online.',
    );
    expect(onlineCurrencyRefusal(['constructor'])).toBe(
      'Only invoices in CONSTRUCTOR can be paid online.',
    );
    expect(onlineCurrencyRefusal([])).toBe(
      'Online payment is not available yet. Please try again later.',
    );
  });
});
