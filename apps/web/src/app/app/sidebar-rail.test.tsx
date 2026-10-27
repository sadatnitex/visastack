// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAccess } from '../../lib/workspace-navigation';

const route = vi.hoisted(() => ({ pathname: '/app' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const { WorkspaceShell } = await import('./workspace-shell');
const { AppNav } = await import('./app-nav');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SELF = '10000000-0000-4000-8000-000000000001';
const ACCESS: WorkspaceAccess = {
  travellers: [{ id: SELF, name: 'Synthetic Self', relationship: 'SELF' }],
  agencies: [],
  platform: null,
};

let root: Root;
let container: HTMLDivElement;
function mount(sidebarState?: 'expanded' | 'collapsed') {
  act(() =>
    root.render(
      <WorkspaceShell
        access={ACCESS}
        accountName="Synthetic Self"
        signOut={<span />}
        {...(sidebarState ? { sidebarState } : {})}
      >
        <p>Page</p>
      </WorkspaceShell>,
    ),
  );
}
/** A laptop-wide window (the rail exists) or a narrower one (the bottom bar). */
function setWindow(laptop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: laptop && query === '(min-width: 1024px)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
beforeEach(() => {
  setWindow(true);
  vi.stubGlobal('fetch', vi.fn());
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  route.pathname = '/app';
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.cookie = 'visastack_sidebar=; path=/; max-age=0';
});

const frame = () => container.querySelector<HTMLElement>('.app-frame');
const toggle = () => container.querySelector<HTMLButtonElement>('.app-sidebar-toggle');
const selector = () =>
  container.querySelector<HTMLDetailsElement>('.app-shell-nav > .workspace-selector');
const tools = () => container.querySelector<HTMLDetailsElement>('.workspace-tools');

describe('the Hide Menu and Show Menu button', () => {
  it('is a real button with a plain name, its state and the sidebar it controls', () => {
    mount();
    const button = toggle();
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.getAttribute('aria-label')).toBe('Hide Menu');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    const controlled = document.getElementById(button?.getAttribute('aria-controls') ?? '');
    expect(controlled?.classList.contains('app-shell-nav')).toBe(true);
    expect(frame()?.getAttribute('data-sidebar')).toBe('expanded');
  });

  it('switches to a slim rail and back, keeps keyboard focus on itself, and remembers the choice', () => {
    const written: string[] = [];
    vi.spyOn(document, 'cookie', 'set').mockImplementation((value) => {
      written.push(value);
    });
    mount();
    const button = toggle();
    act(() => button?.focus());
    act(() => button?.click());
    expect(frame()?.getAttribute('data-sidebar')).toBe('collapsed');
    // The same element stays, so focus is never lost or moved.
    expect(toggle()).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button?.getAttribute('aria-label')).toBe('Show Menu');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    // One small cookie for the signed-in area, readable by the server for the first paint.
    expect(written.at(-1)).toMatch(
      /^visastack_sidebar=collapsed; path=\/app; max-age=31536000; SameSite=Lax/,
    );
    act(() => button?.click());
    expect(frame()?.getAttribute('data-sidebar')).toBe('expanded');
    expect(button?.getAttribute('aria-label')).toBe('Hide Menu');
    expect(written.at(-1)).toMatch(/^visastack_sidebar=expanded; path=\/app;/);
  });

  it('starts as a rail when the layout read a collapsed cookie, with no toggle needed first', () => {
    mount('collapsed');
    expect(frame()?.getAttribute('data-sidebar')).toBe('collapsed');
    expect(toggle()?.getAttribute('aria-label')).toBe('Show Menu');
  });

  it('still works when the browser refuses to store the choice', () => {
    vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      throw new Error('cookies blocked');
    });
    mount();
    act(() => toggle()?.click());
    expect(frame()?.getAttribute('data-sidebar')).toBe('collapsed');
  });

  it('is absent where the sidebar is fixed open', () => {
    act(() =>
      root.render(
        <AppNav links={[{ href: '/app', label: 'Overview', exact: true }]}>
          <span />
        </AppNav>,
      ),
    );
    expect(toggle()).toBeNull();
  });
});

describe('the saved rail only matters on a laptop or larger', () => {
  it('leaves the lists ordinary and fully named on a narrower window', () => {
    setWindow(false);
    route.pathname = '/app/shared';
    mount('collapsed');
    expect(selector()?.querySelector('summary')?.getAttribute('aria-label')).toBeNull();
    expect(tools()?.querySelector('summary')?.getAttribute('aria-label')).toBeNull();
    // The contextual page is still shown open, as before the rail existed.
    expect(tools()?.open).toBe(true);
  });
});

