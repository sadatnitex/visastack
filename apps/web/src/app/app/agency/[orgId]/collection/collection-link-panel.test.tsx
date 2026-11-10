// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareOriginsProvider } from '../../../../../components/share/share-origins';
import { axeViolations } from '../../../../../lib/axe.test-support';
import { CollectionLinkPanel } from './collection-link-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const url = 'https://vs.obsidianglobal.studio/collect/open?token=abcDEF123_-xyzABC456';
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const render = (link = url) =>
  act(() =>
    root.render(
      <ShareOriginsProvider origin="https://vs.obsidianglobal.studio">
        <CollectionLinkPanel url={link} />
      </ShareOriginsProvider>,
    ),
  );

describe('the private request link panel', () => {
  it('offers Send on WhatsApp first, with the link in a plain message, and keeps Copy Link', () => {
    render();
    expect(container.querySelector('.action-row')?.firstElementChild?.textContent).toContain(
      'Send on WhatsApp',
    );
    const href = container.querySelector<HTMLAnchorElement>('a.wa-share-send')?.href ?? '';
    const sent = decodeURIComponent(href.split('?text=')[1] ?? '');
    expect(sent).toBe(
      `Hello, your agency has asked you for documents through VisaStack. Open your private link to get started: ${url}`,
    );
    const buttons = [...container.querySelectorAll('button')].map((node) => node.textContent);
    expect(buttons).toContain('Copy Link');
    expect(buttons).toContain('Copy Message');
  });

  it('copies the bare link with Copy Link and says so only after the clipboard accepts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render();
    const copy = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Copy Link',
    );
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledWith(url);
    expect([...container.querySelectorAll('output')].at(-1)?.textContent).toContain('Link copied');
  });

  it("offers no WhatsApp action for a link that is not VisaStack's own", () => {
    render('https://elsewhere.example.com/collect/open?token=abc');
    expect(container.querySelector('a.wa-share-send')).toBeNull();
  });

  it('says VisaStack cannot see whether the message was sent, and has no accessibility faults', async () => {
    render();
    expect(container.textContent).toContain('VisaStack cannot see whether it was sent');
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });
});
