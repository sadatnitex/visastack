declare global {
  interface Window {
    /** Every address a fixture's router was asked to go to, in order (push and replace). */
    __uiFixtureNavigations?: string[];
  }
}

export function usePathname(): string {
  return window.__uiFixturePath ?? '/app';
}

/** The event a fixture's router fires after it moves the address, for a fixture to listen to. */
export const FIXTURE_NAVIGATE_EVENT = 'ui-fixture-navigate';

/**
 * Layout fixtures have no server route to fetch: refresh only tells the page, and push or replace
 * move the address bar (history only, no page load) and say so, so a test can see where a link
 * would have gone.
 */
export function useRouter() {
  const move = (mode: 'pushState' | 'replaceState') => (href: string) => {
    window.history[mode](null, '', href);
    window.__uiFixtureNavigations = [...(window.__uiFixtureNavigations ?? []), href];
    window.dispatchEvent(new Event(FIXTURE_NAVIGATE_EVENT));
  };
  return {
    refresh: () => window.dispatchEvent(new Event('ui-fixture-refresh')),
    push: move('pushState'),
    replace: move('replaceState'),
  };
}
