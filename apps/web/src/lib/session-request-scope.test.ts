import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * withSession shares work inside ONE request and never across requests. React `cache()` is
 * per-request in a real page render (and does nothing in plain Node), so these tests stand in a
 * small request-scoped cache: `newRequest()` throws everything away, like a new request does.
 */
const h = vi.hoisted(() => {
  const state = {
    scope: new Map<unknown, unknown>(),
    afterQueue: [] as Array<() => unknown>,
    afterThrows: false,
    pools: [] as Array<{ id: number; end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }>,
  };
  return {
    state,
    newRequest() {
      state.scope = new Map();
      state.afterQueue = [];
    },
    currentIdentity: vi.fn(),
    checkPilotAccess: vi.fn(),
    claimInvitation: vi.fn(),
    provision: vi.fn(),
    attribute: vi.fn(),
    release: vi.fn(),
    touch: vi.fn(),
    isStaffContext: vi.fn(),
    enforceSessionAgeLimit: vi.fn(),
    report: vi.fn(),
  };
});

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cache:
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      if (!h.state.scope.has(fn)) h.state.scope.set(fn, fn(...args));
      return h.state.scope.get(fn) as R;
    },
}));
vi.mock('next/server', () => ({
  after(task: () => unknown) {
    if (h.state.afterThrows) throw new Error('`after` was called outside a request scope');
    h.state.afterQueue.push(task);
  },
}));
vi.mock('next/navigation', () => ({
  redirect(to: string) {
    throw Object.assign(new Error(`REDIRECT:${to}`), { digest: `NEXT_REDIRECT;${to}` });
  },
}));
vi.mock('./identity-provider', () => ({
  NeonIdentityPort: class {
    currentIdentity = h.currentIdentity;
  },
}));
vi.mock('@visastack/db', () => ({
  resolveDatabaseUrl: () => 'test-only',
  createPooledDb: () => {
    const pool = { id: h.state.pools.length + 1, on: vi.fn(), end: vi.fn(async () => undefined) };
    h.state.pools.push(pool);
    return { db: { pool: pool.id }, pool };
  },
}));
vi.mock('@visastack/services', () => ({
  ACTIVITY_TOUCH_THROTTLE_MS: 60 * 60 * 1000,
  provisionNeonAccount: h.provision,
  claimInvitation: h.claimInvitation,
  releaseInvitationClaim: h.release,
  attributeInvitation: h.attribute,
  touchAccountActivity: h.touch,
}));
vi.mock('./pilot-access', () => ({ checkPilotAccess: h.checkPilotAccess }));
vi.mock('./server-error', () => ({ reportServerError: h.report }));
vi.mock('./session-age', () => ({
  isStaffContext: h.isStaffContext,
  enforceSessionAgeLimit: h.enforceSessionAgeLimit,
}));

const HOUR = 60 * 60 * 1000;

function account(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    value: {
      id: 'acct-1',
      lastActiveAt: new Date(Date.now() - 5 * 60 * 1000),
      inactivityNoticeSentAt: null,
      ...overrides,
    },
  };
}

