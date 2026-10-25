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

  it('puts Home, Record, Cases and Sharing on the phone bar, and the rest under More', () => {
    mount(FULL);
    expect(labelsOf('.app-bar .app-shell-links a')).toEqual(['Home', 'Record', 'Cases', 'Sharing']);
    expect(labelsOf('.app-more .app-shell-links-more a')).toEqual(['Notifications', 'Countries']);
    const tools = [...container.querySelectorAll('.workspace-tools nav a')].map(
      (a) => a.textContent,
    );
    expect(tools).toContain('Account and Permissions');
    expect(tools).not.toContain('Account Overview');
  });

  it('marks Record as the current tab on each of its sections, and no other tab', () => {
    for (const section of ['record', 'profile', 'documents', 'expiry', 'history']) {
      act(() => root.render(<span />));
      route.pathname = `/app/applicant/${SELF}/${section}`;
      mount(FULL);
      const current = [...container.querySelectorAll('.app-shell-links a[aria-current="page"]')];
      expect(
        current.map((a) => a.getAttribute('aria-label')),
        section,
      ).toEqual(['Record']);
    }
  });

  it('with no traveller yet there is no Record or Cases tab to open, only Home and Add a Traveller', () => {
    mount(NONE);
    expect(labelsOf('.app-bar .app-shell-links a')).toEqual([
      'Home',
      'Add a Traveller',
      'Notifications',
      'Countries',
    ]);
  });

  it('on the account page only Home is current, though Account and Permissions opens it too', () => {
    for (const access of [FULL, NONE]) {
      act(() => root.render(<span />));
      route.pathname = '/app';
      mount(access);
      const current = [...container.querySelectorAll('.app-shell-nav a[aria-current="page"]')];
      expect(current.map((a) => a.textContent?.trim())).toHaveLength(1);
      expect(current[0]?.getAttribute('aria-label')).toBe('Home');
      const tool = [...container.querySelectorAll('.workspace-tools nav a')].find(
        (a) => a.textContent === 'Account and Permissions',
      );
      expect(tool?.getAttribute('href')).toBe('/app#permissions');
    }
  });
});
