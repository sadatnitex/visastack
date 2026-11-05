// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const status = vi.hoisted(() => ({ pending: false }));
vi.mock('next/navigation', () => ({ usePathname: () => '/app' }));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: status.pending }),
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const { LinkPending, RouteProgress } = await import('./link-pending');
const { SubNav } = await import('../app/app/subnav');
const { WorkspaceShell } = await import('../app/app/workspace-shell');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  status.pending = false;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('a tap is answered at once', () => {
  it('marks a link as waiting only while its page is on the way, and says nothing to a screen reader', () => {
    act(() => root.render(<LinkPending />));
    const mark = container.querySelector('.link-pending');
    expect(mark?.getAttribute('data-pending')).toBe('false');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    status.pending = true;
    act(() => root.render(<LinkPending />));
    expect(container.querySelector('.link-pending')?.getAttribute('data-pending')).toBe('true');
    act(() => root.render(<RouteProgress />));
    expect(container.querySelector('.route-progress')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('every section tab carries the mark', () => {
    act(() =>
      root.render(
        <SubNav
          links={[
            { href: '/app/a', label: 'Alpha' },
            { href: '/app/b', label: 'Beta' },
          ]}
        />,
      ),
    );
    const tabs = [...container.querySelectorAll('.subnav a')];
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) expect(tab.querySelector(':scope > .link-pending')).not.toBeNull();
  });

  it('every sidebar link carries the mark, and the shell carries the bar', () => {
    act(() =>
      root.render(
        <WorkspaceShell
          access={{
            travellers: [
              {
                id: '10000000-0000-4000-8000-000000000001',
                name: 'Synthetic Self',
                relationship: 'SELF',
              },
            ],
            agencies: [],
            platform: null,
          }}
          accountName="Synthetic Self"
          signOut={<span />}
        >
          <p>Page</p>
        </WorkspaceShell>,
      ),
    );
    const links = [...container.querySelectorAll('.app-shell-links a')];
    expect(links.length).toBeGreaterThan(4);
    for (const link of links) {
      expect(link.querySelector(':scope > .link-pending'), link.textContent ?? '').not.toBeNull();
    }
    expect(container.querySelectorAll('.route-progress')).toHaveLength(1);
  });
});

describe('the wait is shown, and going back is instant', () => {
  const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
  const block = css.slice(
    css.indexOf('/* WP-PLAIN-SPEED'),
    css.indexOf('/* end WP-PLAIN-SPEED */'),
  );

  it('the mark draws nothing, the tapped link and the bar react to it', () => {
    expect(block).toMatch(/\.link-pending \{\s*display: none;/);
    expect(block).toMatch(/\.app-shell-links a:has\(> \.link-pending\[data-pending="true"\]\)/);
    expect(block).toMatch(/\.subnav a:has\(> \.link-pending\[data-pending="true"\]\)/);
    expect(block).toMatch(
      /body:has\(\.link-pending\[data-pending="true"\]\) \.route-progress \{\s*opacity: 1;/,
    );
    expect(block).toMatch(/prefers-reduced-motion: reduce/);
  });

  it('the browser keeps a shown page for thirty seconds', () => {
    const config = readFileSync(resolve(__dirname, '../../next.config.mjs'), 'utf8');
    expect(config).toMatch(/staleTimes: \{ dynamic: 30, static: 180 \}/);
  });
});
