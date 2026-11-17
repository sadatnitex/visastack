import { describe, expect, it } from 'vitest';
import { shareOwnerKey } from './owner-key';

const SECRET = 'a'.repeat(64);
const env = (secret: string | undefined) => (name: string) =>
  name === 'NEON_AUTH_COOKIE_SECRET' ? secret : undefined;

describe('the shared-files owner key', () => {
  it('is the same for one account and different for another', () => {
    const a = shareOwnerKey('account-a', env(SECRET));
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(shareOwnerKey('account-a', env(SECRET))).toBe(a);
    expect(shareOwnerKey('account-b', env(SECRET))).not.toBe(a);
  });

  it('never contains the account id and changes with the secret', () => {
    const a = shareOwnerKey('account-a', env(SECRET));
    expect(a).not.toContain('account');
    expect(shareOwnerKey('account-a', env('b'.repeat(64)))).not.toBe(a);
  });

  it('is null without a usable secret or account, so nothing can be read', () => {
    expect(shareOwnerKey('account-a', env(undefined))).toBeNull();
    expect(shareOwnerKey('account-a', env('short'))).toBeNull();
    expect(shareOwnerKey('', env(SECRET))).toBeNull();
  });
});
