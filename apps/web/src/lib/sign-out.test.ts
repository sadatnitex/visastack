import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  on: false,
  calls: [] as string[],
  removed: [] as unknown[],
  sessionRef: 'ref-this-sign-in' as string | null,
  removeThrows: false,
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    state.calls.push(`redirect:${to}`);
  },
}));
vi.mock('./neon-auth', () => ({
  getNeonAuth: () => ({
    signOut: async () => {
      state.calls.push('signOut');
    },
  }),
}));
vi.mock('./web-push', () => ({ webPushSwitchOn: () => state.on }));
vi.mock('./neon-recency', () => ({ neonSessionRef: async () => state.sessionRef }));
vi.mock('./session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => {
    state.calls.push('session');
    return fn({ db: {}, accountId: 'acct-1' });
  },
}));
vi.mock('@visastack/services/web-push', () => ({
  removeWebPushSubscriptionsForSession: async (_db: unknown, input: unknown) => {
    if (state.removeThrows) throw new Error('relation "web_push_subscriptions" does not exist');
    state.removed.push(input);
    return 1;
  },
}));

const { signOutCurrentUser } = await import('./sign-out');

beforeEach(() => {
  state.on = false;
  state.calls = [];
  state.removed = [];
  state.sessionRef = 'ref-this-sign-in';
  state.removeThrows = false;
});

describe('sign-out and phone alerts (WP-PIC18)', () => {
  it('does exactly what it did before while Web Push is off', async () => {
    await signOutCurrentUser('/');
    expect(state.calls).toEqual(['signOut', 'redirect:/']);
    expect(state.removed).toEqual([]);
  });

  it('forgets only this sign-in’s browsers before the session ends', async () => {
    state.on = true;
    await signOutCurrentUser('/');
    expect(state.removed).toEqual([{ accountId: 'acct-1', sessionRef: 'ref-this-sign-in' }]);
    expect(state.calls).toEqual(['session', 'signOut', 'redirect:/']);
  });

  it('still signs out when nothing can be removed', async () => {
    state.on = true;
    state.removeThrows = true;
    await signOutCurrentUser('/');
    expect(state.calls.slice(-2)).toEqual(['signOut', 'redirect:/']);
    state.removeThrows = false;
    state.sessionRef = null;
    state.calls = [];
    await signOutCurrentUser('/');
    expect(state.calls).toEqual(['signOut', 'redirect:/']);
  });
});
