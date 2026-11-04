// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentWalletBrowser, type WalletBrowserDocument } from './document-wallet-browser';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const records: WalletBrowserDocument[] = Array.from({ length: 15 }, (_, index) => ({
  id: `doc-${index}`,
  name: `Synthetic document ${index}`,
  kind: index === 0 ? 'Passport' : 'Bank Statement',
  category: index === 0 ? 'Identity' : 'Finance',
  version: index + 1,
  updatedAt: '2026-10-11T00:00:00Z',
  ready: index > 0,
  needsReview: index === 0,
  expiring: index === 1,
  safetyLabel: index === 0 ? 'Quarantined' : 'Clean',
  processingLabel: index === 0 ? 'Blocked' : 'Approved',
  previewAllowed: index > 0,
  details: <span>Authorized details for {index}</span>,
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(<DocumentWalletBrowser applicantId="synthetic-person" documents={records} />),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function button(text: string) {
  const node = [...container.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  );
  if (!node) throw new Error('Missing control');
  return node;
}
describe('real wallet metadata controls and selected detail slots', () => {
  it('bounds rows and paginates the full authorized list', () => {
    expect(container.querySelectorAll('.wallet-metadata-list li').length).toBe(12);
    act(() => button('Next').click());
    expect(container.querySelectorAll('.wallet-metadata-list li').length).toBe(3);
    expect(container.querySelector('output')?.textContent).toContain('Page 2 of 2');
  });
  it('selects a row and updates the detail region without serving file bytes', () => {
    act(() => button('Synthetic document 2').click());
    expect(container.querySelector('aside')?.textContent).toContain('Authorized details for 2');
    expect(container.querySelector('aside')?.textContent).not.toContain('Authorized details for 0');
    expect(container.querySelector('iframe, img, object, embed')).toBeNull();
    expect(
      container.querySelector('a[href="/app/applicant/synthetic-person/sharing"]'),
    ).not.toBeNull();
  });
  it('keeps blocked files out of the ready filter and clearly explains unavailable preview', () => {
    expect(container.querySelector('aside')?.textContent).toContain('Preview is blocked');
    act(() => button('Ready to Use').click());
    expect(container.querySelector('.wallet-metadata-list')?.textContent).not.toContain(
      'Synthetic document 0',
    );
    expect(container.querySelector('output')?.textContent).toContain('14 documents match');
    expect(container.querySelector('aside')?.textContent).toContain(
      'outside the current list filter',
    );
  });
  it('does not silently substitute another document for an unavailable explicit selection', () => {
    act(() =>
      root.render(
        <DocumentWalletBrowser
          key="new-selection"
          applicantId="synthetic-person"
          documents={records}
          initialSelection="foreign-or-removed"
        />,
      ),
    );
    expect(container.querySelector('aside')?.textContent).toContain(
      'Selected Document Is Unavailable',
    );
    expect(container.querySelector('aside')?.textContent).not.toContain('Authorized details for');
  });
  it('searches locally, resets pagination and reports a real empty result', () => {
    act(() => button('Next').click());
    const input = container.querySelector('input');
    if (!input) throw new Error('Search input');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'no matching document',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('output')?.textContent).toContain(
      '0 documents match. Page 1 of 1',
    );
    expect(container.textContent).toContain('No Documents Match');
  });
});

describe('documents with no kind set', () => {
  const unsorted: WalletBrowserDocument[] = [
    { ...(records[0] as WalletBrowserDocument), id: 'sorted', name: 'Sorted file' },
    {
      ...(records[1] as WalletBrowserDocument),
      id: 'loose-a',
      name: 'Loose file A',
      kind: null,
      category: null,
      suggestedKind: 'Passport',
    },
    {
      ...(records[2] as WalletBrowserDocument),
      id: 'loose-b',
      name: 'Loose file B',
      kind: null,
      category: null,
    },
  ];
  beforeEach(() => {
    act(() =>
      root.render(<DocumentWalletBrowser applicantId="synthetic-person" documents={unsorted} />),
    );
  });

  it('says how many have no kind and what that means for sharing by category', () => {
    const note = container.querySelector('[data-testid="wallet-not-sorted"]')?.textContent ?? '';
    expect(note).toContain('2 documents have no kind set yet');
    expect(note).toContain('left out when you share by category');
  });

  it('shows the suggestion as a suggestion and not as the kind', () => {
    const rows = [...container.querySelectorAll('.wallet-metadata-list li')].map(
      (row) => row.textContent ?? '',
    );
    expect(rows.find((row) => row.includes('Loose file A'))).toContain('Kind not set');
    expect(rows.find((row) => row.includes('Loose file A'))).toContain('AI suggests Passport');
    expect(rows.find((row) => row.includes('Sorted file'))).toContain('Passport · Identity');
  });

  it('lists only those documents when "Not Set Yet" is chosen', () => {
    const select = container.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'All Categories',
      'Identity',
      'Not Set Yet',
    ]);
    expect(container.textContent).toContain('3 documents match. Page 1 of 1.');
    act(() => button('Show Them').click());
    expect(container.querySelectorAll('.wallet-metadata-list li')).toHaveLength(2);
    expect(container.textContent).not.toContain('Sorted file');
  });

  it('counts one match in agreeing words', () => {
    act(() =>
      root.render(
        <DocumentWalletBrowser applicantId="synthetic-person" documents={unsorted.slice(1, 2)} />,
      ),
    );
    expect(container.textContent).toContain('1 document matches. Page 1 of 1.');
    expect(button('Show It')).toBeTruthy();
  });
});

