// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRecordItems } from './record-hub';

const route = vi.hoisted(() => ({ pathname: '/app' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const { RecordBrowser } = await import('./record-browser');
const { RecordSections } = await import('./record-sections');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = '10000000-0000-4000-8000-000000000001';
const base = `/app/applicant/${person}`;
const document = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  typeLabel: 'Passport',
  typeKey: 'passport',
  groupLabel: 'Identity',
  lifecycle: 'CURRENT' as const,
  safetyStatus: 'CLEAN',
  processingStatus: 'AWAITING_REVIEW',
  checked: true,
  review: { expiryMissing: false, kindNeedsCheck: false, namePending: false },
  version: 1,
  updatedLabel: null,
  expiresLabel: null,
  replacedBy: null,
  usedIn: [],
  sharedWith: [],
  ...overrides,
});
const items = buildRecordItems({
  applicantId: person,
  details: [{ key: 'personal', label: 'About You', groupLabel: 'You', answered: 1, total: 4 }],
  documents: [
    document('40000000-0000-4000-8000-000000000001', 'Synthetic Passport'),
    document('40000000-0000-4000-8000-000000000002', 'Synthetic Bank Letter', {
      typeLabel: 'Bank Letter',
      typeKey: 'bank_letter',
      groupLabel: 'Money',
      processingStatus: 'REJECTED',
    }),
  ],
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = window.document.createElement('div');
  window.document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  route.pathname = '/app';
});

const titles = () =>
  [...container.querySelectorAll('.record-hub-item strong')].map((node) => node.textContent);
function type(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) throw new Error('search box missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the Record browser', () => {
  it('lists details and documents in their groups with labelled search and group controls', () => {
    act(() => root.render(<RecordBrowser items={items} />));
    expect(titles()).toEqual(['About You', 'Synthetic Passport', 'Synthetic Bank Letter']);
    expect(
      [...container.querySelectorAll('.record-hub-group h3')].map((h) => h.textContent),
    ).toEqual(['You', 'Identity', 'Money']);
    expect(container.querySelector('label input[type="search"]')).not.toBeNull();
    expect(container.querySelector('label select')).not.toBeNull();
    expect(container.querySelector('output')?.textContent).toBe('3 records shown');
    // Each group is named by its own heading, and the filters are announced as one group.
    for (const section of container.querySelectorAll('section.record-hub-group')) {
      const heading = section.querySelector('h3');
      expect(section.getAttribute('aria-label')).toBeNull();
      expect(section.getAttribute('aria-labelledby')).toBe(heading?.id);
    }
    const filters = container.querySelector('fieldset');
    expect(filters?.querySelector('legend')?.textContent).toBe('Record Filters');
    expect(filters?.querySelectorAll('button')).toHaveLength(5);
  });

  it('narrows by metadata and says plainly when nothing matches', () => {
    act(() => root.render(<RecordBrowser items={items} />));
    type('bank');
    expect(titles()).toEqual(['Synthetic Bank Letter']);
    type('no such record');
    expect(titles()).toEqual([]);
    expect(container.querySelector('.record-hub-empty')?.textContent).toContain('Nothing matches');
  });

  it('the Ready to Use filter leaves out a refused file', () => {
    act(() => root.render(<RecordBrowser items={items} />));
    const ready = [
      ...container.querySelectorAll<HTMLButtonElement>('.record-hub-filters button'),
    ].find((button) => button.textContent?.startsWith('Ready to Use'));
    act(() => ready?.click());
    expect(ready?.getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toEqual(['Synthetic Passport']);
  });

  it('every action is a link to an existing page of this person, named for its record', () => {
    act(() => root.render(<RecordBrowser items={items} />));
    const links = [...container.querySelectorAll<HTMLAnchorElement>('.record-hub-actions a')];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute('href')?.startsWith(base)).toBe(true);
    expect(links.map((link) => link.getAttribute('aria-label'))).toContain(
      'Share: Synthetic Passport',
    );
    expect(links.map((link) => link.getAttribute('aria-label'))).not.toContain(
      'Share: Synthetic Bank Letter',
    );
  });
});

describe('the Record section links', () => {
  it('show on each Record page with the current section marked', () => {
    route.pathname = `${base}/expiry`;
    act(() => root.render(<RecordSections applicantId={person} />));
    const links = [...container.querySelectorAll('nav[aria-label="Record sections"] a')];
    expect(links.map((a) => a.textContent)).toEqual([
      'All Records',
      'Profile',
      'Documents',
      'Dates & Expiry',
      'History',
    ]);
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('Dates & Expiry');
  });

  it('stay off pages that are not part of Record', () => {
    for (const path of [base, `${base}/missions`, `${base}/sharing`, `${base}/evidence`]) {
      route.pathname = path;
      act(() => root.render(<RecordSections applicantId={person} />));
      expect(container.querySelector('nav'), path).toBeNull();
    }
  });
});

describe('the Record styles fit a 320px phone', () => {
  it('sit in one marked block, wrap, and keep 44px targets', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/src/app/globals.css`, 'utf8');
    const start = css.indexOf('/* WP-V3 part 2:');
    expect(start).toBeGreaterThan(0);
    // The block runs to the next package's marked block, wherever this one sits in the file.
    const next = css.slice(start + 1).search(/\/\* WP-[A-Z0-9]+/);
    const block = next < 0 ? css.slice(start) : css.slice(start, start + 1 + next);
    expect(block).toContain('.record-hub-filter-set {');
    expect(block).toMatch(/\.record-sections \{[^}]*flex-wrap: wrap;/);
    expect(block).toMatch(/\.record-sections a \{[^}]*min-height: 44px;/);
    expect(block).toMatch(/\.record-hub-actions \{[^}]*flex-wrap: wrap;/);
    expect(block).toMatch(/\.record-hub-actions \.btn \{[^}]*min-height: 44px;/);
    expect(block).toMatch(/\.record-hub-filters button \{[^}]*min-height: 44px;/);
    expect(block).toMatch(
      /@media \(max-width: 760px\) \{[^@]*\.record-hub-controls \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    // No fixed width anywhere in the block that could push a phone screen sideways.
    expect(block).not.toMatch(/(?:^|[\s;{])width:\s*\d{3,}px/);
    expect(block).not.toMatch(/white-space:\s*nowrap/);
  });
});
