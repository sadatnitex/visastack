// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({ submitClaim: vi.fn() }));
vi.mock('./actions', () => ({
  startPaymentAction: async () => ({ ok: true, message: '' }),
  checkPaymentAction: async () => ({ ok: true, message: '' }),
  submitClaimAction: (...args: unknown[]) => actions.submitClaim(...args),
}));

const { ClaimForm } = await import('./invoice-forms');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const field = <T extends Element>(name: string): T => {
  const found = container.querySelector<T>(`[name="${name}"]`);
  if (!found) throw new Error(`No field named ${name}`);
  return found;
};

async function submit() {
  const button = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) throw new Error('No submit button');
  (button.form as HTMLFormElement).noValidate = true;
  await act(async () => {
    button.click();
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  });
}

const render = () =>
  act(async () =>
    root.render(
      <ClaimForm
        organizationId="o1"
        invoiceId="i1"
        currency="BDT"
        balance="1250.50"
        latestDate="2026-10-28"
      />,
    ),
  );

describe('the report form after the server refuses a report', () => {
  it('keeps what the person typed, marks the field at fault and opens the form', async () => {
    const typed = {
      method: 'BKASH',
      reference: 'TRX-9',
      amount: '99999',
      paidOn: '2026-10-25',
      note: 'paid by our accountant',
    };
    actions.submitClaim.mockResolvedValue({
      ok: false,
      message: 'The amount is more than the BDT 1250.50 still owed on this invoice.',
      field: 'amount',
      values: typed,
    });
    await render();
    field<HTMLSelectElement>('method').value = typed.method;
    field<HTMLInputElement>('reference').value = typed.reference;
    field<HTMLInputElement>('amount').value = typed.amount;
    field<HTMLInputElement>('paidOn').value = typed.paidOn;
    field<HTMLTextAreaElement>('note').value = typed.note;

    await submit();

    expect(field<HTMLSelectElement>('method').value).toBe('BKASH');
    expect(field<HTMLInputElement>('reference').value).toBe('TRX-9');
    expect(field<HTMLInputElement>('amount').value).toBe('99999');
    expect(field<HTMLInputElement>('paidOn').value).toBe('2026-10-25');
    expect(field<HTMLTextAreaElement>('note').value).toBe('paid by our accountant');
    expect(field<HTMLInputElement>('amount').getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/still owed/);
  });

  it('starts from the balance the first time', async () => {
    await render();
    expect(field<HTMLInputElement>('amount').value).toBe('1250.50');
    expect(field<HTMLInputElement>('reference').value).toBe('');
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('reads each hint with its field, and shows a refusal beside the field it is about', async () => {
    actions.submitClaim.mockResolvedValue({
      ok: false,
      message: 'Enter the payment reference.',
      field: 'reference',
      values: { method: 'BKASH', reference: '', amount: '10', paidOn: '2026-10-25', note: '' },
    });
    await render();
    const hintOf = (name: string) =>
      (field(name).getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => container.ownerDocument.getElementById(id)?.textContent ?? '');
    expect(hintOf('reference').join(' ')).toMatch(/transaction id/);
    expect(hintOf('proof').join(' ')).toMatch(/under 4 MB/);

    await submit();

    const reference = field<HTMLInputElement>('reference');
    expect(hintOf('reference').join(' ')).toMatch(/transaction id/);
    expect(hintOf('reference').join(' ')).toMatch(/Enter the payment reference/);
    const beside = reference.parentElement?.querySelector('.field-msg-err');
    expect(beside?.textContent).toBe('Enter the payment reference.');
    expect(beside?.getAttribute('aria-hidden')).toBe('true');
    // Only the field the refusal is about carries it.
    expect(field('amount').parentElement?.querySelector('.field-msg-err')).toBeNull();
  });
});
