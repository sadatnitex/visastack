import { describe, expect, it, vi } from 'vitest';
import {
  type ResumableQueue,
  type SyncWindow,
  UPLOAD_RESUME_MESSAGE,
  UPLOAD_SYNC_TAG,
  connectUploadResume,
  isBackgroundUploadSyncOn,
  isUploadResumeMessage,
  listenForUploadResume,
  requestUploadResume,
  uploadConnectionFor,
} from './upload-sync';

/*
 * WP-PIC17: the page side of background sync for waiting uploads. It stores nothing; it only asks
 * the browser for a wake and resumes the page's own queue when the wake (or online) arrives.
 */

const ORIGIN = 'https://vs.obsidianglobal.studio';

function fakeWindow(
  options: { sync?: boolean; registration?: boolean; online?: boolean; noWorker?: boolean } = {},
) {
  const messageListeners = new Set<(event: MessageEvent) => void>();
  const onlineListeners = new Set<() => void>();
  const register = vi.fn(async (_tag: string) => undefined);
  const registration = options.sync === false ? {} : { sync: { register } };
  const win: SyncWindow & { navigator: { onLine: boolean } } = {
    navigator: {
      onLine: options.online ?? true,
      ...(options.noWorker
        ? {}
        : {
            serviceWorker: {
              getRegistration: async () =>
                options.registration === false ? undefined : registration,
              addEventListener: (_type: 'message', listener: (event: MessageEvent) => void) =>
                messageListeners.add(listener),
              removeEventListener: (_type: 'message', listener: (event: MessageEvent) => void) =>
                messageListeners.delete(listener),
            },
          }),
    },
    location: { origin: ORIGIN },
    ...(options.sync === false ? {} : { SyncManager: function SyncManager() {} }),
    addEventListener: (_type: 'online', listener: () => void) => onlineListeners.add(listener),
    removeEventListener: (_type: 'online', listener: () => void) =>
      onlineListeners.delete(listener),
  };
  const post = (data: unknown, origin = ORIGIN) => {
    for (const listener of messageListeners)
      listener(new MessageEvent('message', { data, origin }));
  };
  const goOnline = () => {
    for (const listener of onlineListeners) listener();
  };
  return { win, register, post, goOnline, messageListeners, onlineListeners };
}

