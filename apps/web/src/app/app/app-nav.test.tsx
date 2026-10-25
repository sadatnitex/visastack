// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAccess } from '../../lib/workspace-navigation';

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
}));
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
});

const chip = () =>
  container.querySelector<HTMLDetailsElement>('.workspace-toolbar .workspace-chip');
const more = () => container.querySelector<HTMLButtonElement>('.app-more-toggle');

describe('phone navigation and the context chip (WP-X3)', () => {
  it('keeps four links on the bar and opens the rest from More', () => {
    mount(FULL);
    expect(container.querySelectorAll('.app-bar .app-shell-links a').length).toBeLessThanOrEqual(4);
    expect(more()?.getAttribute('aria-expanded')).toBe('false');
    act(() => more()?.click());
    expect(more()?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.app-more .app-mobile-identity')).not.toBeNull();
  });

  it('shows who you are acting as in the top bar without opening More', () => {
    mount(FULL);
    expect(more()?.getAttribute('aria-expanded')).toBe('false');
    const summary = chip()?.querySelector('summary');
    expect(summary?.textContent).toContain('Synthetic Self');
    // The same places to switch to as the full selector, from the same data.
    const links = [...(chip()?.querySelectorAll('nav a') ?? [])].map((a) => a.getAttribute('href'));
    const full = [
      ...(container.querySelectorAll('.app-mobile-identity .workspace-selector nav a') ?? []),
    ].map((a) => a.getAttribute('href'));
    expect(links).toEqual(full);
    expect(links).toContain(`/app/applicant/${SELF}`);
    expect(links).toContain('/app/agency/20000000-0000-4000-8000-000000000001');
  });

  it('closes on Escape and returns focus to the chip', () => {
    mount(FULL);
    const details = chip();
    const summary = details?.querySelector<HTMLElement>('summary');
    act(() => {
      if (details) details.open = true;
      details?.querySelector('a')?.focus();
    });
    act(() => {
      details
        ?.querySelector('a')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(details?.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('a person with no traveller access still gets an empty list, granting nothing', () => {
    mount(NONE);
    expect(chip()).not.toBeNull();
    expect(chip()?.querySelectorAll('nav a')).toHaveLength(0);
  });
});
