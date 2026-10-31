// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('./actions', () => ({
  recordTravellerRefundAction: (...args: unknown[]) => actions.record(...args),
}));

const { RefundFeedback } = await import('../../organizations/[orgId]/refund-feedback');
const { TravellerRefundForm } = await import('./forms');

const ENTRY = '0f8b6c1e-2d3a-4b5c-8d6e-7f8091a2b3c4';

let container: HTMLDivElement;
let root: Root;
let confirm: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  confirm = vi.fn(() => true);
  window.confirm = confirm as unknown as typeof window.confirm;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function submit() {
  const button = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) throw new Error('No submit button');
  (button.form as HTMLFormElement).noValidate = true;
  await act(async () => {
    button.click();
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  });
}

function hidden(name: string): string {
  return (
    container.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value ?? ''
  );
}

function draw(overrides: { outsideWindow?: boolean; testPayment?: boolean } = {}) {
  return act(async () =>
    root.render(
      <RefundFeedback>
        <TravellerRefundForm
          formId="traveller-refund-A-payment-0"
          source={{ kind: 'entry', id: ENTRY }}
          invoiceRef="TP-9D1E2F3A-2"
          amountMinorUnits={150000}
          amountText="BDT 1,500.00"
          earliestDate="2026-10-28"
          latestDate="2026-10-31"
          outsideWindow={overrides.outsideWindow ?? false}
          testPayment={overrides.testPayment ?? false}
        />
      </RefundFeedback>,
    ),
  );
}

describe('the Record Refund form of Traveller Billing (ADR 0025 T6b)', () => {
  it('asks first, naming the amount and purchase, and records nothing when the owner says no', async () => {
    confirm.mockReturnValue(false);
    await draw();
    await submit();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toBe(
      'Record a refund of BDT 1,500.00 for TP-9D1E2F3A-2? This cannot be undone.',
    );
    expect(actions.record).not.toHaveBeenCalled();
  });

  it('says in the question when the payment is past the 7 days, and when it is a test payment', async () => {
    confirm.mockReturnValue(false);
    await draw({ outsideWindow: true, testPayment: true });
    await submit();
    expect(confirm.mock.calls[0]?.[0]).toBe(
      'Record a refund of BDT 1,500.00 for TP-9D1E2F3A-2? This is a test payment. This payment is more than 7 days old. Record the refund only if it was made in the gateway panel. This cannot be undone.',
    );
  });

  it('sends the shown amount and its own key once confirmed, then takes a fresh key and says the result', async () => {
    actions.record.mockResolvedValue({
      ok: true,
      message: 'Refund recorded: BDT 1,500.00 for TP-9D1E2F3A-2.',
      values: {},
      nextKey: '7a7a7a7a-0000-4000-8000-000000000001',
    });
    await draw();
    const firstKey = hidden('idempotencyKey');
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(container.querySelector<HTMLInputElement>('input[name="refundedOn"]')?.value).toBe(
      '2026-10-31',
    );
    await submit();
    expect(actions.record).toHaveBeenCalledTimes(1);
    const sent = actions.record.mock.calls[0]?.[1] as FormData;
    expect(sent.get('sourceKind')).toBe('entry');
    expect(sent.get('sourceId')).toBe(ENTRY);
    expect(sent.get('expectedAmountMinorUnits')).toBe('150000');
    expect(sent.get('invoiceRef')).toBe('TP-9D1E2F3A-2');
    expect(sent.get('idempotencyKey')).toBe(firstKey);
    expect(sent.get('amount')).toBeNull();
    expect(hidden('idempotencyKey')).toBe('7a7a7a7a-0000-4000-8000-000000000001');
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    const region = container.querySelector('output');
    expect(region?.textContent).toBe('Refund recorded: BDT 1,500.00 for TP-9D1E2F3A-2.');
    expect(document.activeElement).toBe(region);
  });

  it('keeps a refusal with the form and points at the field at fault', async () => {
    actions.record.mockResolvedValue({
      ok: false,
      message: 'That refund reference is already recorded for another refund.',
      field: 'reference',
      values: { reference: 'GW-1', refundedOn: '2026-10-30', reason: 'Asked' },
      nextKey: '7a7a7a7a-0000-4000-8000-000000000002',
    });
    await draw();
    await submit();
    const reference = container.querySelector<HTMLInputElement>('input[name="reference"]');
    expect(reference?.getAttribute('aria-invalid')).toBe('true');
    expect(reference?.value).toBe('GW-1');
    expect(container.querySelector<HTMLInputElement>('input[name="refundedOn"]')?.value).toBe(
      '2026-10-30',
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'already recorded for another refund',
    );
    expect(hidden('idempotencyKey')).toBe('7a7a7a7a-0000-4000-8000-000000000002');
  });
});
