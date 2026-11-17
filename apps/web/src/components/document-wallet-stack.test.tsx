// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';
import { DocumentWalletBrowser, type WalletBrowserDocument } from './document-wallet-browser';
import {
  DocumentWalletGhostCard,
  DocumentWalletStack,
  type WalletStackItem,
} from './document-wallet-stack';

/** WP-PIC5: the documents as a stack of picture cards. An opt-in view; the list stays the default. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const items: WalletStackItem[] = [
  {
    id: 'p',
    name: 'My Passport',
    docType: 'PASSPORT',
    kindLine: 'Passport',
    state: { label: 'Needs Review', tone: 'warning' },
    selected: false,
  },
  {
    id: 'b',
    name: 'Bank statement',
    docType: 'BANK_STATEMENT',
    kindLine: 'Bank Statement',
    state: null,
    selected: true,
  },
];

describe('the stack of cards', () => {
  it('draws one card per document, each a single button with its name and state word', () => {
    act(() => root.render(<DocumentWalletStack items={items} onOpen={() => undefined} />));
    const cards = [...container.querySelectorAll('li > button.wallet-stack-card')];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('My Passport');
    expect(cards[0]?.textContent).toContain('Needs Review');
    // A normal file shows no state word, exactly like its row today.
    expect(cards[1]?.querySelector('.badge')).toBeNull();
    expect(cards[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(cards[0]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the neutral passport cover without a nationality and the real one for Bangladesh', () => {
    act(() => root.render(<DocumentWalletStack items={items} onOpen={() => undefined} />));
    expect(container.querySelector('[data-picture="passport-neutral"]')).not.toBeNull();
    expect(container.querySelector('[data-picture="passport-bd"]')).toBeNull();
    act(() =>
      root.render(
        <DocumentWalletStack items={items} nationality="Bangladeshi" onOpen={() => undefined} />,
      ),
    );
    expect(container.querySelector('[data-picture="passport-bd"]')).not.toBeNull();
    // Only the passport card gets a cover; the other card shows its own document picture.
    expect(container.querySelectorAll('.pic-cover')).toHaveLength(1);
    expect(container.querySelectorAll('.pic-document, .pic-fallback')).toHaveLength(1);
  });

  it('treats an alias of passport as a passport and keeps the Manage menu under its card', () => {
    const aliased: WalletStackItem[] = [
      {
        id: 'alias',
        name: 'Bio page',
        docType: 'PASSPORT_BIO_PAGE',
        kindLine: 'Passport',
        state: null,
        selected: false,
        manage: <button type="button">Manage</button>,
      },
    ];
    act(() => root.render(<DocumentWalletStack items={aliased} onOpen={() => undefined} />));
    expect(container.querySelector('[data-picture="passport-neutral"]')).not.toBeNull();
    expect(container.querySelector('li > .wallet-document-manage button')?.textContent).toBe(
      'Manage',
    );
    expect(container.querySelector('li[data-selected]')).toBeNull();
  });

  it('keeps the pictures decorative so a screen reader reads the name and state once', () => {
    act(() => root.render(<DocumentWalletStack items={items} onOpen={() => undefined} />));
    for (const picture of container.querySelectorAll('.pic')) {
      expect(picture.getAttribute('aria-hidden')).toBe('true');
      expect(picture.getAttribute('role')).toBeNull();
    }
  });

  it('hands the card to the opener, like a row', () => {
    const onOpen = vi.fn();
    act(() => root.render(<DocumentWalletStack items={items} onOpen={onOpen} />));
    const card = container.querySelectorAll('button.wallet-stack-card')[1] as HTMLButtonElement;
    act(() => card.click());
    expect(onOpen).toHaveBeenCalledWith('b', card);
  });

  it('has no accessibility violations', async () => {
    act(() => root.render(<DocumentWalletStack items={items} onOpen={() => undefined} />));
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });
});

describe('the example card', () => {
  it('is labelled Example, is not a control and never reads as the person own document', () => {
    act(() => root.render(<DocumentWalletGhostCard />));
    const ghost = container.querySelector('[data-testid="wallet-ghost-card"]');
    expect(ghost?.textContent).toContain('Example');
    expect(ghost?.querySelector('button, a, input')).toBeNull();
    expect(ghost?.getAttribute('aria-hidden')).toBeNull();
  });
});

const records: WalletBrowserDocument[] = ['one', 'two', 'three'].map((id, index) => ({
  id: `doc-${id}`,
  name: `File ${id}`,
  kind: 'Passport',
  docType: index === 0 ? 'PASSPORT' : 'BANK_STATEMENT',
  category: 'Identity',
  version: 1,
  updatedAt: '2026-10-11T00:00:00Z',
  ready: index !== 1,
  needsReview: index === 1,
  expiring: false,
  safetyLabel: 'Clean',
  processingLabel: 'Needs Review',
  previewAllowed: true,
  details: <span>{`Details ${id}`}</span>,
}));

describe('the documents browser with the stack view', () => {
  it('starts as the list: the rows and their markup are unchanged', () => {
    act(() => root.render(<DocumentWalletBrowser applicantId="a1" documents={records} />));
    expect(container.querySelectorAll('.wallet-metadata-list li')).toHaveLength(3);
    expect(container.querySelector('.wallet-stack')).toBeNull();
    expect(container.querySelectorAll('button.wallet-document-select')).toHaveLength(3);
  });

  it('switches to the stack and back, keeping the same documents', () => {
    act(() => root.render(<DocumentWalletBrowser applicantId="a1" documents={records} />));
    const stackButton = [...container.querySelectorAll('.wallet-view-switch button')].find(
      (b) => b.textContent === 'Stack',
    ) as HTMLButtonElement;
    expect(stackButton.getAttribute('aria-pressed')).toBe('false');
    act(() => stackButton.click());
    expect(stackButton.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.wallet-metadata-list')).toBeNull();
    expect(container.querySelectorAll('.wallet-stack button.wallet-stack-card')).toHaveLength(3);
    const listButton = [...container.querySelectorAll('.wallet-view-switch button')].find(
      (b) => b.textContent === 'List',
    ) as HTMLButtonElement;
    act(() => listButton.click());
    expect(container.querySelectorAll('.wallet-metadata-list li')).toHaveLength(3);
  });

  it('opens the same document a row opens when a card is tapped', () => {
    act(() => root.render(<DocumentWalletBrowser applicantId="a1" documents={records} />));
    const stackButton = [...container.querySelectorAll('.wallet-view-switch button')].find(
      (b) => b.textContent === 'Stack',
    ) as HTMLButtonElement;
    act(() => stackButton.click());
    const second = container.querySelectorAll('button.wallet-stack-card')[1] as HTMLButtonElement;
    act(() => second.click());
    expect(window.location.search).toContain('document=doc-two');
    expect(container.querySelector('#wallet-selected-document')?.textContent).toContain(
      'Details two',
    );
    expect(second.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the example card, not a view switch, when there are no documents', () => {
    act(() => root.render(<DocumentWalletBrowser applicantId="a1" documents={[]} />));
    expect(container.querySelector('[data-testid="wallet-ghost-card"]')).not.toBeNull();
    expect(container.querySelector('.wallet-view-switch')).toBeNull();
    // The existing empty state with its Add a Document link is still there.
    expect(container.textContent).toContain('Add a Document');
  });

  it('never shows the example card next to real documents', () => {
    act(() => root.render(<DocumentWalletBrowser applicantId="a1" documents={records} />));
    expect(container.querySelector('[data-testid="wallet-ghost-card"]')).toBeNull();
  });
});

describe('the stack styles', () => {
  const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  const start = css.indexOf('/* WP-PIC5');
  const block = css.slice(start, css.indexOf('/* end WP-PIC5 */'));

  it('is one marked block, placed before the WP-PIC1 block that must stay last', () => {
    expect(start).toBeGreaterThan(0);
    expect(css.indexOf('/* WP-PIC5', start + 1)).toBe(-1);
    expect(css.indexOf('/* end WP-PIC5 */')).toBeLessThan(css.indexOf('/* WP-PIC1 '));
  });

  it('is flat (depth comes only from pic-depth), has 44 px targets and honours reduced motion', () => {
    expect(block).not.toMatch(/box-shadow|text-shadow|filter:|gradient\(/);
    expect(block).toMatch(/min-height:\s*(?:44px|2\.75rem|[4-9]\d*(?:\.\d+)?rem)/);
    expect(block).not.toMatch(/transition|animation/);
    expect(block).not.toMatch(/—/);
  });

  it('does not use data: or blob: images', () => {
    expect(block).not.toMatch(/data:|blob:/);
  });
});