describe('fewer rows a page on a phone (scroll budget, lane Z)', () => {
  const phone = (matches: boolean) =>
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
  afterEach(() => vi.unstubAllGlobals());

  it('shows 6 rows a page on a phone, and every document is still reached through the pages', () => {
    phone(true);
    act(() => root.unmount());
    root = createRoot(container);
    act(() =>
      root.render(<DocumentWalletBrowser applicantId="synthetic-person" documents={records} />),
    );
    const seen: string[] = [];
    const rows = () => [...container.querySelectorAll('.wallet-metadata-list li')];
    expect(rows()).toHaveLength(6);
    expect(container.querySelector('output')?.textContent).toContain('Page 1 of 3');
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      seen.push(...rows().map((row) => row.id));
      if (pageIndex < 2) act(() => button('Next').click());
    }
    expect(new Set(seen).size).toBe(records.length);
    expect(button('Next').disabled).toBe(true);
  });

  it('keeps 12 rows a page on a larger screen', () => {
    phone(false);
    act(() => root.unmount());
    root = createRoot(container);
    act(() =>
      root.render(<DocumentWalletBrowser applicantId="synthetic-person" documents={records} />),
    );
    expect(container.querySelectorAll('.wallet-metadata-list li')).toHaveLength(12);
  });
});

describe('a document opens as its own full screen on a phone (UX17)', () => {
  const phone = (matches: boolean) =>
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.style.overflow = '';
  });
  const mountWith = (matches: boolean, initialSelection?: string) => {
    phone(matches);
    act(() => root.unmount());
    root = createRoot(container);
    act(() =>
      root.render(
        <DocumentWalletBrowser
          applicantId="synthetic-person"
          documents={records}
          {...(initialSelection ? { initialSelection } : {})}
        />,
      ),
    );
  };
  const panel = () => container.querySelector('aside') as HTMLElement;

  it('starts closed, opens on a tap as a dialog, and goes back to the row that opened it', () => {
    mountWith(true);
    expect(panel().getAttribute('data-sheet')).toBe('closed');
    expect(panel().getAttribute('role')).toBeNull();
    const row = button('Synthetic document 2');
    act(() => row.click());
    expect(panel().getAttribute('data-sheet')).toBe('open');
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(panel());
    act(() => button('Back to Documents').click());
    expect(panel().getAttribute('data-sheet')).toBe('closed');
    expect(panel().getAttribute('role')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(row);
  });

  it('closes on Escape', () => {
    mountWith(true);
    act(() => button('Synthetic document 3').click());
    expect(panel().getAttribute('data-sheet')).toBe('open');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(panel().getAttribute('data-sheet')).toBe('closed');
  });

  it('takes the document out of the address on the way back, so a refresh does not reopen it', () => {
    mountWith(true);
    act(() => button('Synthetic document 2').click());
    expect(window.location.search).toContain('document=doc-2');
    act(() => button('Back to Documents').click());
    expect(window.location.search).not.toContain('document=');
  });

  it('leaves Escape to a menu inside that already used it', () => {
    mountWith(true);
    act(() => button('Synthetic document 3').click());
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      event.preventDefault();
      document.dispatchEvent(event);
    });
    expect(panel().getAttribute('data-sheet')).toBe('open');
  });

  it('keeps Tab inside the open screen', () => {
    mountWith(true);
    act(() => button('Synthetic document 2').click());
    const inside = [...panel().querySelectorAll<HTMLElement>('a[href], button')];
    const last = inside[inside.length - 1] as HTMLElement;
    const first = inside[0] as HTMLElement;
    // jsdom has no layout, so every node counts as shown for this check.
    for (const node of inside) Object.defineProperty(node, 'offsetParent', { value: container });
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    act(() => {
      document.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('opens at once for a link that names a document', () => {
    mountWith(true, 'doc-4');
    expect(panel().getAttribute('data-sheet')).toBe('open');
    expect(panel().textContent).toContain('Authorized details for 4');
  });

  it('is a plain side panel on a larger screen: no dialog, no scroll lock', () => {
    mountWith(false);
    act(() => button('Synthetic document 2').click());
    expect(panel().getAttribute('role')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
