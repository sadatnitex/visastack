// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { HeroExample } from './hero-example';

async function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<HeroExample />);
  });
  const button = (text: string) =>
    Array.from(host.querySelectorAll('button')).find((b) => b.textContent === text);
  return { host, button };
}

describe('the home page example cards', () => {
  it('shows the suggestion and the share as an example, with working buttons', async () => {
    const { host, button } = await mount();
    expect(host.textContent).toContain('Passport number X1234567');
    expect(host.textContent).toContain('3 items, until 30 Nov');
    expect(button('Approve')?.getAttribute('type')).toBe('button');
    expect(button('Start again')).toBeUndefined();
  });

  it('approving, rejecting and stopping each say what happened, and Start again resets', async () => {
    const { host, button } = await mount();
    await act(async () => button('Approve')?.click());
    expect(host.textContent).toContain('Added to the example profile.');
    expect(button('Approve')).toBeUndefined();
    await act(async () => button('Stop sharing')?.click());
    expect(host.textContent).toContain('Sharing stopped.');
    await act(async () => button('Start again')?.click());
    expect(host.textContent).toContain('3 items, until 30 Nov');
    expect(button('Reject')).toBeDefined();
    await act(async () => button('Reject')?.click());
    expect(host.textContent).toContain('Left out. You can still type it yourself.');
  });

  it('keeps each button a plain button so nothing is submitted or saved', async () => {
    const { host } = await mount();
    for (const b of host.querySelectorAll('button')) expect(b.getAttribute('type')).toBe('button');
    expect(host.querySelector('form')).toBeNull();
  });
});
