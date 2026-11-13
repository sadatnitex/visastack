import { describe, expect, it, vi } from 'vitest';

/**
 * Importing the service must not read any table definition. Other packages' tests replace the
 * database package with a smaller one, and the whole service index is imported through it: a
 * column list built when this module loads would break each of those tests before it starts.
 */
vi.mock('../db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db')>()),
  schema: {},
}));

describe('loading What This Change Affects', () => {
  it('reads no table definition until a read runs', async () => {
    const module = await import('./index');
    expect(typeof module.assessDocumentChangeImpact).toBe('function');
    expect(typeof module.assessDetailChangeImpact).toBe('function');
  });
});
