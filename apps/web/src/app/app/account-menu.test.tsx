// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ pathname: '/app/privacy' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const { AccountMenu, accountInitials } = await import('./account-menu');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every destination the menu offered before the redesign, in its order, plus the plan link. */
const ROWS = [
  ['/app/account', 'Your Account'],
  ['/app/applicants', 'Manage Travellers'],
  ['/app/agency', 'Create or Manage an Agency'],
  ['/app/privacy', 'Privacy & Consent'],
  ['/app/help', 'Help & Support'],
  ['/status', 'Service Status'],
] as const;

let root: Root;
let container: HTMLDivElement;
let outsideButton: HTMLButtonElement;
type Props = Parameters<typeof AccountMenu>[0];
const signOut = (
  <form>
    <button type="submit">Sign out</button>
  </form>
);
function mount(props: Partial<Props> = {}) {
  act(() =>
    root.render(
      <AccountMenu
        name="Synthetic Self"
        email="synthetic.self@example.test"
        plan={{ name: 'Traveller Free', href: '/app/account' }}
        signOut={signOut}
        {...props}
      />,
    ),
  );
}
const details = () => container.querySelector('details') as HTMLDetailsElement;
const summary = () => container.querySelector('summary') as HTMLElement;
const panel = () => container.querySelector('nav[aria-label="Account Menu"]') as HTMLElement;
const key = (target: Element, name: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  });
const open = () => {
  details().open = true;
};

beforeEach(() => {
  route.pathname = '/app/privacy';
  container = document.createElement('div');
  outsideButton = document.createElement('button');
  document.body.append(container, outsideButton);
  root = createRoot(container);
  mount();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  outsideButton.remove();
});

describe('account menu structure', () => {
  it('shows who is signed in, their plan, two labelled groups and Sign Out last', () => {
    const nav = panel();
    expect(nav.querySelector('.account-menu-avatar')?.textContent).toBe('SS');
    expect(nav.querySelector('.account-menu-avatar')?.getAttribute('aria-hidden')).toBe('true');
    expect(nav.querySelector('.account-menu-name')?.textContent).toBe('Synthetic Self');
    expect(nav.querySelector('.account-menu-email')?.textContent).toBe(
      'synthetic.self@example.test',
    );
    expect(nav.querySelector('.account-menu-chip')?.textContent).toBe('Traveller Free');
    const planLink = nav.querySelector('.account-menu-plan a');
    expect(planLink?.textContent).toBe('View Plan');
    expect(planLink?.getAttribute('href')).toBe('/app/account');
    expect([...nav.querySelectorAll('.account-menu-label')].map((p) => p.textContent)).toEqual([
      'Account',
      'Support',
    ]);
    const rows = [...nav.querySelectorAll('.account-menu-row')];
    expect(rows.map((row) => [row.getAttribute('href'), row.textContent])).toEqual(ROWS);
    for (const row of rows) expect(row.querySelector('svg')?.getAttribute('width')).toBe('20');
    // Sign Out stays the existing form, placed after every row.
    expect(nav.lastElementChild?.className).toBe('account-menu-signout');
    expect(nav.lastElementChild?.querySelector('form button')?.textContent).toBe('Sign out');
    // Personal controls only: no workspace destinations leak into this menu.
    expect(nav.querySelector('a[href="/app/shared"]')).toBeNull();
    expect(nav.querySelector('a[href="/app/admin"]')).toBeNull();
  });

  it('leaves out the address when the session gave none, and keeps View Plan without a plan', () => {
    mount({ email: undefined, plan: null });
    expect(panel().querySelector('.account-menu-email')).toBeNull();
    expect(panel().querySelector('.account-menu-chip')).toBeNull();
    expect(panel().querySelector('.account-menu-plan a')?.getAttribute('href')).toBe(
      '/app/account',
    );
  });

  it('shows a photo instead of initials when one is given, without announcing it twice', () => {
    mount({ photoUrl: '/synthetic/photo.png' });
    const avatar = panel().querySelector('.account-menu-avatar');
    const img = avatar?.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/synthetic/photo.png');
    expect(img?.getAttribute('alt')).toBe('');
    expect(avatar?.textContent).toBe('');
  });

  it('builds initials the same way as the workspace selector', () => {
    expect(accountInitials('Amina Rahman Chowdhury')).toBe('AR');
    expect(accountInitials('  solo  ')).toBe('S');
  });
});

