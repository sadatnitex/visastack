// @vitest-environment jsdom
// The four-tab shell (WP-V3 part 2) as a traveller sees it: the phone bar, More, and the Record tab.
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAccess } from '../../../../lib/workspace-navigation';

const route = vi.hoisted(() => ({ pathname: '/app' }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const { WorkspaceShell } = await import('../../workspace-shell');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SELF = '10000000-0000-4000-8000-000000000001';
const FULL: WorkspaceAccess = {
  travellers: [
    { id: SELF, name: 'Synthetic Self', relationship: 'SELF' },
    { id: '10000000-0000-4000-8000-000000000002', name: 'Synthetic Child', relationship: 'CHILD' },
  ],
  agencies: [
    { id: '20000000-0000-4000-8000-000000000001', name: 'Synthetic Agency', admin: false },
  ],
  platform: null,
};
const NONE: WorkspaceAccess = { travellers: [], agencies: [], platform: null };

let root: Root;
let container: HTMLDivElement;
function mount(access: WorkspaceAccess) {
  act(() =>
    root.render(
      <WorkspaceShell access={access} accountName="Synthetic Self" signOut={<span />}>
        <p>Page</p>
      </WorkspaceShell>,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  route.pathname = '/app';
});

describe('the four-tab shell (WP-V3 part 2)', () => {
  const labelsOf = (selector: string) =>
    [...container.querySelectorAll(selector)].map((a) => a.getAttribute('aria-label'));

  it('puts Home and the three entry points on the phone bar, and the rest under More (UMPE P13)', () => {
    mount(FULL);
    expect(labelsOf('.app-bar .app-shell-links a:not(.app-nav-action)')).toEqual([
      'Home',
      'My Documents',
      'My Trips',
      'Sharing & Requests',
    ]);
    expect(labelsOf('.app-more .app-shell-links-more a')).toEqual(['Notifications', 'Countries']);
    const tools = [...container.querySelectorAll('.workspace-tools nav a')].map(
      (a) => a.textContent,
    );
    // The account-wide page keeps its own name, so it is never a second Home.
    expect(tools).toContain('Account Overview');
    // Record and its sections stay one step away.
    expect(tools).toContain('Record');
  });

  it('marks My Documents as the current entry point on each Record section, and nothing else', () => {
    for (const section of ['record', 'profile', 'documents', 'expiry', 'history']) {
      act(() => root.render(<span />));
      route.pathname = `/app/applicant/${SELF}/${section}`;
      mount(FULL);
      const current = [...container.querySelectorAll('.app-shell-links a[aria-current="page"]')];
      expect(
        current.map((a) => a.getAttribute('aria-label')),
        section,
      ).toEqual(['My Documents']);
    }
  });

  it('with no traveller yet there is no Record or Cases tab to open, only the account and Add a Traveller', () => {
    mount(NONE);
    expect(labelsOf('.app-bar .app-shell-links a')).toEqual([
      'Account Overview',
      'Add a Traveller',
      'Notifications',
      'Countries',
    ]);
  });

  it('on the account page only Account Overview is current, never a traveller Home', () => {
    for (const access of [FULL, NONE]) {
      act(() => root.render(<span />));
      route.pathname = '/app';
      mount(access);
      const current = [...container.querySelectorAll('.app-shell-nav a[aria-current="page"]')];
      expect(current).toHaveLength(1);
      expect(current[0]?.textContent).toContain('Account Overview');
      expect(current[0]?.getAttribute('href')).toBe('/app');
    }
  });
});

describe('the three traveller entry points in the shell (UMPE P13)', () => {
  const sidebarOrder = () =>
    [...container.querySelectorAll('.app-bar .app-shell-links a')].map((a) =>
      a.classList.contains('app-nav-action') ? `+ ${a.textContent}` : a.getAttribute('aria-label'),
    );

  it('puts each task right under its destination, in keyboard order', () => {
    mount(FULL);
    // Document order is the Tab order: Home, My Documents, its task, My Trips, its task, Sharing.
    expect(sidebarOrder()).toEqual([
      'Home',
      'My Documents',
      '+ Add Documents',
      'My Trips',
      '+ Start a Trip',
      'Sharing & Requests',
    ]);
    const add = container.querySelector('.app-bar a.app-nav-action');
    expect(add?.getAttribute('href')).toBe(`/app/applicant/${SELF}/documents#add-document`);
  });

  it('lists the same tasks first under More for a phone, named as quick actions', () => {
    mount(FULL);
    const quick = container.querySelector('nav[aria-label="Quick actions"]');
    expect([...(quick?.querySelectorAll('a') ?? [])].map((a) => a.textContent)).toEqual([
      'Add Documents',
      'Start a Trip',
    ]);
    // Before every other destination in the panel (after the workspace switch).
    const rest = container.querySelector('.app-more .app-shell-links-more');
    expect(
      quick && rest ? quick.compareDocumentPosition(rest) & Node.DOCUMENT_POSITION_FOLLOWING : 0,
    ).toBeTruthy();
  });

  it('never marks a task as the current page, and lights My Trips on Group Trips', () => {
    route.pathname = '/app/trips';
    mount(FULL);
    const current = [...container.querySelectorAll('.app-shell-nav a[aria-current="page"]')];
    expect(current.map((a) => a.getAttribute('aria-label'))).toEqual(['My Trips']);
    for (const task of container.querySelectorAll('a.app-nav-action, a.app-nav-action-row')) {
      expect(task.hasAttribute('aria-current')).toBe(false);
    }
  });

  it('marks one link only on a page an entry point and a tool both lead to', () => {
    route.pathname = `/app/applicant/${SELF}/evidence`;
    mount(FULL);
    const current = [...container.querySelectorAll('.app-shell-nav a[aria-current="page"]')];
    expect(current.map((a) => a.getAttribute('aria-label') ?? a.textContent)).toEqual([
      'Sharing & Requests',
    ]);
    // Evidence Requests is still listed under More Tools, by name.
    const tools = [...container.querySelectorAll('.workspace-tools nav a')].map(
      (a) => a.textContent,
    );
    expect(tools).toContain('Evidence Requests');
  });

  it('shows no entry points and no tasks in an agency workspace', () => {
    route.pathname = '/app/agency/20000000-0000-4000-8000-000000000001';
    mount(FULL);
    const labels = [...container.querySelectorAll('.app-shell-nav a')].map(
      (a) => a.getAttribute('aria-label') ?? a.textContent,
    );
    for (const name of ['My Documents', 'My Trips', 'Sharing & Requests', 'Add Documents']) {
      expect(labels).not.toContain(name);
    }
    expect(container.querySelector('nav[aria-label="Quick actions"]')).toBeNull();
  });
});
