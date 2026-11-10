// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DepthScope } from './depth';
import { DepthSwitch, type DepthSwitchCopy } from './depth-switch';
import { DocumentWalletBrowser, type WalletBrowserDocument } from './document-wallet-browser';

/** The documents page at Glance: the list is on screen at Glance (Owner, 5 Nov 2026: plain pages); only search and categories are Browse. */

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

describe('the documents list on a page with the depth switch', () => {
  it('is on screen at Glance, with the four numbers and the search; only the Filters button waits for Browse', async () => {
    await act(async () => {
      root.render(
        <DepthScope family="record" depth="glance">
          <DepthSwitch family="record" initial="glance" copy={copy} />
          <DocumentWalletBrowser applicantId="p" documents={records} />
        </DepthScope>,
      );
    });
    // The list and its filters carry no level, so Glance shows them.
    expect(container.querySelector('.document-wallet-layout')?.hasAttribute('data-level')).toBe(
      false,
    );
    expect(container.querySelector('.document-wallet-list')?.hasAttribute('data-level')).toBe(
      false,
    );
    expect(container.querySelector('.wallet-overview-strip')?.hasAttribute('data-level')).toBe(
      false,
    );
    // The search is always in view (owner, 10 Nov 2026); the filters behind it wait for Browse.
    expect(container.querySelector('.lp-filter-bar-wrap')?.hasAttribute('data-level')).toBe(false);
    expect(container.querySelector('input[type="search"]')).not.toBeNull();
    expect(container.querySelector('.lp-filters-toggle')?.getAttribute('data-level')).toBe(
      'browse',
    );
    expect(container.querySelector('.lp-filters-panel')?.getAttribute('data-level')).toBe('browse');
  });

  it('filters the list with a tile and leaves the chosen level alone', async () => {
    await act(async () => {
      root.render(
        <DepthScope family="record" depth="glance">
          <DepthSwitch family="record" initial="glance" copy={copy} />
          <DocumentWalletBrowser applicantId="p" documents={records} />
        </DepthScope>,
      );
    });
    await act(async () => {
      button('Needs Review').click();
    });
    expect(scope().getAttribute('data-depth')).toBe('glance');
    expect(button('Glance').getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves a deeper level alone', async () => {
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