describe('account menu accessibility', () => {
  it('ties the trigger to the panel and marks only the current page', () => {
    expect(summary().getAttribute('aria-label')).toBe('Synthetic Self, Account Menu');
    expect(summary().getAttribute('aria-controls')).toBe(panel().id);
    const current = [...panel().querySelectorAll('[aria-current]')];
    expect(
      current.map((row) => [row.getAttribute('href'), row.getAttribute('aria-current')]),
    ).toEqual([['/app/privacy', 'page']]);
  });

  it('names each group by its visible label so screen readers hear Account and Support', () => {
    const groups = [...panel().querySelectorAll('[role="group"]')];
    expect(groups).toHaveLength(2);
    const names = groups.map((group) => {
      const id = group.getAttribute('aria-labelledby') ?? '';
      return document.getElementById(id)?.textContent;
    });
    expect(names).toEqual(['Account', 'Support']);
    expect(groups.map((group) => group.querySelectorAll('a').length)).toEqual([4, 2]);
    // The trigger's name comes from its label alone; no hidden duplicate text inside it.
    expect(summary().querySelector('.sr-only')).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    open();
    const row = panel().querySelector<HTMLElement>('a[href="/app/applicants"]');
    row?.focus();
    key(row as Element, 'Escape');
    expect(details().open).toBe(false);
    expect(document.activeElement).toBe(summary());
  });

  it('moves between rows with the arrow keys, Home and End, and wraps at the ends', () => {
    key(summary(), 'ArrowDown');
    expect(details().open).toBe(true);
    const focused = () =>
      document.activeElement?.getAttribute('href') ?? document.activeElement?.textContent;
    expect(focused()).toBe('/app/account'); // View Plan, the first row
    key(document.activeElement as Element, 'ArrowDown');
    expect(focused()).toBe('/app/account');
    expect(document.activeElement?.className).toBe('account-menu-row');
    key(document.activeElement as Element, 'ArrowDown');
    expect(focused()).toBe('/app/applicants');
    key(document.activeElement as Element, 'End');
    expect(focused()).toBe('Sign out');
    key(document.activeElement as Element, 'ArrowDown');
    expect(document.activeElement?.className).toBe('account-menu-plan-link');
    key(document.activeElement as Element, 'ArrowUp');
    expect(focused()).toBe('Sign out');
    key(document.activeElement as Element, 'Home');
    expect(document.activeElement?.className).toBe('account-menu-plan-link');
    // The phone close button is reached by Tab, never by the arrow keys.
    const reached = new Set<Element | null>();
    for (let i = 0; i < 10; i++) {
      key(document.activeElement as Element, 'ArrowDown');
      reached.add(document.activeElement);
    }
    expect(reached.has(panel().querySelector('.account-menu-close'))).toBe(false);
    key(summary(), 'ArrowUp');
    expect(focused()).toBe('Sign out');
  });

  it('closes on an outside tap, but not on a tap inside the panel', () => {
    open();
    act(() => {
      panel().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(details().open).toBe(true);
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(details().open).toBe(false);
  });

  it('closes when a row is chosen, when the route changes and when focus tabs away', () => {
    open();
    // jsdom cannot follow a link; the menu's own handler still runs first.
    panel().addEventListener('click', (event) => event.preventDefault());
    act(() => (panel().querySelector('a[href="/status"]') as HTMLElement).click());
    expect(details().open).toBe(false);

    open();
    route.pathname = '/app/help';
    mount();
    expect(details().open).toBe(false);
    expect(panel().querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/app/help');

    open();
    const last = panel().querySelector<HTMLElement>('.account-menu-signout button');
    last?.focus();
    act(() => outsideButton.focus());
    expect(details().open).toBe(false);
    // Focus moving inside the menu keeps it open.
    open();
    last?.focus();
    act(() => panel().querySelector<HTMLElement>('a[href="/app/help"]')?.focus());
    expect(details().open).toBe(true);
  });

  it('closes from the phone close button and returns focus to the trigger', () => {
    open();
    act(() => (panel().querySelector('.account-menu-close') as HTMLElement).click());
    expect(details().open).toBe(false);
    expect(document.activeElement).toBe(summary());
    expect(panel().querySelector('.account-menu-close')?.getAttribute('aria-label')).toBe(
      'Close Account Menu',
    );
  });
});

/** The marked stylesheet block for this menu, ending at the next marked block. */
function menuCss(css: string): string {
  const start = css.indexOf('/* WP-UI2 account menu:');
  if (start < 0) return '';
  const next = css.slice(start + 1).search(/\/\* WP-[A-Z0-9]+/);
  return next < 0 ? css.slice(start) : css.slice(start, start + 1 + next);
}

/** Top-level rules and media blocks of a stylesheet fragment, without comments. */
function topLevel(css: string): { readonly prelude: string; readonly body: string }[] {
  const text = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const out: { prelude: string; body: string }[] = [];
  let depth = 0;
  let begin = 0;
  let open = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) open = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        out.push({ prelude: text.slice(begin, open).trim(), body: text.slice(open + 1, i) });
        begin = i + 1;
      }
    }
  }
  return out;
}