/** Lets a promise chain run a few steps, so two calls overlap like a layout and a page do. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  // Tests below change how the activity write behaves; never let that leak into the next test.
  h.touch.mockReset();
  h.newRequest();
  h.state.pools = [];
  h.state.afterThrows = false;
  h.currentIdentity.mockResolvedValue({
    providerId: 'neon-1',
    email: 'person@example.test',
    emailVerified: true,
  });
  h.checkPilotAccess.mockResolvedValue({ allowed: true });
  h.provision.mockResolvedValue(account());
  h.isStaffContext.mockResolvedValue(false);
  h.enforceSessionAgeLimit.mockResolvedValue({ satisfied: true });
});

describe('withSession inside one request', () => {
  it('runs the account checks once for the workspace frame and the page, on one pool closed once', async () => {
    const { withSession } = await import('./session');
    const seen: Array<{ accountId: string; db: unknown }> = [];
    const work = async (ctx: { accountId: string; db: unknown }) => {
      await tick();
      seen.push({ accountId: ctx.accountId, db: ctx.db });
      return ctx.accountId;
    };
    const [frame, page] = await Promise.all([withSession(work), withSession(work)]);

    expect([frame, page]).toEqual(['acct-1', 'acct-1']);
    expect(h.checkPilotAccess).toHaveBeenCalledOnce();
    expect(h.provision).toHaveBeenCalledOnce();
    expect(h.isStaffContext).toHaveBeenCalledOnce();
    expect(h.enforceSessionAgeLimit).toHaveBeenCalledOnce();
    expect(h.state.pools).toHaveLength(1);
    expect(seen[0]?.db).toBe(seen[1]?.db);
    expect(h.state.pools[0]?.end).toHaveBeenCalledOnce();
  });

  it('opens a fresh pool for a later call once the first has closed, still checking only once', async () => {
    const { withSession } = await import('./session');
    await withSession(async () => 'frame');
    await withSession(async () => 'page');

    expect(h.checkPilotAccess).toHaveBeenCalledOnce();
    expect(h.state.pools).toHaveLength(2);
    for (const pool of h.state.pools) expect(pool.end).toHaveBeenCalledOnce();
  });

  it('refuses every call in the request when the pilot-access check refuses', async () => {
    h.checkPilotAccess.mockResolvedValue({ allowed: false });
    const { withSession } = await import('./session');
    const work = vi.fn();
    const results = await Promise.allSettled([withSession(work), withSession(work)]);

    for (const result of results) {
      expect(result.status).toBe('rejected');
      expect((result as PromiseRejectedResult).reason.message).toBe(
        'REDIRECT:/pilot-access-denied',
      );
    }
    expect(work).not.toHaveBeenCalled();
    expect(h.provision).not.toHaveBeenCalled();
    expect(h.state.pools[0]?.end).toHaveBeenCalledOnce();
    expect(h.report).not.toHaveBeenCalled();
  });

  it('never hands one identity the answer worked out for another', async () => {
    const { withSession } = await import('./session');
    await withSession(async () => undefined);
    h.currentIdentity.mockResolvedValue({
      providerId: 'neon-2',
      email: 'other@example.test',
      emailVerified: true,
    });
    h.provision.mockResolvedValue(account({ id: 'acct-2' }));
    const accountId = await withSession(async (ctx) => ctx.accountId);

    expect(accountId).toBe('acct-2');
    expect(h.checkPilotAccess).toHaveBeenCalledTimes(2);
  });
});

describe('withSession across requests (nothing carries over)', () => {
  it('runs the pilot-access check again on every request and refuses a revoked person at once', async () => {
    const { withSession } = await import('./session');
    await withSession(async () => undefined);
    h.newRequest();
    await withSession(async () => undefined);
    expect(h.checkPilotAccess).toHaveBeenCalledTimes(2);

    h.newRequest();
    h.checkPilotAccess.mockResolvedValue({ allowed: false });
    const work = vi.fn();
    await expect(withSession(work)).rejects.toThrow('REDIRECT:/pilot-access-denied');
    expect(work).not.toHaveBeenCalled();
    expect(h.checkPilotAccess).toHaveBeenCalledTimes(3);
  });

  it('enforces the session-age limit on every request', async () => {
    const { withSession } = await import('./session');
    await withSession(async () => undefined);
    h.newRequest();
    h.enforceSessionAgeLimit.mockResolvedValue({
      satisfied: false,
      reauthUrl: '/auth/reauth?returnTo=%2Fapp',
    });
    const work = vi.fn();
    const results = await Promise.allSettled([withSession(work), withSession(work)]);

    for (const result of results) {
      expect((result as PromiseRejectedResult).reason.message).toBe(
        'REDIRECT:/auth/reauth?returnTo=%2Fapp',
      );
    }
    expect(work).not.toHaveBeenCalled();
    expect(h.enforceSessionAgeLimit).toHaveBeenCalledTimes(2);
  });

  it('feeds the staff check result into the session-age limit, unchanged', async () => {
    h.isStaffContext.mockResolvedValue(true);
    const { withSession } = await import('./session');
    await withSession(async () => undefined);

    expect(h.isStaffContext).toHaveBeenCalledWith(
      { pool: 1 },
      { accountId: 'acct-1', email: 'person@example.test' },
    );
    expect(h.enforceSessionAgeLimit).toHaveBeenCalledWith(true, '/app');
  });
});

describe('withSession activity bookkeeping', () => {
  it('writes nothing when the account was marked active within the last hour', async () => {
    const { withSession } = await import('./session');
    await withSession(async () => undefined);
    expect(h.touch).not.toHaveBeenCalled();
    expect(h.state.afterQueue).toHaveLength(0);
  });

  it('refreshes an old timestamp only after the response, on its own pool that it closes', async () => {
    h.provision.mockResolvedValue(account({ lastActiveAt: new Date(Date.now() - 2 * HOUR) }));
    const { withSession } = await import('./session');
    await Promise.all([withSession(async () => undefined), withSession(async () => undefined)]);

    expect(h.touch).not.toHaveBeenCalled();
    expect(h.state.afterQueue).toHaveLength(1);

    await h.state.afterQueue[0]?.();
    expect(h.touch).toHaveBeenCalledOnce();
    expect(h.touch).toHaveBeenCalledWith({ pool: 2 }, 'acct-1');
    expect(h.state.pools[1]?.end).toHaveBeenCalledOnce();
  });

  it('clears a pending inactivity warning before the page runs', async () => {
    h.provision.mockResolvedValue(account({ inactivityNoticeSentAt: new Date() }));
    const { withSession } = await import('./session');
    const order: string[] = [];
    h.touch.mockImplementation(async () => {
      order.push('touch');
    });
    await withSession(async () => {
      order.push('page');
    });

    expect(order).toEqual(['touch', 'page']);
    expect(h.state.afterQueue).toHaveLength(0);
  });

  it('writes straight away when there is no Next.js request to run after', async () => {
    h.state.afterThrows = true;
    h.provision.mockResolvedValue(account({ lastActiveAt: new Date(Date.now() - 2 * HOUR) }));
    const { withSession } = await import('./session');
    await withSession(async () => undefined);
    expect(h.touch).toHaveBeenCalledWith({ pool: 1 }, 'acct-1');
  });

  it('still shows the page when clearing a pending warning fails, and logs it', async () => {
    h.provision.mockResolvedValue(account({ inactivityNoticeSentAt: new Date() }));
    h.touch.mockRejectedValue(new Error('database unavailable'));
    const { withSession } = await import('./session');
    await expect(withSession(async () => 'page')).resolves.toBe('page');
    expect(h.report).toHaveBeenCalledOnce();
  });

  it('still shows the page when the inline fallback write fails, and logs it', async () => {
    h.state.afterThrows = true;
    h.provision.mockResolvedValue(account({ lastActiveAt: new Date(Date.now() - 2 * HOUR) }));
    h.touch.mockRejectedValue(new Error('database unavailable'));
    const { withSession } = await import('./session');
    await expect(withSession(async () => 'page')).resolves.toBe('page');
    expect(h.report).toHaveBeenCalledOnce();
  });

  it('logs a failed background write without throwing', async () => {
    h.provision.mockResolvedValue(account({ lastActiveAt: new Date(Date.now() - 2 * HOUR) }));
    h.touch.mockRejectedValue(new Error('database unavailable'));
    const { withSession } = await import('./session');
    await withSession(async () => undefined);
    await expect(h.state.afterQueue[0]?.()).resolves.toBeUndefined();
    expect(h.report).toHaveBeenCalledOnce();
    expect(h.state.pools[1]?.end).toHaveBeenCalledOnce();
  });
});

describe('activityWriteNeeded', () => {
  it('waits an hour between writes and treats a missing timestamp as due', async () => {
    const { activityWriteNeeded, ACTIVITY_WRITE_INTERVAL_MS } = await import('./session');
    const now = Date.parse('2026-10-25T12:00:00Z');
    expect(ACTIVITY_WRITE_INTERVAL_MS).toBe(HOUR);
    expect(activityWriteNeeded({ lastActiveAt: new Date(now - HOUR) }, now)).toBe('none');
    expect(activityWriteNeeded({ lastActiveAt: new Date(now - HOUR - 1) }, now)).toBe('background');
    expect(activityWriteNeeded({ lastActiveAt: null }, now)).toBe('background');
    expect(activityWriteNeeded({}, now)).toBe('background');
    expect(activityWriteNeeded({ lastActiveAt: 'not a date' }, now)).toBe('background');
    expect(
      activityWriteNeeded({ lastActiveAt: new Date(now), inactivityNoticeSentAt: new Date() }, now),
    ).toBe('now');
  });
});
