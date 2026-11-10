// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const setDocumentExpiryAction = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ setDocumentExpiryAction }));

const { DocumentExpiryForm } = await import('./document-expiry-form');

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  setDocumentExpiryAction.mockReset();
});

type Props = Partial<Parameters<typeof DocumentExpiryForm>[0]>;
const BASE = {
  applicantId: 'a-1',
  documentId: 'd-1',
  origin: 'NONE' as const,
  typedOn: null,
  mismatch: false,
  savedLabel: null,
  typedLabel: null,
};

async function mount(props: Props = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<DocumentExpiryForm {...BASE} {...props} />);
  });
  const input = host.querySelector('input[name="expiresOn"]') as HTMLInputElement;
  const form = host.querySelector('form') as HTMLFormElement;
  return { host, input, form };
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const buttons = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].map((button) => button.textContent);

describe('setting an expiry date on a document', () => {
  it('offers Set Expiry Date with a date box and no Clear button while nothing is typed', async () => {
    const { host, input } = await mount();
    expect(input.type).toBe('date');
    expect(input.hasAttribute('max')).toBe(false);
    expect(buttons(host)).toEqual(['Set Expiry Date']);
    expect(host.textContent).toContain('No expiry date yet.');
  });

  it('labels a typed date as entered by the person and a read date as read from the document', async () => {
    const typed = await mount({
      origin: 'TYPED',
      typedOn: '2031-04-30',
      savedLabel: '30 Apr 2031',
      typedLabel: '30 Apr 2031',
    });
    expect(typed.host.textContent).toContain('30 Apr 2031, entered by you.');
    expect(typed.host.textContent).not.toContain('read from the document');
    expect(typed.input.value).toBe('2031-04-30');
    expect(buttons(typed.host)).toEqual(['Update Expiry Date', 'Clear My Date']);
    act(() => root?.unmount());
    document.body.innerHTML = '';

    const read = await mount({ origin: 'READ', savedLabel: '30 Apr 2030' });
    expect(read.host.textContent).toContain('30 Apr 2030, read from the document.');
    expect(read.host.textContent).not.toContain('entered by you');
  });

  it('shows both dates and asks the person to check when they differ', async () => {
    const { host } = await mount({
      origin: 'READ',
      typedOn: '2031-04-30',
      mismatch: true,
      savedLabel: '30 Apr 2030',
      typedLabel: '30 Apr 2031',
    });
    expect(host.textContent).toContain(
      'You entered 30 Apr 2031. The document says 30 Apr 2030. Check which is right.',
    );
  });

  it('sends the date, keeps it in the box when refused, and moves focus to the box', async () => {
    setDocumentExpiryAction.mockResolvedValue({
      ok: false,
      message: 'Enter a real date, such as 2031-04-30.',
      field: 'expiresOn',
    });
    const { host, input, form } = await mount();
    await act(async () => type(input, '2031-04-30'));
    await act(async () => form.requestSubmit());
    const sent = setDocumentExpiryAction.mock.calls[0]?.[1] as FormData;
    expect(sent.get('expiresOn')).toBe('2031-04-30');
    expect(sent.get('documentId')).toBe('d-1');
    expect(input.value).toBe('2031-04-30');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(host.textContent).toContain('Enter a real date');
  });

  it('asks once about a date that has passed, then sends the confirmation with Save Anyway', async () => {
    setDocumentExpiryAction.mockResolvedValueOnce({
      ok: false,
      message:
        'This date has passed. This document will count as expired for your cases. Save anyway?',
      field: 'expiresOn',
      confirmPastDate: '2024-01-01',
    });
    const { host, input, form } = await mount();
    await act(async () => type(input, '2024-01-01'));
    await act(async () => form.requestSubmit());
    expect(host.textContent).toContain('This date has passed.');
    expect(buttons(host)).toEqual(['Save Anyway']);
    expect(host.querySelector('input[name="confirmPastDate"]')).not.toBeNull();

    setDocumentExpiryAction.mockResolvedValueOnce({ ok: true, message: 'Expiry date saved.' });
    await act(async () => form.requestSubmit());
    const second = setDocumentExpiryAction.mock.calls[1]?.[1] as FormData;
    expect(second.get('confirmPastDate')).toBe('2024-01-01');
    expect(second.get('expiresOn')).toBe('2024-01-01');

    // Changing the date takes the confirmation away: it must be asked again.
    await act(async () => type(input, '2023-06-01'));
    expect(buttons(host)).not.toContain('Save Anyway');
  });

  it('clears the typed date with the Clear My Date button', async () => {
    setDocumentExpiryAction.mockResolvedValue({ ok: true, message: 'Your date is cleared.' });
    const { host, form } = await mount({
      origin: 'TYPED',
      typedOn: '2031-04-30',
      savedLabel: '30 Apr 2031',
      typedLabel: '30 Apr 2031',
    });
    const clear = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Clear My Date',
    );
    await act(async () => {
      form.requestSubmit(clear as HTMLButtonElement);
    });
    const sent = setDocumentExpiryAction.mock.calls[0]?.[1] as FormData;
    expect(sent.get('intent')).toBe('clear');
  });
});