describe('account menu stylesheet (WP-UI2)', () => {
  const css = readFileSync(`${process.cwd()}/src/app/globals.css`, 'utf8');
  const block = menuCss(css);
  const SHORT = '@media (min-width: 761px) and (max-height: 640px)';
  const PHONE = '@media (max-width: 760px)';

  it('is one marked block at the end of the stylesheet', () => {
    expect(block.length).toBeGreaterThan(500);
    expect(css.trimEnd().endsWith(block.trimEnd())).toBe(true);
  });

  it('never scrolls inside itself at desktop heights', () => {
    const rules = topLevel(block);
    const desktop = rules.filter((rule) => !rule.prelude.startsWith('@media'));
    const panel = desktop.find((rule) => rule.prelude === '.account-menu-panel');
    expect(panel?.body).toBeDefined();
    for (const rule of desktop) {
      expect(rule.body, rule.prelude).not.toMatch(/max-height|overflow(-y)?\s*:\s*(auto|scroll)/);
    }
    // A height limit exists only for a screen too short to show it all, or the phone sheet,
    // and it is always the whole screen less a small offset, never a fraction of it.
    const limited = rules.filter((rule) => /max-height\s*:/.test(rule.body));
    expect(limited.map((rule) => rule.prelude).sort()).toEqual([PHONE, SHORT].sort());
    for (const rule of limited) {
      for (const [, value] of rule.body.matchAll(/max-height\s*:\s*([^;]+);/g)) {
        expect(value).toMatch(/^calc\(100dvh - (?!.*(?:vh|%))[\w(),\s-]+\)$/);
      }
    }
    // The old menu rule with a fixed share of the screen is gone from the whole stylesheet.
    expect(css).not.toMatch(/\.record-account nav \{/);
    expect(css).not.toContain('max-height: 65dvh');
  });

  it('opens as a bottom sheet on a phone, clear of the home indicator', () => {
    const phone = topLevel(block).find((rule) => rule.prelude === PHONE)?.body ?? '';
    expect(phone).toMatch(/\.account-menu-panel \{[^}]*position: fixed;/);
    expect(phone).toMatch(/\.account-menu-panel \{[^}]*env\(safe-area-inset-bottom/);
    expect(phone).toMatch(/\.account-menu-close \{\s*display: inline-flex;/);
  });

  it('is flat and uses the shared tokens only', () => {
    const body = block.replaceAll(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/rgba?\(|hsla?\(/);
    expect(body).not.toMatch(/box-shadow|backdrop-filter|gradient\(/);
    expect(body).not.toMatch(/prefers-color-scheme/);
    // Rows keep a 44 pixel tap height and a visible focus ring.
    expect(body).toMatch(
      /\.account-menu-row,\s*\.account-menu-panel \.account-menu-signout button \{[^}]*min-height: 44px;/,
    );
    expect(body).toMatch(
      /\.account-menu-row:focus-visible,[^{]*\{\s*outline: 3px solid var\(--accent\);/,
    );
  });
});
