// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const answer = vi.hoisted(() => ({
  next: { ok: true, message: 'Shared. They see only what you chose.' } as {
    ok: boolean;
    message: string;
    invitationUrl?: string;
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ createGrantAction: async () => answer.next }));
const { GrantForm } = await import('./grant-form');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
    run();
    return 1;
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <GrantForm
        applicantId="owned-person"
        documents={[{ id: 'passport', displayName: 'Passport summary' }]}
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function type(name: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) throw new Error('Missing field');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((node) => node.textContent === label);

async function send() {
  type('recipientEmail', 'sara@example.com');
  type('purpose', 'Visa review');
  await act(async () => button('Review and Confirm')?.click());
  await act(async () => {
    container.querySelector('form')?.requestSubmit();
  });
}

describe('the receipt after a sharing request (F2)', () => {
  it('is not there before anything is sent', () => {
    expect(container.querySelector('.receipt-card')).toBeNull();
  });

  it('names who it went to and when, and says plainly that nothing is shared until they accept', async () => {
    await send();
    const card = container.querySelector('.receipt-card') as HTMLElement;
    expect(card.querySelector('h3')?.textContent).toBe('Sharing Request Created');
    expect(card.textContent).toContain('sara@example.com');
    expect(card.querySelector('time')).not.toBeNull();
    expect(card.textContent).toContain('Not shared yet. They see nothing until they accept.');
    expect(card.querySelector('a')?.getAttribute('href')).toBe(
      '/app/applicant/owned-person/sharing#who-has-access',
    );
    expect(document.activeElement).toBe(card.querySelector('h3'));
  });

  it('is an invitation receipt, with the link kept, when the person has no account yet', async () => {
    answer.next = {
      ok: true,
      message: 'Invitation emailed.',
      invitationUrl: 'https://example.test/invitation?kind=sharing&token=x',
    };
    await send();
    const card = container.querySelector('.receipt-card') as HTMLElement;
    expect(card.querySelector('h3')?.textContent).toBe('Invitation Created');
    expect(container.textContent).toContain('Private Invitation Link');
    const values = [...container.querySelectorAll('input')].map((input) => input.value);
    expect(values).toContain('https://example.test/invitation?kind=sharing&token=x');
  });

  it('Done closes the receipt and puts focus back on the first field', async () => {
    answer.next = { ok: true, message: 'Shared. They see only what you chose.' };
    await send();
    const done = container.querySelector('.receipt-card .btn-secondary') as HTMLButtonElement;
    await act(async () => done.click());
    expect(container.querySelector('.receipt-card')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('#recipientEmail'));
  });

  it('gives no receipt when the request was refused', async () => {
    answer.next = { ok: false, message: 'That person cannot be invited.' };
    await send();
    expect(container.querySelector('.receipt-card')).toBeNull();
  });
});
