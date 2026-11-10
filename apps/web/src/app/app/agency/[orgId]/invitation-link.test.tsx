// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareOriginsProvider } from '../../../../components/share/share-origins';
import { InvitationLink } from './invitation-link';

const withOrigin = (element: React.ReactNode) => (
  <ShareOriginsProvider origin="https://vs.obsidianglobal.studio">{element}</ShareOriginsProvider>
);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const url =
  'https://vs.obsidianglobal.studio/invitation?kind=team&token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(withOrigin(<InvitationLink url={url} purpose="team" />)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'share');
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
    expect([...container.querySelectorAll('output')].at(-1)?.textContent).toContain('Link copied');
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
    expect([...container.querySelectorAll('output')].at(-1)?.textContent).not.toContain(
      'Link copied',
    );
  });
  it('offers the exact invitation to the native share sheet without opening another service automatically', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    // A phone's share sheet is known when the page opens, so mount afresh.
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(withOrigin(<InvitationLink url={url} purpose="team" />)));
    await click('More Ways to Send');
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'VisaStack Invitation',
        text: expect.stringContaining(url),
      }),
    );
  });

  it('puts Send on WhatsApp first, before Copy Link, with the invitation for who it is for', () => {
    const first = container.querySelector('.action-row a, .action-row button');
    expect(first?.textContent).toContain('Send on WhatsApp');
    const href = container.querySelector<HTMLAnchorElement>('a.wa-share-send')?.href ?? '';
    const sent = decodeURIComponent(href.split('?text=')[1] ?? '');
    expect(sent).toContain('invited you to join its team');
    expect(sent).toContain(url);
    expect([...container.querySelectorAll('button')].map((node) => node.textContent)).toContain(
      'Copy Link',
    );
  });

  it("offers only Copy Link for a link that is not VisaStack's own", () => {
    act(() =>
      root.render(
        <InvitationLink url="https://elsewhere.example.com/invitation?token=abc" purpose="team" />,
      ),
    );
    expect(container.querySelector('a.wa-share-send')).toBeNull();
    expect([...container.querySelectorAll('button')].map((node) => node.textContent)).toEqual([
      'Copy Link',
    ]);
  });
});