function fakeQueue(): ResumableQueue & { setWaiting(value: boolean): void; resumes: number } {
  const listeners = new Set<() => void>();
  const queue = {
    waitingForConnection: false,
    resumes: 0,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resumeAfterConnection() {
      queue.resumes++;
    },
    setWaiting(value: boolean) {
      queue.waitingForConnection = value;
      for (const listener of listeners) listener();
    },
  };
  return queue as never;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('the owner switch', () => {
  it('is on only for "on", trimmed, any case; default off', () => {
    expect(isBackgroundUploadSyncOn(() => undefined)).toBe(false);
    expect(isBackgroundUploadSyncOn(() => '')).toBe(false);
    expect(isBackgroundUploadSyncOn(() => 'yes')).toBe(false);
    expect(isBackgroundUploadSyncOn(() => ' ON ')).toBe(true);
    expect(
      isBackgroundUploadSyncOn((name) => (name === 'BACKGROUND_UPLOAD_SYNC' ? 'on' : undefined)),
    ).toBe(true);
  });
});

describe('the queue connection', () => {
  it('is given only with the switch on and Background Sync in the browser', () => {
    expect(uploadConnectionFor(false, fakeWindow().win)).toBeUndefined();
    expect(uploadConnectionFor(true, undefined)).toBeUndefined();
    expect(uploadConnectionFor(true, fakeWindow({ sync: false }).win)).toBeUndefined();
    expect(uploadConnectionFor(true, fakeWindow({ noWorker: true }).win)).toBeUndefined();
    expect(uploadConnectionFor(true, fakeWindow().win)).toBeDefined();
  });

  it('reads the browser online flag each time', () => {
    const { win } = fakeWindow();
    const connection = uploadConnectionFor(true, win);
    expect(connection?.isOnline()).toBe(true);
    win.navigator.onLine = false;
    expect(connection?.isOnline()).toBe(false);
  });
});

describe('asking for a wake', () => {
  it('registers the one sync tag', async () => {
    const { win, register } = fakeWindow();
    await expect(requestUploadResume(win)).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith(UPLOAD_SYNC_TAG);
  });

  it('says no without a worker registration or sync support, and never throws', async () => {
    await expect(requestUploadResume(fakeWindow({ registration: false }).win)).resolves.toBe(false);
    await expect(requestUploadResume(fakeWindow({ sync: false }).win)).resolves.toBe(false);
    const { win, register } = fakeWindow();
    register.mockRejectedValueOnce(new Error('refused'));
    await expect(requestUploadResume(win)).resolves.toBe(false);
  });
});

describe('the wake message', () => {
  it('counts only the exact message from this site', () => {
    const ok = new MessageEvent('message', {
      data: { type: UPLOAD_RESUME_MESSAGE },
      origin: ORIGIN,
    });
    expect(isUploadResumeMessage(ok, ORIGIN)).toBe(true);
    const elsewhere = new MessageEvent('message', {
      data: { type: UPLOAD_RESUME_MESSAGE },
      origin: 'https://evil.example',
    });
    expect(isUploadResumeMessage(elsewhere, ORIGIN)).toBe(false);
    expect(
      isUploadResumeMessage(new MessageEvent('message', { data: 'x', origin: ORIGIN }), ORIGIN),
    ).toBe(false);
    expect(
      isUploadResumeMessage(
        new MessageEvent('message', { data: { type: 'SKIP_WAITING' }, origin: ORIGIN }),
        ORIGIN,
      ),
    ).toBe(false);
  });

  it('resumes on the worker message and on online, and stops listening when undone', () => {
    const { win, post, goOnline, messageListeners, onlineListeners } = fakeWindow();
    const onResume = vi.fn();
    const stop = listenForUploadResume(win, onResume);
    post({ type: UPLOAD_RESUME_MESSAGE }, 'https://evil.example');
    expect(onResume).not.toHaveBeenCalled();
    post({ type: UPLOAD_RESUME_MESSAGE });
    goOnline();
    expect(onResume).toHaveBeenCalledTimes(2);
    stop();
    expect(messageListeners.size).toBe(0);
    expect(onlineListeners.size).toBe(0);
  });
});

describe('wiring a queue', () => {
  it('asks for a wake each time the queue starts waiting, and resumes it on the wake', async () => {
    const { win, register, post } = fakeWindow();
    const queue = fakeQueue();
    const undo = connectUploadResume(win, queue);
    await flush();
    expect(register).not.toHaveBeenCalled();
    queue.setWaiting(true);
    queue.setWaiting(true);
    await flush();
    expect(register).toHaveBeenCalledTimes(1);
    post({ type: UPLOAD_RESUME_MESSAGE });
    expect(queue.resumes).toBe(1);
    queue.setWaiting(false);
    queue.setWaiting(true);
    await flush();
    expect(register).toHaveBeenCalledTimes(2);
    undo();
    post({ type: UPLOAD_RESUME_MESSAGE });
    expect(queue.resumes).toBe(1);
  });

  it('a wake reaching a page with nothing waiting sends nothing (another account, after sign-out)', async () => {
    const { win, post } = fakeWindow();
    const { ImportQueue } = await import('../import/import-queue');
    const send = vi.fn();
    const queue = new ImportQueue({
      applicantId: 'someone-else',
      rules: { limitBytes: 1000, limitLabel: '1 KB', pdfAccepted: false },
      send,
      connection: { isOnline: () => true },
    });
    const undo = connectUploadResume(win, queue);
    post({ type: UPLOAD_RESUME_MESSAGE });
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(queue.list()).toEqual([]);
    undo();
  });
});
