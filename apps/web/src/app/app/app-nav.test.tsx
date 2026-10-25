// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAccess } from '../../lib/workspace-navigation';

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
  route.pathname = '/app';
});

const chip = () =>
  container.querySelector<HTMLDetailsElement>('.workspace-toolbar .workspace-chip');
const more = () => container.querySelector<HTMLButtonElement>('.app-more-toggle');

describe('phone navigation and the context chip (WP-X3)', () => {
  it('keeps four links on the bar and opens the rest from More', () => {
    mount(FULL);
    const barLinks = container.querySelectorAll('.app-bar .app-shell-links a');
    expect(barLinks).toHaveLength(4);
    expect(more()?.getAttribute('aria-expanded')).toBe('false');
    act(() => more()?.click());
    expect(more()?.getAttribute('aria-expanded')).toBe('true');
    // The rest of the destinations are in the sheet, none repeated from the bar.
    const sheetLinks = [...container.querySelectorAll('.app-more .app-shell-links-more a')];
    expect(sheetLinks.length).toBeGreaterThan(0);
    const barHrefs = new Set([...barLinks].map((a) => a.getAttribute('href')));
    for (const link of sheetLinks) expect(barHrefs.has(link.getAttribute('href'))).toBe(false);
  });

  it('shows who you are acting as in the top bar without opening More', () => {
    mount(FULL);
    expect(more()?.getAttribute('aria-expanded')).toBe('false');
    const summary = chip()?.querySelector('summary');
    expect(summary?.textContent).toContain('Synthetic Self');
    // Visible: the first name. Read aloud: who you are acting as, in full, and where.
    expect(summary?.querySelector('b')?.textContent).toBe('Synthetic');
    expect(summary?.querySelector('.workspace-avatar')?.getAttribute('aria-hidden')).toBe('true');
    expect(summary?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Synthetic Self, acting as this person, Personal space',
    );
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

  it('closes when someone taps elsewhere, so it never sits over another menu', () => {
    mount(FULL);
    const details = chip();
    act(() => {
      if (details) details.open = true;
    });
    act(() => {
      more()?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(details?.open).toBe(false);
  });

  it('labels an agency by its full name and the platform by what it is', () => {
    act(() => root.render(<span />));
    const agencyAccess: WorkspaceAccess = {
      ...FULL,
      agencies: [
        { id: '20000000-0000-4000-8000-000000000001', name: 'The Global Visa Ltd', admin: true },
      ],
    };
    route.pathname = '/app/agency/20000000-0000-4000-8000-000000000001';
    mount(agencyAccess);
    expect(chip()?.querySelector('b')?.textContent).toBe('The Global Visa Ltd');
    route.pathname = '/app/admin';
    act(() => root.render(<span />));
    mount({ ...FULL, platform: { owner: true, ai: false, complaints: false } });
    expect(chip()?.querySelector('b')?.textContent).toBe('Platform');
    expect(chip()?.querySelector('summary')?.textContent).toContain('Platform operations');
    expect(chip()?.querySelector('.workspace-avatar')).toBeNull();
  });

  it('stays open when a choice inside its own list is tapped', () => {
    mount(FULL);
    const details = chip();
    act(() => {
      if (details) details.open = true;
    });
    act(() => {
      details?.querySelector('nav a')?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(details?.open).toBe(true);
  });

  it('reads the full context aloud without repeating the visible words', () => {
    route.pathname = '/app/agency/20000000-0000-4000-8000-000000000001';
    mount(FULL);
    expect(chip()?.querySelector('summary')?.textContent).toBe(
      'Synthetic Agency, current workspace: Agency workspace',
    );
  });
});

describe('the chip is a phone-only part of the stylesheet', () => {
  it('is hidden by default and shown below the sidebar breakpoint', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/src/app/globals.css`, 'utf8');
    expect(css).toMatch(/\.workspace-chip \{\s*display: none;/);
    expect(css).toMatch(/@media \(max-width: 1023px\) \{\s*\.workspace-chip \{\s*display: block;/);
    // The open list must sit above the phone search panel, or search covers it.
    const listLayer = Number(/\.workspace-chip nav \{[^}]*z-index: (\d+)/.exec(css)?.[1]);
    const searchLayers = [...css.matchAll(/\.record-search \{[^}]*z-index: (\d+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(searchLayers.length).toBeGreaterThan(0);
    expect(listLayer).toBeGreaterThan(Math.max(...searchLayers));
  });
});
