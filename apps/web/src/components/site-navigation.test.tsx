// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
const state = vi.hoisted(() => ({ pathname: '/' }));

import { I18nProvider } from './i18n-provider';
import { SiteNavigation } from './site-navigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  state.pathname = '/';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <I18nProvider locale="en" pageLang="en">
        <button type="button" id="outside">
          Outside
        </button>
        <SiteNavigation
          group={{
            label: 'How It Works',
            currentRoutes: ['/how-it-works', '/trust'],
            items: [
              { href: '/#prepare', label: 'Prepare a Case', description: 'See what to review.' },
              {
                href: '/trust',
                label: 'Privacy and Control',
                description: 'See access.',
                wideOnly: true,
              },
            ],
          }}
          pages={[{ href: '/countries', route: '/countries', label: 'Country Guides' }]}
          actions={<a href="/app">Sign In</a>}
        />
      </I18nProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const toggle = () => container.querySelector('.site-nav-group-toggle') as HTMLButtonElement;
const group = () => container.querySelector('.site-nav-group') as HTMLElement;

describe('the How It Works menu in the public header (LAND1)', () => {
  it('starts closed and opens and closes from its own button', () => {
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    act(() => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(group().getAttribute('data-open')).toBe('true');
    act(() => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape and returns focus to its button', () => {
    act(() => toggle().click());
    const entry = container.querySelector('.site-nav-group-panel a') as HTMLAnchorElement;
    act(() => entry.focus());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(group().getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(toggle());
  });

  it('closes on a press outside it, and not on a press inside', () => {
    act(() => toggle().click());
    act(() => {
      container
        .querySelector('.site-nav-group-panel')
        ?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(group().getAttribute('data-open')).toBe('true');
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(group().getAttribute('data-open')).toBe('false');
  });

  it('closes when a choice is made', () => {
    act(() => toggle().click());
    const entry = container.querySelector('.site-nav-group-panel a') as HTMLAnchorElement;
    entry.addEventListener('click', (event) => event.preventDefault());
    act(() => entry.click());
    expect(group().getAttribute('data-open')).toBe('false');
  });

  it('closes when keyboard focus moves out of the menu', () => {
    act(() => toggle().click());
    act(() => toggle().focus());
    act(() => (document.getElementById('outside') as HTMLButtonElement).focus());
    expect(group().getAttribute('data-open')).toBe('false');
  });

  it('marks itself while one of its pages is open, and not on other pages', () => {
    expect(toggle().getAttribute('data-current')).toBeNull();
    state.pathname = '/trust';
    act(() =>
      root.render(
        <I18nProvider locale="en" pageLang="en">
          <SiteNavigation
            group={{
              label: 'How It Works',
              currentRoutes: ['/how-it-works', '/trust'],
              items: [{ href: '/trust', label: 'Privacy and Control', description: 'See access.' }],
            }}
            pages={[]}
            actions={null}
          />
        </I18nProvider>,
      ),
    );
    expect(toggle().getAttribute('data-current')).toBe('true');
  });

  it('keeps the entries that the phone menu leaves out marked, so the stylesheet can hide them', () => {
    const wide = container.querySelector('.site-nav-group-panel a.site-nav-wide-only');
    expect(wide?.textContent).toContain('Privacy and Control');
    expect(container.querySelectorAll('.site-nav-group-panel a')).toHaveLength(2);
  });
});
