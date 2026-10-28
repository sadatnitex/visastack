// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DepthScope } from './depth';
import { DepthSwitch, type DepthSwitchCopy } from './depth-switch';
import { DocumentWalletBrowser, type WalletBrowserDocument } from './document-wallet-browser';

/** The documents page at Glance: the list sits at Browse, so a filter tile opens it (CCD-3). */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const copy: DepthSwitchCopy = {
  group: 'How much to show',
  levels: { glance: 'Glance', browse: 'Browse', everything: 'Everything' },
  summaries: { glance: 'g', browse: 'b', everything: 'e' },
  status: 'Showing {level}',
};
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
});

const scope = () => container.querySelector('[data-depth-scope]') as HTMLElement;
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith(text),
  ) as HTMLButtonElement;

describe('filter tiles on a page with the depth switch', () => {
  it('open the list when the page is at Glance, and the switch follows', async () => {
    await act(async () => {
      root.render(
        <DepthScope family="record" depth="glance">
          <DepthSwitch family="record" initial="glance" copy={copy} />
          <DocumentWalletBrowser applicantId="p" documents={records} />
        </DepthScope>,
      );
    });
    expect(container.querySelector('.document-wallet-layout')?.getAttribute('data-level')).toBe(
      'browse',
    );
    await act(async () => {
      button('Needs Review').click();
    });
    expect(scope().getAttribute('data-depth')).toBe('browse');
    expect(button('Browse').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('output')?.textContent).toBe('Showing Browse');
  });

  it('leave a deeper level alone', async () => {
    await act(async () => {
      root.render(
        <DepthScope family="record" depth="everything">
          <DocumentWalletBrowser applicantId="p" documents={records} />
        </DepthScope>,
      );
    });
    await act(async () => {
      button('Needs Review').click();
    });
    expect(scope().getAttribute('data-depth')).toBe('everything');
  });
});
