import { beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.hoisted(() => vi.fn(async (_afterwards?: string) => undefined));
vi.mock('../../lib/sign-out', () => ({ signOutCurrentUser: signOut }));

const { switchInvitationAccountAction } = await import('./actions');

const TOKEN = `${'Ab3_'.repeat(10)}Ab3`;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => signOut.mockClear());

describe('"Not you?" on the invitation page', () => {
  it('signs out, then goes to sign in with this same invitation to return to', async () => {
    for (const [kind, path] of [
      ['team', '/app/invitations/accept'],
      ['client', '/app/client-invitations/accept'],
      ['sharing', '/app/sharing-invitations/accept'],
    ] as const) {
      signOut.mockClear();
      await switchInvitationAccountAction(form({ kind, token: TOKEN }));
      expect(signOut).toHaveBeenCalledExactlyOnceWith(
        `/auth/sign-in?next=${encodeURIComponent(`${path}?token=${TOKEN}`)}`,
      );
    }
  });

  it('never builds a return address from anything but a known kind and a well-formed link', async () => {
    for (const fields of [
      { kind: 'admin', token: TOKEN },
      { kind: 'client', token: 'short' },
      { kind: 'client', token: `${TOKEN.slice(0, 42)}/` },
      { kind: 'client' },
      { token: TOKEN, next: 'https://elsewhere.example' },
    ]) {
      signOut.mockClear();
      await switchInvitationAccountAction(form(fields));
      expect(signOut).toHaveBeenCalledExactlyOnceWith();
    }
  });
});
