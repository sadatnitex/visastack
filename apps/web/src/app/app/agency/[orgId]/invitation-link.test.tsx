// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvitationLink } from './invitation-link';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const url =
  'https://app.example.test/invitation?kind=team&token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<InvitationLink url={url} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.textContent === text,
  );
  if (!button) throw new Error('Missing link action');
  await act(async () => button.click());
}
describe('private invitation link sharing', () => {
  it('copies the exact link and announces success only after clipboard approval', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await click('Copy Link');
    expect(writeText).toHaveBeenCalledWith(url);
    expect(container.querySelector('output')?.textContent).toContain('Link copied');
  });
  it('selects the link for manual copy when clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
      configurable: true,
    });
    await click('Copy Link');
    const field = container.querySelector('input');
    expect(document.activeElement).toBe(field);
    expect(field?.selectionEnd).toBe(url.length);
    expect(container.querySelector('output')?.textContent).not.toContain('Link copied');
  });
  it('offers the exact invitation to the native share sheet without opening another service automatically', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    await click('Share Link');
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url, title: 'VisaStack Invitation' }),
    );
  });
});
