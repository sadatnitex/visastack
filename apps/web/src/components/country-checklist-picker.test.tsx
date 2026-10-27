// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';
import { type StartData, countryStartData } from '../lib/country-start';
import {
  CountryChecklistPicker,
  type CountryChecklistPickerProps,
} from './country-checklist-picker';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data: StartData = countryStartData();
const nameOf = (iso2: string) => data.countries.find((c) => c.iso2 === iso2)?.name ?? iso2;
const noList = data.countries.find((c) => c.routeKeys.length === 0);

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

function show(props: Partial<CountryChecklistPickerProps> = {}) {
  act(() => root.render(<CountryChecklistPicker data={data} variant="home" {...props} />));
}

function type(text: string) {
  const input = container.querySelector<HTMLInputElement>('input[list]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!input || !setter) throw new Error('country box');
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const items = () =>
  [...container.querySelectorAll('.country-pick-item')].map((li) => li.textContent);
const status = () => container.querySelector('output')?.textContent ?? '';
const title = () => container.querySelector('.country-pick-title')?.textContent ?? '';

describe('the data the picker is built from', () => {
  it('has a checklist for some countries and says so for the rest', () => {
    expect(data.countries).toHaveLength(156);
    expect(data.withChecklist).toBeGreaterThan(20);
    expect(data.withChecklist).toBeLessThan(data.countries.length);
    expect(noList).toBeDefined();
  });

  it('is small enough to ship with the page', () => {
    expect(JSON.stringify(data).length).toBeLessThan(150_000);
  });

  it('shares the Schengen list between its states instead of copying it thirty times', () => {
    const keys = new Set(
      data.countries
        .filter((c) => ['DE', 'FR', 'IT', 'ES'].includes(c.iso2))
        .flatMap((c) => c.routeKeys),
    );
    const schengen = [...keys].filter((key) => data.routes[key]?.name.startsWith('Schengen'));
    expect(schengen).toHaveLength(1);
  });
});

describe('the country box', () => {
  it('starts empty, with a plain prompt and a labelled box that offers every country', () => {
    show();
    expect(container.textContent).toContain(
      'Your checklist appears here as soon as you pick a country.',
    );
    const input = container.querySelector<HTMLInputElement>('input[list]');
    expect(input?.value).toBe('');
    const label = container.querySelector(`label[for="${input?.id}"]`);
    expect(label?.textContent).toBe('Which Country Do You Want to Visit?');
    const list = document.getElementById(input?.getAttribute('list') ?? '');
    expect(list?.querySelectorAll('option')).toHaveLength(156);
    expect(container.querySelector('.country-pick-result')).toBeNull();
  });

  it('fills in the checklist as soon as a whole country name is typed or picked', () => {
    show();
    type('Germany');
    expect(title()).toBe('Germany');
    expect(items().length).toBeGreaterThanOrEqual(5);
    expect(status()).toContain('Showing the checklist for Germany');
    // Each item can be told apart from its neighbours and is revealed in turn.
    expect(container.querySelector('.country-pick-step-0')).not.toBeNull();
    expect(container.querySelector('.country-pick-step-1')).not.toBeNull();
  });

  it('replaces the list when the country changes, and empties it when the box is cleared', () => {
    show();
    type('Germany');
    const first = items();
    type('Japan');
    expect(title()).toBe('Japan');
    expect(items()).not.toEqual(first);
    type('');
    expect(container.querySelector('.country-pick-result')).toBeNull();
    expect(container.textContent).toContain('Your checklist appears here');
  });

  it('never jumps to another country while a name is half typed', () => {
    show();
    type('Jap');
    expect(container.querySelector('.country-pick-result')).toBeNull();
    type('Ger');
    expect(container.querySelector('.country-pick-result')).toBeNull();
  });

  it('says "no country matches" once the box is left, never on each letter typed', () => {
    show();
    type('J');
    type('Ja');
    // A screen reader hears nothing while the name is still being typed.
    expect(status()).toBe('');
    const input = container.querySelector<HTMLInputElement>('input[list]');
    act(() => {
      input?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(status()).toBe('No country matches. Pick one from the list.');
    // Typing again takes the message away at once.
    type('Jap');
    expect(status()).toBe('');
    type('Japan');
    expect(status()).toContain('Showing the checklist for Japan');
  });

  it.each([
    ['germany', 'DE'],
    ['  GERMANY ', 'DE'],
    ['Turkey', 'TR'],
    ['turkiye', 'TR'],
    ['UK', 'GB'],
    ['uae', 'AE'],
    ['Czech Republic', 'CZ'],
    ['ivory coast', 'CI'],
    ['Hong Kong', 'HK'],
    ['usa', 'US'],
  ])('understands %j', (typed, iso2) => {
    show();
    type(typed);
    expect(title()).toBe(nameOf(iso2));
  });

  it('opens on a country it was given, and ignores one it does not hold', () => {
    show({ initialIso2: 'JP' });
    expect(title()).toBe('Japan');
    act(() => root.unmount());
    root = createRoot(container);
    show({ initialIso2: 'ZZ' });
    expect(container.querySelector('.country-pick-result')).toBeNull();
  });
});

describe('what the checklist says', () => {
  it('says what a checklist is and is not, in every country', () => {
    show();
    type('Germany');
    const text = container.textContent ?? '';
    expect(text).toContain('For an ordinary Bangladeshi passport.');
    expect(text).toContain(
      'This is a list of what is usually asked for. It is not a decision and not a promise.',
    );
    expect(text).toContain('Rules change, so confirm on the official page before you apply.');
    expect(text.toLowerCase()).not.toMatch(/\b(approved|approval|guarantee|cleared|accepted)\b/);
  });

  it('warns that a short list may be incomplete, and says nothing of the kind about a full one', () => {
    show();
    type('Canada');
    const route = (key: string | undefined) => (key ? data.routes[key] : undefined);
    const canada = data.countries.find((c) => c.iso2 === 'CA');
    expect(route(canada?.routeKeys[0])?.thin).toBe(true);
    expect(container.textContent).toContain('This list may not be complete.');
    type('Germany');
    expect(container.textContent).not.toContain('This list may not be complete.');
  });

  it('offers a visa type when a country has several, with the fullest list first', () => {
    show();
    type('United Kingdom');
    const select = container.querySelector<HTMLSelectElement>('select');
    expect(select).not.toBeNull();
    expect(select?.options.length).toBeGreaterThan(1);
    expect(container.querySelector('label[for]')?.textContent).toBeTruthy();
    const before = items();
    const other = [...(select?.options ?? [])].find((option) => option.value !== select?.value);
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(select, other?.value ?? '');
      select?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(items()).not.toEqual(before);
    // Pick another country and back: the first visa type is shown again, not a stale choice.
    type('Germany');
    expect(container.querySelector('select')).toBeNull();
    type('United Kingdom');
    expect(items()).toEqual(before);
  });

  it('says plainly when there is no checklist yet, and points to the official page', () => {
    if (!noList) throw new Error('fixture');
    show();
    type(noList.name);
    const text = container.textContent ?? '';
    expect(text).toMatch(/We have not (added a checklist for|collected the rules for)/);
    expect(text).toContain('Check the official page.');
    expect(container.querySelector('.country-pick-item')).toBeNull();
    expect(status()).toBe(`There is no checklist for ${noList.name} yet.`);
    if (noList.officialUrl) {
      const link = container.querySelector<HTMLAnchorElement>('.country-pick-official a');
      expect(link?.getAttribute('href')).toBe(noList.officialUrl);
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});

describe('carrying the choice on', () => {
  it('on the home page, links to create an account with the country kept in the address', () => {
    show({ variant: 'home', signUpOpen: true });
    expect(container.querySelector('.country-pick-action')).toBeNull();
    type('Japan');
    const link = container.querySelector<HTMLAnchorElement>('.country-pick-action a');
    expect(link?.textContent).toBe('Create Free Account for Japan');
    const href = link?.getAttribute('href') ?? '';
    expect(href).toBe('/auth/sign-up?next=%2Fapp%3Fcountry%3DJP');
    // The address after sign-up is the first-run country step, prefilled.
    expect(decodeURIComponent(href.split('next=')[1] ?? '')).toBe('/app?country=JP');
  });

  it('on the home page, leads to sign-in while sign-up is closed', () => {
    show({ variant: 'home', signUpOpen: false });
    type('Japan');
    const link = container.querySelector<HTMLAnchorElement>('.country-pick-action a');
    expect(link?.textContent).toBe('Sign In to Start With Japan');
    expect(link?.getAttribute('href')).toBe('/auth/sign-in?next=%2Fapp%3Fcountry%3DJP');
  });

  it('in first run, confirms with a form that sends the code and nothing typed', () => {
    const action = vi.fn();
    show({ variant: 'first-run', action });
    expect(container.querySelector('form')).toBeNull();
    type('japan');
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect([...new FormData(form as HTMLFormElement).entries()]).toEqual([['country', 'JP']]);
    expect(form?.querySelector('button[type="submit"]')?.textContent).toBe('Continue With Japan');
    expect(form?.querySelector('button')?.hasAttribute('disabled')).toBe(false);
    expect(container.querySelector('input[list]')?.getAttribute('name')).toBeNull();
  });

  it('uses the heading level that fits the page it is on', () => {
    show({ variant: 'home', initialIso2: 'DE' });
    expect(container.querySelector('h3.country-pick-title')).not.toBeNull();
    expect(container.querySelector('h4')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    show({ variant: 'first-run', initialIso2: 'DE', action: vi.fn() });
    expect(container.querySelector('h2.country-pick-title')).not.toBeNull();
    expect(container.querySelector('h3')).not.toBeNull();
  });

  it('draws with classes only, so no inline style can slip in', () => {
    show({ initialIso2: 'DE' });
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('accessibility', () => {
  const states: readonly [string, Partial<CountryChecklistPickerProps>][] = [
    ['empty, on the home page', {}],
    ['a full list, on the home page', { initialIso2: 'DE' }],
    ['a short list with visa types, on the home page', { initialIso2: 'CA' }],
    ['several visa types, on the home page', { initialIso2: 'GB' }],
    [
      'a full list, in first run',
      { variant: 'first-run', initialIso2: 'DE', action: () => undefined },
    ],
    ['empty, in first run', { variant: 'first-run', action: () => undefined }],
  ];

  it.each(states)(
    'has no structural faults: %s',
    async (_name, props) => {
      show(props);
      expect(await axeViolations(container.innerHTML)).toEqual([]);
    },
    30_000,
  );

  it('has no structural faults with no checklist for the country', async () => {
    if (!noList) throw new Error('fixture');
    show({ initialIso2: noList.iso2 });
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  }, 30_000);

  it('announces the result in a status element that the box is described by', () => {
    show();
    const output = container.querySelector('output');
    expect(output).not.toBeNull();
    const describedBy =
      container.querySelector('input[list]')?.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ')).toContain(output?.id);
  });
});

describe('the style block (WP-G2)', () => {
  const css = readFileSync(`${process.cwd()}/src/app/globals.css`, 'utf8');
  const start = css.indexOf('/* WP-G2 ');
  const end = css.indexOf('/* WP-', start + 1);
  const block = css.slice(start, end);

  it('is one block, placed before the first WP-REF block', () => {
    expect(css.split('/* WP-G2 ').length).toBe(2);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(css.slice(end, end + 11)).toBe('/* WP-REF v');
  });

  it('reveals items only when the device allows motion, and never loops', () => {
    // The only rule that starts the reveal sits inside the no-preference query.
    const outside = block.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/,
      '',
    );
    expect(outside).not.toMatch(/animation:/);
    expect(block).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.country-pick-item \{\s*animation: country-pick-in 260ms/,
    );
    expect(block).not.toMatch(/infinite/);
  });

  it('stays flat: no shadow, gradient or translucent surface', () => {
    expect(block).not.toMatch(/box-shadow|gradient|backdrop-filter|rgba\(/);
  });

  it('gives every revealed step a delay, and keeps 44px targets on its buttons and links', () => {
    for (let step = 0; step <= 11; step++) {
      expect(block).toContain(`.country-pick-step-${step} {`);
    }
    expect(block).toMatch(/\.country-pick-action \.btn \{\s*min-height: 44px;/);
  });
});
