import { describe, expect, it, vi } from 'vitest';
import { unregisterAll } from './runtime';
import { SHARE_INBOX_CACHE } from './share-target';

describe('switching the worker off on a device', () => {
  it('also removes shared files still waiting in the inbox', async () => {
    const container = {
      getRegistrations: vi.fn(async () => [{ unregister: vi.fn(async () => true) }]),
    } as unknown as ServiceWorkerContainer;
    const names = new Set([SHARE_INBOX_CACHE, 'visastack-static-build-1', 'other']);
    await unregisterAll(container, {
      keys: async () => [...names],
      delete: async (name: string) => names.delete(name),
    });
    expect([...names]).toEqual(['other']);
  });
});