describe('the label beside a rail control can be put away', () => {
  it('hides on Escape and returns when focus reaches another control', () => {
    mount('collapsed');
    const links = [...container.querySelectorAll<HTMLAnchorElement>('.app-bar a')];
    act(() => links[0]?.focus());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(frame()?.getAttribute('data-tips-dismissed')).toBe('true');
    act(() => links[1]?.focus());
    expect(frame()?.hasAttribute('data-tips-dismissed')).toBe(false);
  });
});

describe('the slim rail keeps every destination reachable and named', () => {
  it('gives every link its name whether or not the label shows', () => {
    mount();
    const names = () =>
      [
        ...container.querySelectorAll(
          '.app-shell-nav .app-shell-links:not(.workspace-tools-list) a',
        ),
      ]
        .map((link) => link.getAttribute('aria-label'))
        .filter(Boolean);
    const full = names();
    expect(full.length).toBeGreaterThan(0);
    act(() => toggle()?.click());
    expect(names()).toEqual(full);
  });

  it('names the workspace switch itself, because only its avatar shows', () => {
    mount();
    expect(selector()?.querySelector('summary')?.getAttribute('aria-label')).toBeNull();
    act(() => toggle()?.click());
    expect(selector()?.querySelector('summary')?.getAttribute('aria-label')).toBe(
      'Synthetic Self, Personal Space, Switch Workspace',
    );
  });

  it('keeps More Tools reachable as a popover that closes like one', () => {
    route.pathname = '/app/shared';
    mount();
    // Open in place where the current page is one of its tools, as before.
    expect(tools()?.open).toBe(true);
    act(() => toggle()?.click());
    const popover = tools();
    expect(popover?.open).toBe(false);
    expect(popover?.querySelector('summary')?.getAttribute('aria-label')).toBe('More Tools');
    expect(popover?.querySelectorAll('nav a').length).toBeGreaterThan(0);
    // Outside tap closes it; Escape closes it and returns to its button.
    act(() => {
      if (popover) popover.open = true;
    });
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(popover?.open).toBe(false);
    act(() => {
      if (popover) popover.open = true;
      popover?.querySelector('a')?.focus();
    });
    act(() => {
      popover
        ?.querySelector('a')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(popover?.open).toBe(false);
    expect(document.activeElement).toBe(popover?.querySelector('summary'));
  });

  it('closes the workspace list on an outside tap beside the rail, as the phone chip does', () => {
    mount('collapsed');
    const list = selector();
    act(() => {
      if (list) list.open = true;
    });
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(list?.open).toBe(false);
  });

  it('keeps the full sidebar list open on an outside tap, as before', () => {
    mount();
    const list = selector();
    act(() => {
      if (list) list.open = true;
    });
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(list?.open).toBe(true);
  });
});

/** The marked stylesheet block for the sidebar and menu placement, ending at the next marked block. */
function shellCss(css: string): string {
  const start = css.indexOf('/* WP-SHELL ');
  if (start < 0) return '';
  const next = css.slice(start + 1).search(/\/\* WP-[A-Z0-9]+/);
  return next < 0 ? css.slice(start) : css.slice(start, start + 1 + next);
}

describe('sidebar rail stylesheet (WP-SHELL)', () => {
  const css = readFileSync(`${process.cwd()}/src/app/globals.css`, 'utf8');
  const block = shellCss(css);
  const body = block.replaceAll(/\/\*[\s\S]*?\*\//g, '');

  it('is one marked block, ahead of the reference codes block, ending at the next marker', () => {
    expect(block.length).toBeGreaterThan(1000);
    expect(css.split('/* WP-SHELL ').length - 1).toBe(1);
    expect(block.slice(1)).not.toMatch(/\/\* WP-[A-Z0-9]+/);
    expect(css.indexOf('/* WP-SHELL ')).toBeLessThan(css.indexOf('/* WP-REF '));
  });

  it('leaves the open sidebar exactly as it was: 16rem wide and the same grid', () => {
    expect(css).toMatch(/--side-width: 16rem;/);
    expect(css).toMatch(
      /\.app-frame \{\s*display: grid;\s*grid-template-columns: var\(--side-width\) minmax\(0, 1fr\);/,
    );
    expect(body).not.toMatch(/--side-width\s*:/);
    // The only grid change is the rail, and it is behind the collapsed state.
    const columns = [...body.matchAll(/([^{}]*)\{[^{}]*grid-template-columns[^}]*\}/g)];
    expect(columns).toHaveLength(1);
    expect(columns[0]?.[1]).toContain('[data-sidebar="collapsed"]');
  });

  it('applies the rail to laptops and larger only, so a phone bar is never touched', () => {
    const outside = body
      .replaceAll(/@media \(min-width: 1024px\) \{[\s\S]*\n\}\n/g, '')
      .replaceAll(/@media \(min-width: 761px\) \{[\s\S]*?\n\}\n/g, '');
    expect(outside).not.toContain('[data-sidebar="collapsed"]');
    expect(body).toMatch(/@media \(min-width: 1024px\) \{[\s\S]*\[data-sidebar="collapsed"\]/);
  });

  it('is flat, uses shared tokens only, and has no motion to switch off', () => {
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/rgba?\(|hsla?\(/);
    expect(body).not.toMatch(/box-shadow|text-shadow|backdrop-filter|gradient\(|filter:/);
    expect(body).not.toMatch(/transition|animation|@keyframes|!important/);
    expect(body).not.toMatch(/prefers-color-scheme/);
  });

  it('keeps the button a 44 pixel target with a hover state, and the focus ring the global one', () => {
    expect(body).toMatch(/\.app-sidebar-toggle \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
    expect(body).toMatch(/\.app-sidebar-toggle:hover \{/);
    expect(body).not.toMatch(/\.app-sidebar-toggle[^{]*\{[^}]*outline:\s*none/);
    // Rail rows stay 44px tall (the base link rule), and the rail column is 44px inside its padding.
    expect(body).toMatch(/--side-rail-width: 4\.5rem;/);
    expect(body).toMatch(/\.app-shell-nav \{\s*padding: 24px 14px;/);
  });

  it('names each rail control from its accessible name, on hover and on keyboard focus', () => {
    expect(body).toMatch(
      /\[aria-label\]:where\(:hover, :focus-visible\)::after,\s*\.app-frame\[data-sidebar="expanded"\] \.app-sidebar-toggle:where\(:hover, :focus-visible\)::after \{\s*content: attr\(aria-label\);/,
    );
    // The label sits beside the rail and never takes pointer events.
    expect(body).toMatch(/pointer-events: none;/);
  });

  it('makes the account menu compact for a precise pointer and keeps touch rows at 44px', () => {
    const fine = '@media (min-width: 761px) and (hover: hover) and (pointer: fine) {';
    const start = body.indexOf(fine);
    expect(start).toBeGreaterThan(-1);
    // The compact rules sit in this one query, which ends at the next rule at the left margin.
    const rest = body.slice(start + fine.length);
    const compact = rest.slice(0, rest.search(/\n\}\n/));
    expect(compact).toMatch(/width: min\(17\.5rem, calc\(100vw - 1\.5rem\)\);/);
    expect(compact).toMatch(
      /\.account-menu-row,\s*\.account-menu-panel \.account-menu-signout button \{\s*min-height: 34px;/,
    );
    expect(compact).toMatch(/\.account-menu-panel \.account-menu-avatar \{\s*width: 32px;/);
    expect(compact).toMatch(/--account-menu-pad: var\(--space-1\);/);
    // Never below the 24px WCAG 2.2 AA minimum target.
    for (const [, px] of compact.matchAll(/min-height: (\d+)px/g)) {
      expect(Number(px)).toBeGreaterThanOrEqual(24);
    }
    // The compact padding follows the one custom property that Sign Out's pinning reads.
    expect(compact).toMatch(/padding: var\(--account-menu-pad\) var\(--space-2\);/);
    // Outside this query nothing shrinks the rows: the base rule keeps 44px for touch and coarse
    // pointers, and this block never sets a row height anywhere else.
    expect(css).toMatch(
      /\.account-menu-row,\s*\.account-menu-panel \.account-menu-signout button \{[^}]*min-height: 44px;/,
    );
    expect(body.replace(compact, '')).not.toMatch(/\.account-menu-[^{}]*\{[^}]*min-height/);
    // Sign Out stays pinned flush with the panel's own padding, whatever that padding is.
    expect(body).toMatch(
      /\.account-menu-signout \{\s*position: sticky;\s*bottom: calc\(-1 \* var\(--account-menu-pad\)\);\s*margin-bottom: calc\(-1 \* var\(--account-menu-pad\)\);\s*padding-bottom: var\(--account-menu-pad\);/,
    );
  });

  it('places the account menu above or beside its trigger by the measured answer only', () => {
    expect(body).toMatch(
      /\.record-account\[data-placement="above"\] \.account-menu-panel \{\s*top: auto;\s*bottom: calc\(100% \+ var\(--space-2\)\);/,
    );
    expect(body).toMatch(
      /\.record-account\[data-align="start"\] \.account-menu-panel \{\s*right: auto;\s*left: 0;/,
    );
  });
});
