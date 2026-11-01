// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DocumentWalletBrowser,
  type WalletBrowserDocument,
} from '../../../../../../components/document-wallet-browser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = (id: string): WalletBrowserDocument => ({
  id,
  name: `Synthetic ${id}`,
  kind: 'Passport',
  category: 'Identity',
  version: 1,
  updatedAt: '2026-10-11T00:00:00Z',
  ready: true,
  needsReview: false,
  expiring: false,
  safetyLabel: 'Clean',
  processingLabel: 'Approved',
  previewAllowed: true,
  details: <span>Details of {id}</span>,
});

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
});

const render = (documents: WalletBrowserDocument[]) =>
  act(() => root.render(<DocumentWalletBrowser applicantId="p1" documents={documents} />));
const row = (id: string) => container.querySelector(`#document-${id}`);

describe('the Manage slot in a document row (coordinator-approved exception, lane F)', () => {
  it('leaves a row exactly as it was when no menu is given', () => {
    render([base('one'), base('two')]);
    const unselected = row('two');
    expect([...(unselected?.children ?? [])].map((child) => child.className)).toEqual([
      'wallet-document-select',
    ]);
    const selected = row('one');
    expect([...(selected?.children ?? [])].map((child) => child.className)).toEqual([
      'wallet-document-select',
      'wallet-detail-jump',
    ]);
    expect(container.querySelector('.wallet-document-manage')).toBeNull();
  });

  it('draws the menu inside the row after its select button, never in the selected details', () => {
    render([base('one')]);
    const before = row('one')?.querySelector('.wallet-document-select')?.outerHTML;
    render([{ ...base('one'), manage: <button type="button">Manage</button> }]);
    const item = row('one');
    const select = item?.querySelector('.wallet-document-select');
    expect(select?.outerHTML).toBe(before);
    expect([...(item?.children ?? [])].map((child) => child.className)).toEqual([
      'wallet-document-select',
      'wallet-document-manage',
      'wallet-detail-jump',
    ]);
    expect(item?.querySelector('.wallet-document-manage button')?.textContent).toBe('Manage');
    expect(container.querySelector('#wallet-selected-document .wallet-document-manage')).toBeNull();
    // Keyboard order: the select button first, then the menu.
    const focusables = [
      ...container.querySelectorAll<HTMLElement>('#document-one button, #document-one a'),
    ];
    expect(focusables[0]).toBe(select);
    expect(focusables[1]?.textContent).toBe('Manage');
  });
});
