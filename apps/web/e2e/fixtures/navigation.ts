export function usePathname(): string {
  return window.__uiFixturePath ?? '/app';
}
