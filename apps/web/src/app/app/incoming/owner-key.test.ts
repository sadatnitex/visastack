import { describe, expect, it } from 'vitest';
import { shareOwnerKey } from './owner-key';

const A = '0b6f1c2e-6d4f-4c1a-9a51-3c1f0e7d2a11';
const B = '7e2d9a40-1b3c-4f5e-8a6b-9c0d1e2f3a4b';

describe('the shared-files owner key', () => {
  it('is the same for one account and different for another', () => {
    const a = shareOwnerKey(A);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(shareOwnerKey(A)).toBe(a);
    expect(shareOwnerKey(B)).not.toBe(a);
  });

  it('never contains the account id', () => {
    expect(shareOwnerKey(A)).not.toContain(A.slice(0, 8));
  });

  it('is null without an account, so nothing can be read', () => {
    expect(shareOwnerKey('')).toBeNull();
  });
});
