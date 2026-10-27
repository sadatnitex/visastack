import { describe, expect, it, vi } from 'vitest';
import {
  SERVICE_WORKER_URL,
  UPDATE_CHECK_INTERVAL_MS,
  applyUpdate,
  isStandalone,
  registerServiceWorker,
  scheduleUpdateChecks,
  unregisterAll,
} from './runtime';

class FakeWorker extends EventTarget {
  state = 'installing';
  readonly postMessage = vi.fn();
  become(state: string) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

function fakeContainer(options: {
  controller?: boolean;
  waiting?: FakeWorker;
  installing?: FakeWorker;
}) {
  const registration = Object.assign(new EventTarget(), {
    waiting: options.waiting ?? null,
    installing: options.installing ?? null,
    update: vi.fn(async () => undefined),
    unregister: vi.fn(async () => true),
  });
  const container = Object.assign(new EventTarget(), {
    controller: options.controller ? {} : null,
    register: vi.fn(async () => registration),
    getRegistrations: vi.fn(async () => [registration, registration]),
  });
  return {
    registration,
    container: container as unknown as ServiceWorkerContainer & typeof container,
  };
}

const asWorker = (worker: FakeWorker) => worker as unknown as ServiceWorker;

describe('registerServiceWorker', () => {
  it('registers the root worker without the HTTP cache', async () => {
    const { container } = fakeContainer({});
    await registerServiceWorker(container, { onUpdateReady: vi.fn() });
    expect(container.register).toHaveBeenCalledWith(SERVICE_WORKER_URL, {
      scope: '/',
      updateViaCache: 'none',
    });
  });

  it('does not offer an update on the first install on a device', async () => {
    const installing = new FakeWorker();
    const { container } = fakeContainer({ controller: false, installing });
    const onUpdateReady = vi.fn();
    await registerServiceWorker(container, { onUpdateReady });
    installing.become('installed');
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it('offers an update already waiting when the page opens', async () => {
    const waiting = new FakeWorker();
    const { container } = fakeContainer({ controller: true, waiting });
    const onUpdateReady = vi.fn();
    await registerServiceWorker(container, { onUpdateReady });
    expect(onUpdateReady).toHaveBeenCalledWith(waiting);
  });

  it('offers an update found while the page is open, once it has installed', async () => {
    const { container, registration } = fakeContainer({ controller: true });
    const onUpdateReady = vi.fn();
    await registerServiceWorker(container, { onUpdateReady });
    const next = new FakeWorker();
    registration.installing = next as never;
    registration.dispatchEvent(new Event('updatefound'));
    expect(onUpdateReady).not.toHaveBeenCalled();
    next.become('installed');
    expect(onUpdateReady).toHaveBeenCalledWith(next);
  });
});

describe('applyUpdate', () => {
  it('reloads at once when another tab already started the update', () => {
    const { container } = fakeContainer({ controller: true });
    const waiting = new FakeWorker();
    waiting.state = 'activated';
    const reload = vi.fn();
    applyUpdate(container, asWorker(waiting), reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });

  it('asks the waiting worker to start and reloads once, after it takes over', () => {
    const { container } = fakeContainer({ controller: true });
    const waiting = new FakeWorker();
    const reload = vi.fn();
    applyUpdate(container, asWorker(waiting), reload);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('unregisterAll', () => {
  it("removes every worker and VisaStack's stored files, leaving other caches alone", async () => {
    const { container, registration } = fakeContainer({});
    const names = new Set(['visastack-static-build-1', 'visastack-static-build-0', 'other']);
    const storage = {
      keys: async () => [...names],
      delete: async (name: string) => names.delete(name),
    };
    await unregisterAll(container, storage);
    expect(registration.unregister).toHaveBeenCalledTimes(2);
    expect([...names]).toEqual(['other']);
  });

  it('still unregisters where the page has no cache access', async () => {
    const { container, registration } = fakeContainer({});
    await unregisterAll(container, undefined);
    expect(registration.unregister).toHaveBeenCalledTimes(2);
  });
});

describe('scheduleUpdateChecks', () => {
  function setup(hidden = false) {
    let clock = 0;
    let visible: (() => void) | undefined;
    let tick: (() => void) | undefined;
    const registration = { update: vi.fn(async () => undefined as never) };
    const stop = scheduleUpdateChecks(registration, {
      now: () => clock,
      isHidden: () => hidden,
      onVisible: (listener) => {
        visible = listener;
        return () => {
          visible = undefined;
        };
      },
      every: (run) => {
        tick = run;
        return () => {
          tick = undefined;
        };
      },
    });
    return {
      registration,
      stop,
      advance: (ms: number) => {
        clock += ms;
      },
      show: () => visible?.(),
      tick: () => tick?.(),
    };
  }

  it('checks at most once per interval', () => {
    const run = setup();
    run.show();
    expect(run.registration.update).not.toHaveBeenCalled();
    run.advance(UPDATE_CHECK_INTERVAL_MS);
    run.show();
    run.tick();
    expect(run.registration.update).toHaveBeenCalledTimes(1);
  });

  it('does not check while the page is hidden', () => {
    const run = setup(true);
    run.advance(UPDATE_CHECK_INTERVAL_MS * 2);
    run.tick();
    expect(run.registration.update).not.toHaveBeenCalled();
  });

  it('stops cleanly', () => {
    const run = setup();
    run.stop();
    run.advance(UPDATE_CHECK_INTERVAL_MS);
    run.show();
    run.tick();
    expect(run.registration.update).not.toHaveBeenCalled();
  });

  it('survives a failed check', async () => {
    const run = setup();
    run.registration.update.mockRejectedValueOnce(new Error('offline'));
    run.advance(UPDATE_CHECK_INTERVAL_MS);
    expect(() => run.tick()).not.toThrow();
  });
});

describe('isStandalone', () => {
  const win = (matches: boolean, standalone?: boolean) =>
    ({
      matchMedia: () => ({ matches }),
      navigator: { standalone },
    }) as unknown as Window;

  it('recognises an installed app on Android, desktop and iOS', () => {
    expect(isStandalone(win(true))).toBe(true);
    expect(isStandalone(win(false, true))).toBe(true);
    expect(isStandalone(win(false))).toBe(false);
  });
});
