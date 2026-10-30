// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({ request: vi.fn(), manual: vi.fn() }));
vi.mock('./refund-actions', () => ({
  requestRefundAction: (...args: unknown[]) => actions.request(...args),
  recordManualRefundAction: (...args: unknown[]) => actions.manual(...args),
  applyCreditAction: async () => ({ ok: true, message: '' }),
  cancelRefundAction: async () => ({ ok: true, message: '' }),
  checkRefundsAction: async () => ({ ok: true, message: '' }),
  confirmUnsentRefundAction: async () => ({ ok: true, message: '' }),
  retryRefundAction: async () => ({ ok: true, message: '' }),
}));

const { RefundFeedback } = await import('./refund-feedback');
const { ManualRefundForm, RefundForm } = await import('./refund-forms');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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

const line = (
  <li id="refund-line-r1" tabIndex={-1}>
    INV-1
  </li>
);

describe('the card-level result of the refund forms (S18)', () => {
  it('says a full-amount refund was not confirmed, and moves to its line, after the row with the form is gone', async () => {
    const message = 'We could not confirm the refund was sent.';
    actions.request.mockResolvedValue({
      ok: false,
      message,
      focusId: 'refund-line-r1',
      nextKey: 'k2',
    });
    await act(async () =>
      root.render(
        <RefundFeedback>
          <RefundForm
            organizationId="o1"
            source={{ kind: 'entry', id: 'e1' }}
            currency="BDT"
            limitText="BDT 1,500.00"
          />
          <ul>{line}</ul>
        </RefundFeedback>,
      ),
    );
    await submit();
    // The page drawn again: the payment can give nothing more, so its row and form are gone.
    await act(async () =>
      root.render(
        <RefundFeedback>
          <ul>{line}</ul>
        </RefundFeedback>,
      ),
    );
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector('output')?.textContent).toBe(message);
    expect(document.activeElement?.id).toBe('refund-line-r1');
  });

  it('says a held payment refunded in full was recorded, after its row is gone', async () => {
    actions.manual.mockResolvedValue({
      ok: true,
      message: 'Refund of BDT 1500.00 recorded. The invoice now shows it.',
      focusId: 'refund-line-r1',
      nextKey: 'k2',
    });
    await act(async () =>
      root.render(
        <RefundFeedback>
          <ManualRefundForm
            organizationId="o1"
            source={{ kind: 'held', id: 'h1' }}
            currency="BDT"
            limitText="BDT 1,500.00"
            earliestDate="2026-10-01"
            latestDate="2026-10-30"
          />
          <ul>{line}</ul>
        </RefundFeedback>,
      ),
    );
    await submit();
    await act(async () =>
      root.render(
        <RefundFeedback>
          <ul>{line}</ul>
        </RefundFeedback>,
      ),
    );
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector('output')?.textContent).toContain('recorded');
    expect(document.activeElement?.id).toBe('refund-line-r1');
  });
});
