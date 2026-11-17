// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentWalletBrowser, type WalletBrowserDocument } from './document-wallet-browser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const records: WalletBrowserDocument[] = [
  {
    id: 'doc-1',
    name: 'Passport scan',
    kind: 'Passport',
    category: 'Identity',
    version: 1,
    updatedAt: '2026-10-11T00:00:00Z',
    ready: false,
    needsReview: true,
    expiring: false,
    safetyLabel: 'Clean',
    processingLabel: 'Approved',
    previewAllowed: true,
    details: <span>Details</span>,
  },
];

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(document, 'startViewTransition');
});

const pick = (text: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement;

describe('Stack and List switch', () => {
  it('swaps inside a view transition when the browser has them', async () => {
    const start = vi.fn((update: () => void) => update());
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = start;
    await act(async () =>
      root.render(<DocumentWalletBrowser applicantId="p" documents={records} />),
    );
    await act(async () => pick('Stack').click());
    expect(start).toHaveBeenCalledTimes(1);
    expect(pick('Stack').getAttribute('aria-pressed')).toBe('true');
  });
  it('swaps instantly when the browser has none', async () => {
    await act(async () =>
      root.render(<DocumentWalletBrowser applicantId="p" documents={records} />),
    );
    await act(async () => pick('Stack').click());
    expect(pick('Stack').getAttribute('aria-pressed')).toBe('true');
  });
});
