// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    act(() => button('Ready to use').click());
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
      'Selected document is unavailable',
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
    expect(container.textContent).toContain('No documents match');
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

  it('lists only those documents when "Not set yet" is chosen', () => {
    const select = container.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'All Categories',
      'Identity',
      'Not set yet',
    ]);
    act(() => button('Show them').click());
    expect(container.querySelectorAll('.wallet-metadata-list li')).toHaveLength(2);
    expect(container.textContent).not.toContain('Sorted file');
  });
});
