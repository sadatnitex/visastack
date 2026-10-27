import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => ({
  read: (_name: string): { value: string } | undefined => undefined,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: jar.read }) }));
const { getSidebarState } = await import('./sidebar-state');

beforeEach(() => {
  jar.read = () => undefined;
});

describe('the sidebar state the layout reads', () => {
  it('is open without a cookie and collapsed only for the exact word', async () => {
    expect(await getSidebarState()).toBe('expanded');
    jar.read = (name) => (name === 'visastack_sidebar' ? { value: 'collapsed' } : undefined);
    expect(await getSidebarState()).toBe('collapsed');
    jar.read = () => ({ value: 'nonsense' });
    expect(await getSidebarState()).toBe('expanded');
  });

  it('is open, and never throws, when there is no request to read', async () => {
    jar.read = () => {
      throw new Error('cookies was called outside a request scope');
    };
    expect(await getSidebarState()).toBe('expanded');
  });
});
