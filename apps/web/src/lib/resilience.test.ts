import { describe, expect, it, vi } from 'vitest';
import {
  IN_FLIGHT_DOCUMENT_STATES,
  REFRESH_DELAYS_MS,
  type RefreshLoopDeps,
  SLOW_AFTER_MS,
  guardNetwork,
  isStillProcessing,
  refreshDelayMs,
  startRefreshLoop,
} from './resilience';

describe('refreshDelayMs', () => {
  it('starts quickly, backs off, and never asks more often than every three seconds', () => {
    expect(refreshDelayMs(0)).toBe(3000);
    expect(refreshDelayMs(1)).toBe(5000);
    expect(refreshDelayMs(2)).toBe(8000);
    for (const delay of REFRESH_DELAYS_MS) expect(delay).toBeGreaterThanOrEqual(3000);
  });

  it('never gets faster as it goes on', () => {
    for (let i = 1; i < REFRESH_DELAYS_MS.length; i++) {
      expect(REFRESH_DELAYS_MS[i] ?? 0).toBeGreaterThanOrEqual(REFRESH_DELAYS_MS[i - 1] ?? 0);
    }
  });

  it('gives up after about ten minutes instead of polling for ever', () => {
    const total = REFRESH_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeGreaterThanOrEqual(8 * 60 * 1000);
    expect(total).toBeLessThanOrEqual(12 * 60 * 1000);
    expect(refreshDelayMs(REFRESH_DELAYS_MS.length)).toBeNull();
    expect(refreshDelayMs(10_000)).toBeNull();
  });
});

describe('isStillProcessing', () => {
  it('is true while the server is still working on the file', () => {
    for (const state of ['UPLOADING', 'QUARANTINED', 'SCANNING', 'NORMALIZING', 'EXTRACTING']) {
      expect(isStillProcessing(state), state).toBe(true);
    }
  });

  it('is false once the file is ready, waiting for a person, or has failed', () => {
    for (const state of ['AWAITING_REVIEW', 'APPROVED', 'NEEDS_ATTENTION', 'FAILED', 'REJECTED']) {
      expect(isStillProcessing(state), state).toBe(false);
    }
    expect(isStillProcessing(null)).toBe(false);
  });

  it('agrees with the pipeline: every state is either in flight or settled, never forgotten', async () => {
    const { DOCUMENT_STATES } = await import('@visastack/core');
    const settled = ['AWAITING_REVIEW', 'APPROVED', 'NEEDS_ATTENTION', 'FAILED', 'REJECTED'];
    const known = new Set([...IN_FLIGHT_DOCUMENT_STATES, ...settled]);
    expect([...DOCUMENT_STATES].sort()).toEqual([...known].sort());
  });
});

describe('guardNetwork', () => {
  const unknown = 'We could not confirm whether it finished.';

  it('passes through what the action returns', async () => {
    const action = vi.fn(async () => ({ ok: true, message: 'Uploaded.' }));
    const guarded = guardNetwork(action, unknown);
    expect(await guarded({}, new FormData())).toEqual({ ok: true, message: 'Uploaded.' });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('turns a request that never got an answer into a message, not an error screen', async () => {
    const guarded = guardNetwork(async () => {
      throw new TypeError('Failed to fetch');
    }, unknown);
    expect(await guarded({}, new FormData())).toEqual({ ok: false, message: unknown });
  });

  it('hands the action its previous state and the form data unchanged', async () => {
    const action = vi.fn(async (_previous: { n: number }, data: FormData) => ({
      ok: true,
      message: String(data.get('file')),
    }));
    const data = new FormData();
    data.set('file', 'passport.pdf');
    const guarded = guardNetwork(action, unknown);
    expect(await guarded({ n: 1 }, data)).toEqual({ ok: true, message: 'passport.pdf' });
    expect(action).toHaveBeenCalledWith({ n: 1 }, data);
  });
});

describe('SLOW_AFTER_MS', () => {
  it('is long enough not to nag on an ordinary upload and short enough to reassure on a slow one', () => {
    expect(SLOW_AFTER_MS).toBeGreaterThanOrEqual(10000);
    expect(SLOW_AFTER_MS).toBeLessThanOrEqual(30000);
  });
});

/** A clock and a timer queue the test controls, so the loop's timing is checked exactly. */
function harness(options: { hidden?: boolean } = {}) {
  let now = 0;
  let nextId = 1;
  let hidden = options.hidden ?? false;
  const timers: { id: number; at: number; run: () => void }[] = [];
  const refresh = vi.fn();
  const deps: RefreshLoopDeps = {
    refresh,
    isHidden: () => hidden,
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.push({ id, at: now + ms, run });
      return id;
    },
    clearTimer: (handle) => {
      const index = timers.findIndex((t) => t.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.run();
    }
    now = end;
  };
  return {
    deps,
    advance,
    refresh,
    setHidden: (value: boolean) => {
      hidden = value;
    },
    waiting: () => timers.length,
  };
}

describe('startRefreshLoop', () => {
  it('asks the server again after 3, then 5, then 8 seconds', () => {
    const h = harness();
    startRefreshLoop(h.deps);
    h.advance(2999);
    expect(h.refresh).toHaveBeenCalledTimes(0);
    h.advance(1);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.advance(4999);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.advance(1);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    h.advance(8000);
    expect(h.refresh).toHaveBeenCalledTimes(3);
  });

  it('stops for good when the schedule runs out, and leaves nothing waiting', () => {
    const h = harness();
    startRefreshLoop(h.deps);
    h.advance(60 * 60 * 1000);
    expect(h.refresh).toHaveBeenCalledTimes(REFRESH_DELAYS_MS.length);
    expect(h.waiting()).toBe(0);
  });

  it('spends nothing on a hidden tab and catches up the moment it is shown', () => {
    const h = harness({ hidden: true });
    const loop = startRefreshLoop(h.deps);
    h.advance(10 * 60 * 1000);
    expect(h.refresh).toHaveBeenCalledTimes(0);
    expect(h.waiting()).toBe(0);
    h.setHidden(false);
    loop.onVisible();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.waiting()).toBe(1);
  });

  it('does not ask twice when the tab is shown while a check is already due', () => {
    const h = harness();
    const loop = startRefreshLoop(h.deps);
    loop.onVisible();
    expect(h.refresh).toHaveBeenCalledTimes(0);
    h.advance(3000);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it('stop cancels the pending check and nothing is asked afterwards', () => {
    const h = harness();
    const loop = startRefreshLoop(h.deps);
    loop.stop();
    expect(h.waiting()).toBe(0);
    h.advance(60 * 60 * 1000);
    expect(h.refresh).not.toHaveBeenCalled();
    h.setHidden(false);
    loop.onVisible();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('does not start again after the schedule has run out, even if the tab is shown', () => {
    const h = harness();
    const loop = startRefreshLoop(h.deps);
    h.advance(60 * 60 * 1000);
    h.refresh.mockClear();
    loop.onVisible();
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
