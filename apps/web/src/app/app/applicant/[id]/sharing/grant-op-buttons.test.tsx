// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ updateGrantAction: vi.fn() }));

const { GrantOpButtons } = await import('./grant-op-buttons');

describe('GrantOpButtons', () => {
  it('asks inside the page before revoking and never opens a browser pop-up', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const confirmSpy = vi.spyOn(window, 'confirm');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <GrantOpButtons
          applicantId="a-1"
          grantId="g-1"
          ops={[
            { op: 'pause', label: 'Pause', variant: 'btn-secondary' },
            { op: 'revoke', label: 'Revoke', variant: 'btn-danger' },
          ]}
        />,
      );
    });
    const find = (text: string) =>
      Array.from(host.querySelectorAll('button')).find((b) => b.textContent === text);

    expect(find('Yes, Revoke Access')).toBeUndefined();
    await act(async () => {
      find('Revoke')?.click();
    });
    expect(host.textContent).toContain('The recipient will lose it on their next request.');
    const yes = find('Yes, Revoke Access');
    expect(yes?.getAttribute('type')).toBe('submit');
    expect(host.querySelector('input[name="op"][value="revoke"]')).not.toBeNull();

    await act(async () => {
      find('Keep Access')?.click();
    });
    expect(find('Yes, Revoke Access')).toBeUndefined();
    expect(find('Revoke')).toBeDefined();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
