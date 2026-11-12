// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../lib/axe.test-support';
import type { NavLink } from '../../lib/navigation';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/applicant/p1' }));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
const { AppNav, badgeFor } = await import('./app-nav');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LINKS: readonly NavLink[] = [
  { href: '/app/applicant/p1', label: 'Home', exact: true },
  { href: '/app/applicant/p1/documents', label: 'My Documents' },
  { href: '/app/applicant/p1/missions', label: 'My Trips' },
  { href: '/app/applicant/p1/sharing', label: 'Sharing & Requests' },
];

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

const mount = (badges?: Readonly<Record<string, number>>) =>
  act(() =>
    root.render(
      <AppNav links={LINKS} {...(badges ? { badges } : {})}>
        <span />
      </AppNav>,
    ),
  );
const tab = (label: string) =>
  [...container.querySelectorAll<HTMLAnchorElement>('.app-bar a')].find((a) =>
    (a.getAttribute('aria-label') ?? '').startsWith(label),
  );

describe('badgeFor', () => {
  it('is nothing at zero, a bad number or no count', () => {
    for (const none of [undefined, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(badgeFor(none)).toBeNull();
    }
  });

  it('shows the number to nine, "9+" above it, and says the real number up to 99', () => {
    expect(badgeFor(1)).toEqual({ shown: '1', spoken: '1' });
    expect(badgeFor(9)).toEqual({ shown: '9', spoken: '9' });
    expect(badgeFor(10)).toEqual({ shown: '9+', spoken: '10' });
    expect(badgeFor(42)).toEqual({ shown: '9+', spoken: '42' });
    expect(badgeFor(100)).toEqual({ shown: '9+', spoken: '99+' });
  });
});

describe('the count on a tab', () => {
  it('draws nothing, and keeps the plain name, when there are no counts', () => {
    mount();
    expect(container.querySelector('.app-tab-badge')).toBeNull();
    expect(tab('Sharing & Requests')?.getAttribute('aria-label')).toBe('Sharing & Requests');
  });

  it('puts the number in the tab, hides it from readers, and says it in the name', () => {
    mount({ '/app/applicant/p1/sharing': 3, '/app/applicant/p1': 12 });
    const sharing = tab('Sharing & Requests');
    expect(sharing?.getAttribute('aria-label')).toBe('Sharing & Requests, 3 new');
    const badge = sharing?.querySelector('.app-tab-badge');
    expect(badge?.textContent).toBe('3');
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(tab('Home')?.getAttribute('aria-label')).toBe('Home, 12 new');
    expect(tab('Home')?.querySelector('.app-tab-badge')?.textContent).toBe('9+');
  });

  it('leaves a tab with a zero alone', () => {
    mount({ '/app/applicant/p1/sharing': 0, '/app/applicant/p1/documents': 2 });
    expect(tab('Sharing & Requests')?.querySelector('.app-tab-badge')).toBeNull();
    expect(tab('My Documents')?.getAttribute('aria-label')).toBe('My Documents, 2 new');
  });

  it('has no accessibility violations with counts showing', async () => {
    mount({ '/app/applicant/p1/sharing': 3 });
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });
});

describe('badgeFor digits follow the language', () => {
  it('writes the visible and spoken count in Bengali digits under bn', () => {
    expect(badgeFor(3, 'bn')).toEqual({ shown: '৩', spoken: '৩' });
    expect(badgeFor(42, 'bn')).toEqual({ shown: '৯+', spoken: '৪২' });
    expect(badgeFor(100, 'bn')).toEqual({ shown: '৯+', spoken: '৯৯+' });
  });
  it('keeps Latin digits under en', () => {
    expect(badgeFor(3, 'en')).toEqual({ shown: '3', spoken: '3' });
  });
});
