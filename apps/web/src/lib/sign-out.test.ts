import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  calls: [] as string[],
  removed: [] as unknown[],
  sessionRef: 'ref-this-sign-in' as string | null,
  remove: 'ok' as 'ok' | 'throw' | 'hang',
  poolsEnded: 0,
  databaseUrl: 'postgres://example.invalid/db' as string | undefined,
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
vi.mock('./neon-recency', () => ({ neonSessionRef: async () => state.sessionRef }));
vi.mock('./session', () => ({
  withSession: async () => {
    throw new Error('sign-out must not run the full session checks');
  },
}));
vi.mock('@visastack/db', () => ({
  resolveDatabaseUrl: () => state.databaseUrl,
  createPooledDb: () => ({
    db: {},
    pool: {
      on: () => undefined,
      end: async () => {
        state.poolsEnded += 1;
      },
    },
  }),
}));
vi.mock('@visastack/services/web-push', () => ({
  removeWebPushOnSignOut: async (_db: unknown, input: unknown) => {
    state.calls.push('cleanup');
    if (state.remove === 'throw')
      throw new Error('relation "web_push_subscriptions" does not exist');
    if (state.remove === 'hang') await new Promise(() => undefined);
    state.removed.push(input);
    return 1;
  },
}));

const { PUSH_ENDPOINT_FIELD, signOutCurrentUser } = await import('./sign-out');

function form(endpoint?: string): FormData {
  const data = new FormData();
  if (endpoint) data.set(PUSH_ENDPOINT_FIELD, endpoint);
  return data;
}

beforeEach(() => {
  state.calls = [];
  state.removed = [];
  state.sessionRef = 'ref-this-sign-in';
  state.remove = 'ok';
  state.poolsEnded = 0;
  state.databaseUrl = 'postgres://example.invalid/db';
});

describe('sign-out and phone alerts (WP-PIC18)', () => {
  it('forgets this sign-in’s browsers and the browser it names, whatever the switch says', async () => {
    vi.stubEnv('WEB_PUSH', undefined);
    await signOutCurrentUser('/', form('https://fcm.googleapis.com/fcm/send/x'));
    vi.unstubAllEnvs();
    expect(state.removed).toEqual([
      { sessionRef: 'ref-this-sign-in', endpoint: 'https://fcm.googleapis.com/fcm/send/x' },
    ]);
    expect(state.calls).toEqual(['cleanup', 'signOut', 'redirect:/']);
    await vi.waitFor(() => expect(state.poolsEnded).toBe(1));
  });

  it('works for a sign-out form that sends nothing', async () => {
    await signOutCurrentUser('/next');
    expect(state.removed).toEqual([{ sessionRef: 'ref-this-sign-in', endpoint: null }]);
    expect(state.calls.slice(-2)).toEqual(['signOut', 'redirect:/next']);
  });

  it('still signs out when nothing can be removed or there is nothing to name', async () => {
    state.remove = 'throw';
    await signOutCurrentUser('/');
    expect(state.calls.slice(-2)).toEqual(['signOut', 'redirect:/']);
    state.calls = [];
    state.sessionRef = null;
    await signOutCurrentUser('/');
    expect(state.calls).toEqual(['signOut', 'redirect:/']);
    state.calls = [];
    state.databaseUrl = undefined;
    state.sessionRef = 'ref';
    await signOutCurrentUser('/');
    expect(state.calls).toEqual(['signOut', 'redirect:/']);
  });

  it('waits at most about two seconds for a cleanup that hangs', async () => {
    state.remove = 'hang';
    const started = Date.now();
    await signOutCurrentUser('/');
    const waited = Date.now() - started;
    expect(state.calls.slice(-2)).toEqual(['signOut', 'redirect:/']);
    expect(waited).toBeGreaterThanOrEqual(1900);
    expect(waited).toBeLessThan(3500);
  }, 10_000);
});
