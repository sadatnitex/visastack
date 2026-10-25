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
  expiryApplies: true,
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
  [...container.querySelectorAll('.record-hub-item-title')].map((node) => node.textContent);
function type(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) throw new Error('search box missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const filterButton = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('.record-hub-filters button')].find((button) =>
    button.textContent?.startsWith(label),
  );

describe('the Record browser', () => {
  it('follows the wallet pattern: filters, Category, then Search, then a visible count', () => {
    act(() => root.render(<RecordBrowser items={items} />));
    expect(titles()).toEqual(['About You', 'Synthetic Passport', 'Synthetic Bank Letter']);
    expect(
      [...container.querySelectorAll('.record-hub-group h3')].map((h) => h.textContent),
    ).toEqual(['You', 'Identity', 'Money']);
    const labels = [...container.querySelectorAll('.wallet-filter-controls label')];
    expect(labels.map((label) => label.firstChild?.textContent?.trim())).toEqual([
      'Category',
      'Search Your Record',
    ]);
    expect(labels[0]?.querySelector('select')?.options[0]?.textContent).toBe('All Categories');
    expect(labels[1]?.querySelector('input[type="search"]')).not.toBeNull();
    const count = container.querySelector('output');
    expect(count?.textContent).toBe('3 items match.');
    expect(count?.getAttribute('aria-live')).toBe('polite');
    expect(count?.className).not.toContain('sr-only');
    // Each group is named by its own heading, and the filters are announced as one group.
    for (const section of container.querySelectorAll('section.record-hub-group')) {
      const heading = section.querySelector('h3');
      expect(section.getAttribute('aria-label')).toBeNull();
      expect(section.getAttribute('aria-labelledby')).toBe(heading?.id);
    }
    const filters = container.querySelector('fieldset');
    expect(filters?.querySelector('legend')?.textContent).toBe('Record Filters');
    expect(filters?.querySelectorAll('button')).toHaveLength(5);
    expect(filters?.querySelector('.wallet-overview-strip')).toBeNull();
  });

  it('narrows by metadata and says plainly when nothing matches', () => {
    act(() => root.render(<RecordBrowser items={items} />));
    type('bank');
    expect(titles()).toEqual(['Synthetic Bank Letter']);
    expect(container.querySelector('output')?.textContent).toBe('1 item matches.');
    type('no such record');
    expect(titles()).toEqual([]);
    expect(container.querySelector('.record-hub-empty')?.textContent).toContain('Nothing matches');
  });

  it('the Ready to Use filter leaves out a refused file', () => {
    act(() => root.render(<RecordBrowser items={items} />));
    const ready = filterButton('Ready to Use');
    act(() => ready?.click());
    expect(ready?.getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toEqual(['Synthetic Passport']);
  });

  it('each title opens its item, with at most one further action per row', () => {
    act(() => root.render(<RecordBrowser items={items} />));
    const rows = [...container.querySelectorAll('.record-hub-item')];
    for (const row of rows) {
      expect(
        row.querySelector('.record-hub-item-title')?.getAttribute('href')?.startsWith(base),
      ).toBe(true);
      expect(row.querySelectorAll('.record-hub-actions a').length).toBeLessThanOrEqual(1);
    }
    const actions = [...container.querySelectorAll('.record-hub-actions a')].map((link) =>
      link.getAttribute('aria-label'),
    );
    expect(actions).toEqual([
      'Update Details: About You',
      'Share: Synthetic Passport',
      'Update or Replace: Synthetic Bank Letter',
    ]);
  });

  it('when documents did not load, their filters say so instead of counting zero', () => {
    const details = items.filter((item) => item.kind === 'details');
    act(() => root.render(<RecordBrowser items={details} documentsLoaded={false} />));
    for (const label of ['Ready to Use', 'Needs Attention', 'Previous Versions']) {
      const button = filterButton(label);
      expect(button?.disabled, label).toBe(true);
      expect(button?.textContent, label).toContain('Not available right now');
      expect(button?.querySelector('strong'), label).toBeNull();
    }
    expect(filterButton('Everything')?.disabled).toBe(false);
    type('no such record');
    expect(container.querySelector('.record-hub-empty')).toBeNull();
  });

  it('pages a long record twelve at a time, as the wallet does', () => {
    const many = Array.from({ length: 13 }, (_, index) =>
      document(
        `40000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
        `Synthetic File ${index + 1}`,
      ),
    );
    const long = buildRecordItems({ applicantId: person, details: [], documents: many });
    act(() => root.render(<RecordBrowser items={long} />));
    expect(titles()).toHaveLength(12);
    expect(container.querySelector('output')?.textContent).toBe('13 items match. Page 1 of 2.');
    const next = [
      ...container.querySelectorAll<HTMLButtonElement>('.wallet-pagination button'),
    ].find((button) => button.textContent === 'Next');
    act(() => next?.click());
    expect(titles()).toEqual(['Synthetic File 13']);
  });
});

describe('empty profile sections on the Record', () => {
  const withEmpty = buildRecordItems({
    applicantId: person,
    details: [
      { key: 'personal', label: 'About You', groupLabel: 'You', answered: 1, total: 4 },
      { key: 'passport', label: 'Passport', groupLabel: 'You', answered: 0, total: 5 },
      { key: 'visas', label: 'Visas You Have Held', groupLabel: 'You', answered: 0, total: 3 },
    ],
    documents: [document('40000000-0000-4000-8000-000000000001', 'Synthetic Passport')],
  });

  it('are named on one quiet line at the end of their group, each a link to its place', () => {
    act(() => root.render(<RecordBrowser items={withEmpty} />));
    expect(titles()).toEqual(['About You', 'Synthetic Passport']);
    expect(container.querySelector('output')?.textContent).toBe('2 items match.');
    const line = container.querySelector('.record-hub-group .record-hub-nothing-saved');
    expect(line?.textContent).toBe('Nothing saved yet: Passport, Visas You Have Held');
    expect([...(line?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual([
      `${base}/profile#section-passport`,
      `${base}/profile#section-visas`,
    ]);
    expect(line?.parentElement?.lastElementChild).toBe(line);
    expect(filterButton('Everything')?.querySelector('strong')?.textContent).toBe('2');
  });

  it('are full rows under the Profile Details filter', () => {
    act(() => root.render(<RecordBrowser items={withEmpty} />));
    act(() => filterButton('Profile Details')?.click());
    expect(titles()).toEqual(['About You', 'Passport', 'Visas You Have Held']);
    expect(container.querySelector('.record-hub-nothing-saved')).toBeNull();
  });
});

describe('the Record section links', () => {
  it('use the shared section tabs on each Record page, with the current section marked', () => {
    route.pathname = `${base}/expiry`;
    act(() => root.render(<RecordSections applicantId={person} />));
    const nav = container.querySelector('nav.subnav[aria-label="Record Sections"]');
    expect(nav).not.toBeNull();
    expect([...(nav?.querySelectorAll('a') ?? [])].map((a) => a.textContent)).toEqual([
      'All Records',
      'My Profile',
      'Documents',
      'Dates & Expiry',
      'History',
    ]);
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('Dates & Expiry');
  });

  it('show on the hub itself, with All Records marked', () => {
    route.pathname = `${base}/record`;
    act(() => root.render(<RecordSections applicantId={person} />));
    expect(container.querySelector('nav.subnav[aria-label="Record Sections"]')).not.toBeNull();
    expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('All Records');
  });

  it('stay off pages that are not part of Record', () => {
    for (const path of [base, `${base}/missions`, `${base}/sharing`, `${base}/evidence`]) {
      route.pathname = path;
      act(() => root.render(<RecordSections applicantId={person} />));
      expect(container.querySelector('nav'), path).toBeNull();
    }
  });
});

describe('the Record styles fit a 320px phone and use the shared tokens', () => {
  it('sit in one marked block, wrap, keep 44px targets, and draw single hairlines', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/src/app/globals.css`, 'utf8');
    const start = css.indexOf('/* WP-V3 part 2:');
    expect(start).toBeGreaterThan(0);
    // The block runs to the next package's marked block, wherever this one sits in the file.
    const next = css.slice(start + 1).search(/\/\* WP-[A-Z0-9]+/);
    const block = next < 0 ? css.slice(start) : css.slice(start, start + 1 + next);
    expect(block).toContain('.record-hub-filter-set {');
    // The one-off pill tabs are gone; the section tabs are the shared .subnav.
    expect(css).not.toMatch(/\.record-sections\b/);
    // Its own five-cell strip: one hairline between cells, the last cell spanning on a phone.
    expect(block).toMatch(
      /\.record-hub-filters \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);[^}]*gap: 1px;[^}]*background: var\(--hairline-soft\);/,
    );
    expect(block).toMatch(/\.record-hub-filters button \{[^}]*border: 0;/);
    expect(block).toMatch(
      /@media \(max-width: 760px\) \{[^@]*\.record-hub-filters \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^@]*\.record-hub-filters button:last-child \{\s*grid-column: 1 \/ -1;/,
    );
    expect(block).toMatch(/\.record-hub-item \{[^}]*border-top: 1px solid var\(--hairline-soft\);/);
    expect(block).toMatch(/\.record-hub-group h3 \{[^}]*font-size: var\(--text-lead\);/);
    expect(block).toMatch(
      /\.record-hub-nothing-saved \{[^}]*border-top: 1px solid var\(--hairline-soft\);[^}]*font-size: var\(--text-small\);/,
    );
    expect(block).toMatch(/\.record-hub-actions \{[^}]*flex-wrap: wrap;/);
    expect(block).toMatch(/\.record-hub-actions \.btn \{[^}]*min-height: 44px;/);
    expect(block).toMatch(/\.record-hub-filters button \{[^}]*min-height: 44px;/);
    expect(block).toMatch(/\.record-hub-item-title \{[^}]*min-height: 44px;/);
    // Tokens only: no raw colours, and spacing on the shared scale.
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    for (const rule of block.matchAll(/(?:margin|padding|gap)[a-z-]*:\s*([^;]+);/g)) {
      const value = rule[1] ?? '';
      expect(value, rule[0]).toMatch(/^(?:0|1px|var\(--space-\d\))(?: (?:0|var\(--space-\d\)))*$/);
    }
    // No fixed width anywhere in the block that could push a phone screen sideways.
    expect(block).not.toMatch(/(?:^|[\s;{])width:\s*\d{3,}px/);
    expect(block).not.toMatch(/white-space:\s*nowrap/);
  });
});
