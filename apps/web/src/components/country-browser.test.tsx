// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CountryBrowser, type CountryBrowserItem } from './country-browser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const filters = [
  { status: 'VISA_REQUIRED', label: 'Visa needed', statusLabel: 'Visa needed before you travel' },
  { status: 'E_VISA', label: 'E-visa', statusLabel: 'Online visa (e-visa)' },
  { status: 'VISA_FREE', label: 'No visa needed', statusLabel: 'No visa needed' },
  { status: 'NOT_FOUND', label: 'Not yet researched', statusLabel: 'Not yet researched' },
] as const;
const items: CountryBrowserItem[] = [
  {
    iso2: 'GB',
    name: 'United Kingdom',
    status: 'VISA_REQUIRED',
    stay: 'Up to 180 days',
    fee: 'BDT 22,450',
    unconfirmed: false,
  },
  { iso2: 'JP', name: 'Japan', status: 'VISA_REQUIRED', stay: null, fee: null, unconfirmed: true },
  { iso2: 'VN', name: 'Vietnam', status: 'E_VISA', stay: null, fee: null, unconfirmed: false },
  { iso2: 'KW', name: 'Kuwait', status: 'NOT_FOUND', stay: null, fee: null, unconfirmed: false },
];
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<CountryBrowser items={items} filters={filters} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const names = () => [...container.querySelectorAll('.country-row-name')].map((n) => n.textContent);
const press = (text: string) => {
  const node = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!node) throw new Error(`No button ${text}`);
  act(() => node.click());
};

describe('the country list controls', () => {
  it('lists every country with a link to its page and a count on each filter', () => {
    expect(names()).toEqual(['United Kingdom', 'Japan', 'Vietnam', 'Kuwait']);
    expect(container.querySelector('a[href="/app/countries/gb"]')).not.toBeNull();
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toContain('4');
  });

  it('filters by entry rule and shows each rule in plain words on the row', () => {
    press('E-visa');
    expect(names()).toEqual(['Vietnam']);
    expect(container.textContent).toContain('Online visa (e-visa)');
  });

  it('shows not-yet-researched countries as such, with a warning tone, never as no visa needed', () => {
    press('Not yet researched');
    expect(names()).toEqual(['Kuwait']);
    expect(container.querySelector('.badge-warning')?.textContent).toBe('Not yet researched');
    expect(container.textContent).not.toContain('No visa needed');
  });

  it('hides a filter that no country matches', () => {
    expect(
      [...container.querySelectorAll('button')].some(
        (b) =>
          b.textContent?.includes('No visa needed') &&
          b.getAttribute('aria-pressed') !== null &&
          b.textContent?.includes('0'),
      ),
    ).toBe(false);
  });

  it('searches by name or two-letter code, and says so when nothing matches', () => {
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    const type = (value: string) =>
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    type('jap');
    expect(names()).toEqual(['Japan']);
    type('vn');
    expect(names()).toEqual(['Vietnam']);
    type('zzz');
    expect(container.textContent).toContain('No countries match');
  });

  it('flags a country that needs checking on its row', () => {
    const japan = [...container.querySelectorAll('.country-row')].find((r) =>
      r.textContent?.includes('Japan'),
    );
    expect(japan?.textContent).toContain('Needs checking');
  });
});
