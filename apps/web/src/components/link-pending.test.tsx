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

describe('the wait is shown', () => {
  const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');
  const block = css.slice(
    css.indexOf('/* WP-PLAIN-SPEED'),
    css.indexOf('/* end WP-PLAIN-SPEED */'),
  );

  it('the mark draws nothing, the tapped link and the bar react to it', () => {
    expect(block).toMatch(/\.link-pending \{\s*display: none;/);
    // A quick action keeps its own lighter look: the row look is for the sidebar's destinations.
    expect(block).toMatch(/a:not\(\.app-nav-action, \.app-nav-action-row\):has\(> \.link-pending/);
    expect(block).toMatch(
      /\.app-shell-links\s+a:not\([^)]*\):has\(> \.link-pending\[data-pending="true"\]\)/,
    );
    expect(block).toMatch(/\.subnav a:has\(> \.link-pending\[data-pending="true"\]\)/);
    expect(block).toMatch(/\.route-progress\[data-active="true"\] \{\s*opacity: 1;/);
    // The page being left gives up its mark while another waits, so two never look selected.
    expect(block).toMatch(
      /\.app-frame:has\(\.link-pending\[data-pending="true"\]\)\s+\.app-shell-links\s+a\[aria-current="page"\]:not\(:has\(> \.link-pending\[data-pending="true"\]\)\)/,
    );
    expect(block).toMatch(/prefers-reduced-motion: reduce/);
  });
});

describe('the bar answers a tap on any link to another page', () => {
  const bar = () => container.querySelector('.route-progress')?.getAttribute('data-active');
  function tap(href: string, init: MouseEventInit = {}, target?: string) {
    const anchor = document.createElement('a');
    anchor.href = href;
    if (target) anchor.target = target;
    container.append(anchor);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    act(() => {
      anchor.dispatchEvent(click);
    });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    // The framework's own link handler cancels the browser's navigation and routes in the page.
    container.addEventListener('click', (event) => event.preventDefault());
    window.history.replaceState({}, '', '/app/here');
    act(() => root.render(<RouteProgress />));
  });
  afterEach(() => vi.useRealTimers());

  it('runs from the tap until the address changes', () => {
    expect(bar()).toBe('false');
    const anchor = document.createElement('a');
    anchor.href = '/app/there';
    container.append(anchor);
    act(() => {
      anchor.click();
    });
    expect(bar()).toBe('true');
    window.history.pushState({}, '', '/app/there');
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(bar()).toBe('false');
  });

  it('never runs for a tap that does not leave the page, or opens elsewhere', () => {
    tap('/app/here');
    expect(bar()).toBe('false');
    tap('https://elsewhere.example/page');
    expect(bar()).toBe('false');
    tap('/app/there', { ctrlKey: true });
    expect(bar()).toBe('false');
    tap('/app/there', {}, '_blank');
    expect(bar()).toBe('false');
    // A file or an export is not a page: the address never changes.
    tap('/app/mission/1/snapshots/2/download');
    expect(bar()).toBe('false');
    tap('/app/privacy/export?format=csv');
    expect(bar()).toBe('false');
    tap('/api/documents/safe-copy');
    expect(bar()).toBe('false');
  });

  it('gives up after a longest wait', () => {
    const anchor = document.createElement('a');
    anchor.href = '/app/slow';
    container.append(anchor);
    act(() => {
      anchor.click();
    });
    expect(bar()).toBe('true');
    act(() => {
      vi.advanceTimersByTime(10_500);
    });
    expect(bar()).toBe('false');
  });
});
