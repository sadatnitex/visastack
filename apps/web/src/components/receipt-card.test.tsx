// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptCard, receiptTime } from './receipt-card';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const AT = '2026-11-10T08:05:00Z';

describe('receiptTime', () => {
  it('names the time in the person’s own zone, with the zone shown', () => {
    expect(receiptTime(AT, 'Asia/Dhaka')).toMatch(/10 Nov 2026.*2:05\s?pm/i);
    expect(receiptTime(AT, 'Asia/Dhaka')).toMatch(/GMT\+6/);
    expect(receiptTime(AT, 'America/New_York')).toMatch(/3:05\s?am/i);
  });
  it('falls back to the device zone for an unknown zone, and to nothing for a bad date', () => {
    expect(receiptTime(AT, 'Not/AZone')).toMatch(/2026/);
    expect(receiptTime('nonsense')).toBe('');
  });
});

describe('ReceiptCard', () => {
  const render = (extra: Partial<Parameters<typeof ReceiptCard>[0]> = {}) =>
    act(async () =>
      root.render(
        <ReceiptCard
          title="Document Saved"
          what="Passport is saved in your documents."
          at={AT}
          timeZone="Asia/Dhaka"
          next={{ label: 'View Your Documents', href: '/app/applicant/a-1/documents' }}
          onDone={() => undefined}
          {...extra}
        />,
      ),
    );

  it('says what happened, when, and offers the next step and Done, in the green tone', async () => {
    await render();
    const card = host.querySelector('.receipt-card') as HTMLElement;
    expect(card.getAttribute('data-tone')).toBe('green');
    expect(card.querySelector('h3')?.textContent).toBe('Document Saved');
    expect(card.textContent).toContain('Passport is saved in your documents.');
    expect(card.querySelector('time')?.textContent).toMatch(/10 Nov 2026.*2:05\s?pm.*GMT\+6/i);
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/app/applicant/a-1/documents');
    const buttons = Array.from(card.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Done');
  });

  it('shows who it went to, a reference only when one exists, and the honest line only when given', async () => {
    await render();
    expect(host.textContent).not.toContain('Reference');
    expect(host.textContent).not.toContain('Not yet reviewed');
    await render({
      to: 'them@example.com',
      reference: { code: 'R-7K2Q9M' },
      honestLine: 'Received, not yet reviewed.',
    });
    expect(host.textContent).toContain('them@example.com');
    expect(host.textContent).toContain('R-7K2Q9M');
    expect(host.querySelector('button[aria-label="Copy Reference R-7K2Q9M"]')).not.toBeNull();
    expect(host.querySelector('.receipt-honest')?.textContent).toBe('Received, not yet reviewed.');
  });

  it('moves focus to its heading when it appears, and Done closes it and hands focus back', async () => {
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
      run();
      return 1;
    });
    const origin = document.createElement('button');
    origin.textContent = 'Start';
    document.body.append(origin);
    let closed = false;
    await render({
      onDone: () => {
        closed = true;
      },
      returnFocusTo: () => origin,
    });
    expect(document.activeElement).toBe(host.querySelector('h3'));
    const done = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Done');
    await act(async () => done?.click());
    expect(closed).toBe(true);
    expect(document.activeElement).toBe(origin);
    origin.remove();
  });

  it('does not take focus from a field the person is typing in', async () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    await render();
    expect(document.activeElement).toBe(field);
    field.remove();
  });
});
