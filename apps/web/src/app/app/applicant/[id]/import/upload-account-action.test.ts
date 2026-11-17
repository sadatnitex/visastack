import { describe, expect, it, vi } from 'vitest';

/*
 * WP-PIC17: the one check before waiting files go out again after a dropped connection. It answers
 * only yes or no, and every doubt (signed out, another account, a failure) is no. Ids are made up.
 */

vi.mock('server-only', () => ({}));
const session = vi.hoisted(() => ({ accountId: 'acc-a' as string | null, fail: false }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { accountId: string }) => Promise<unknown>) => {
    if (session.fail) throw new Error('database down');
    if (session.accountId === null) {
      throw Object.assign(new Error('NEXT_REDIRECT'), {
        digest: 'NEXT_REDIRECT;replace;/auth/sign-in',
      });
    }
    return fn({ accountId: session.accountId });
  },
}));

const { isSameUploadAccountAction } = await import('./upload-account-action');
const { uploadAccountKey } = await import('./upload-account');

describe('isSameUploadAccountAction', () => {
  it('yes only for the key of the account signed in now', async () => {
    session.accountId = 'acc-a';
    session.fail = false;
    const keyA = uploadAccountKey('acc-a') as string;
    expect(await isSameUploadAccountAction(keyA)).toBe(true);
    session.accountId = 'acc-b';
    expect(await isSameUploadAccountAction(keyA)).toBe(false);
  });

  it('no when signed out (the sign-in redirect is never followed), or on any failure', async () => {
    const keyA = uploadAccountKey('acc-a') as string;
    session.accountId = null;
    expect(await isSameUploadAccountAction(keyA)).toBe(false);
    session.accountId = 'acc-a';
    session.fail = true;
    expect(await isSameUploadAccountAction(keyA)).toBe(false);
    session.fail = false;
  });

  it('no for anything that is not a key', async () => {
    session.accountId = 'acc-a';
    for (const value of [undefined, null, 42, '', 'x'.repeat(65), { key: 'k' }]) {
      expect(await isSameUploadAccountAction(value)).toBe(false);
    }
  });

  it('keys differ between accounts and from the shared-files key of the same account', async () => {
    const { shareOwnerKey } = await import('../../../incoming/owner-key');
    expect(uploadAccountKey('acc-a')).not.toBe(uploadAccountKey('acc-b'));
    expect(uploadAccountKey('acc-a')).not.toBe(shareOwnerKey('acc-a'));
    expect(uploadAccountKey('')).toBeNull();
  });
});
