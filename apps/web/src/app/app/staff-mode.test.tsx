// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../lib/axe.test-support';
import type { WorkspaceAccess } from '../../lib/workspace-navigation';

const route = vi.hoisted(() => ({ pathname: '/app/admin' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const { WorkspaceShell } = await import('./workspace-shell');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SELF = '10000000-0000-4000-8000-000000000001';
const CHILD = '10000000-0000-4000-8000-000000000002';
const STAFF: WorkspaceAccess = {
  travellers: [
    { id: SELF, name: 'Synthetic Self', relationship: 'SELF' },
    { id: CHILD, name: 'Synthetic Child', relationship: 'CHILD' },
  ],
  agencies: [{ id: 'agency-1', name: 'Synthetic Agency', admin: true }],
  platform: { owner: true, ai: true, complaints: true, audit: true, privacy: true },
};

let root: Root;
let container: HTMLDivElement;
function mount(pathname: string, sidebarState: 'expanded' | 'collapsed' = 'expanded') {
  route.pathname = pathname;
  act(() =>
    root.render(
      <WorkspaceShell
        access={STAFF}
        accountName="Synthetic Staff Member"
        accountEmail="synthetic.staff@example.test"
        sidebarState={sidebarState}
        toolbarState={{
          unread: 1,
          personalPlan: { key: 'traveller_free', name: 'Traveller Free' },
          agencyPlans: [],
        }}
        signOut={
          <form>
            <button type="submit">Sign Out</button>
          </form>
        }
      >
        <section className="section container">
          <h1>Page</h1>
        </section>
      </WorkspaceShell>,
    ),
  );
}
/** A laptop-wide window (the slim rail exists) or a phone. */
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
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const text = () => container.textContent ?? '';
const banner = () => container.querySelector<HTMLElement>('section.staff-mode-banner');

describe('staff mode on platform pages (owner list item 18)', () => {
  it('says plainly, at the top of the page, that this is staff mode, with a way out', () => {
    mount('/app/admin');
    expect(banner()?.getAttribute('aria-label')).toBe('Staff Mode');
    expect(banner()?.textContent).toContain('Staff Mode.');
    expect(banner()?.textContent).toContain('You are using platform tools.');
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe('/app');
    expect(banner()?.querySelector('a')?.textContent).toBe('Leave Staff Mode');
    // Before the page itself, straight under the toolbar.
    const main = container.querySelector('.app-main');
    expect(main?.children[1]).toBe(banner());
    expect(container.querySelector('[data-workspace]')?.getAttribute('data-workspace')).toBe(
      'platform',
    );
  });

  it('keeps traveller names, the traveller search and the personal plan off platform screens', () => {
    for (const sidebar of ['expanded', 'collapsed'] as const) {
      mount('/app/admin/organizations', sidebar);
      expect(text()).not.toContain('Synthetic Child');
      // The only name shown is the signed-in person's own, in their account menu.
      expect(text()).not.toMatch(/Synthetic Self/);
      expect(container.querySelector('a[href^="/app/applicant/"]')).toBeNull();
      expect(text()).not.toMatch(/your (own )?records?/i);
      expect(text()).not.toContain('You Control Access');
      expect(container.querySelector('search, .record-search-toggle')).toBeNull();
      expect(container.querySelector('.record-plan-badge')).toBeNull();
      expect(text()).not.toContain('Traveller Free');
      // The way back to the account's own travellers is the Account Overview, not a list of names.
      const lists = [...container.querySelectorAll('nav[aria-label="Available workspaces"]')];
      expect(lists.length).toBeGreaterThan(0);
      for (const list of lists) {
        expect([...list.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
          '/app',
          '/app/agency/agency-1',
          '/app/admin',
        ]);
      }
      expect(text()).toContain('Platform tools for VisaStack staff.');
    }
  });

  it('leaves traveller pages exactly as they were: no staff banner, travellers listed by name', () => {
    mount(`/app/applicant/${SELF}`);
    expect(banner()).toBeNull();
    expect(container.querySelector(`a[href="/app/applicant/${CHILD}"]`)?.textContent).toBe(
      'Synthetic Child',
    );
    expect(text()).toContain('You Control Access');
    expect(container.querySelector('.record-search-toggle')).not.toBeNull();
    expect(container.querySelector('.record-plan-badge')?.textContent).toBe('Traveller Free');
  });

  it('shows no staff banner on a platform address the account cannot use', () => {
    route.pathname = '/app/admin';
    act(() =>
      root.render(
        <WorkspaceShell
          access={{ ...STAFF, platform: null }}
          accountName="Synthetic Self"
          signOut={<span />}
        >
          <p>Page</p>
        </WorkspaceShell>,
      ),
    );
    expect(banner()).toBeNull();
    expect(text()).toContain('Platform Access Unavailable');
  });
});

describe('every icon-only control in the signed-in frame has a name (owner list item 13)', () => {
  const states = [
    ['a traveller page, full sidebar', `/app/applicant/${SELF}`, 'expanded', true],
    ['a traveller page, slim rail', `/app/applicant/${SELF}`, 'collapsed', true],
    ['an agency page on a phone', '/app/agency/agency-1', 'expanded', false],
    ['a platform page, full sidebar', '/app/admin', 'expanded', true],
    ['a platform page on a phone', '/app/admin', 'expanded', false],
  ] as const;
  for (const [name, pathname, sidebar, laptop] of states) {
    it(`passes the automated accessibility rules on ${name}`, async () => {
      setWindow(laptop);
      mount(pathname, sidebar);
      // Whole frame: the sidebar or bottom bar, toolbar, account menu and staff banner.
      expect(await axeViolations(container.innerHTML)).toEqual([]);
      const unnamed = [
        ...container.querySelectorAll<HTMLElement>('a[href], button, summary'),
      ].filter(
        (control) =>
          !control.getAttribute('aria-label')?.trim() &&
          !control.getAttribute('aria-labelledby') &&
          !control.textContent?.trim(),
      );
      expect(unnamed.map((control) => control.outerHTML.slice(0, 120))).toEqual([]);
    });
  }
});

describe('staff mode changes only platform pages', () => {
  const PHOTO = '/api/photos/applicant/self?v=1';
  function mountWith(pathname: string, access: WorkspaceAccess) {
    route.pathname = pathname;
    act(() =>
      root.render(
        <WorkspaceShell access={access} accountName="Synthetic Self" signOut={<span />}>
          <p>Page</p>
        </WorkspaceShell>,
      ),
    );
  }
  const sidebarSelector = () =>
    container.querySelector<HTMLElement>('.app-shell-nav > .workspace-selector');

  it('keeps the traveller sidebar as before: their photo, their name and every traveller listed', () => {
    const access: WorkspaceAccess = {
      ...STAFF,
      travellers: [
        { id: SELF, name: 'Synthetic Self', relationship: 'SELF', photo: PHOTO },
        { id: CHILD, name: 'Synthetic Child', relationship: 'CHILD' },
      ],
    };
    mountWith(`/app/applicant/${SELF}`, access);
    const selector = sidebarSelector();
    expect(selector?.querySelector('img')?.getAttribute('src')).toBe(PHOTO);
    expect(selector?.querySelector('summary b')?.textContent).toBe('Synthetic Self');
    expect(
      [...(selector?.querySelectorAll('nav a') ?? [])].map((link) => link.getAttribute('href')),
    ).toEqual([
      `/app/applicant/${SELF}`,
      `/app/applicant/${CHILD}`,
      '/app/agency/agency-1',
      '/app/admin',
    ]);
  });

  it('keeps the agency sidebar as before: the agency name, initials and every place listed', () => {
    mountWith('/app/agency/agency-1', STAFF);
    const selector = sidebarSelector();
    expect(selector?.querySelector('summary b')?.textContent).toBe('Synthetic Agency');
    expect(selector?.querySelector('img')).toBeNull();
    expect(selector?.querySelector(`nav a[href="/app/applicant/${CHILD}"]`)?.textContent).toBe(
      'Synthetic Child',
    );
  });
});

describe('the search shortcut (Ctrl or Cmd and K)', () => {
  const press = (key: { ctrlKey?: boolean; metaKey?: boolean }) => {
    const event = new KeyboardEvent('keydown', { key: 'k', cancelable: true, ...key });
    act(() => {
      document.dispatchEvent(event);
    });
    return event;
  };
  const searchOpen = () =>
    container.querySelector('header.record-toolbar')?.getAttribute('data-search-open');

  it('is left to the browser on staff pages, which have no traveller search', () => {
    mount('/app/admin');
    for (const key of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(press(key).defaultPrevented).toBe(false);
      expect(searchOpen()).toBe('false');
    }
  });

  it('still opens the search on traveller pages', () => {
    mount(`/app/applicant/${SELF}`);
    expect(press({ ctrlKey: true }).defaultPrevented).toBe(true);
    expect(searchOpen()).toBe('true');
  });
});
