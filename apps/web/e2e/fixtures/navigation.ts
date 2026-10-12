export function usePathname(): string {
  return window.__uiFixturePath ?? '/app';
}

/** Layout fixtures have no server route to fetch; record refresh requests only. */
export function useRouter() {
  return { refresh: () => window.dispatchEvent(new Event('ui-fixture-refresh')) };
}
