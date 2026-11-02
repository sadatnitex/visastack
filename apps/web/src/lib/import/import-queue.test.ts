import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadOutcome } from '../document-upload-client';
import {
  type ImportItem,
  ImportQueue,
  type ImportQueueOptions,
  type ImportSend,
  type SendAnswer,
  canTryAgain,
  countItems,
  retryDelayMs,
  sendThroughUploadRoute,
} from './import-queue';

/**
 * The import queue with a stand-in for the network. Every file here is made up in the test; none
 * is a real document.
 */

const RULES = { limitBytes: 1000, limitLabel: '1 KB', pdfAccepted: false };

function photo(name: string, size = 10, lastModified = 1): File {
  return new File([new Uint8Array(size)], name, { type: 'image/jpeg', lastModified });
}

const ADDED: SendAnswer = {
  outcome: { kind: 'added', message: 'Added. It is being checked.', title: 'Photo' },
  status: 201,
  retryAfter: null,
};
const answer = (outcome: UploadOutcome, status: number, retryAfter: string | null = null) => ({
  outcome,
  status,
  retryAfter,
});
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A network the test answers by hand, one request at a time. */
function handNetwork() {
  const calls: { readonly name: string; readonly reply: (value: SendAnswer) => void }[] = [];
  const send: ImportSend = (request) =>
    new Promise((resolve) => {
      calls.push({ name: (request.file as File).name, reply: resolve });
    });
  return { calls, send };
}

function queueWith(send: ImportSend, extra: Partial<ImportQueueOptions> = {}) {
  return new ImportQueue({
    applicantId: 'a-1',
    rules: RULES,
    send,
    wait: () => Promise.resolve(),
    ...extra,
  });
}

const byName = (queue: ImportQueue, name: string): ImportItem => {
  const item = queue.getSnapshot().items.find((each) => each.name === name);
  if (!item) throw new Error(`no line for ${name}`);
  return item;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a batch of 85 files', () => {
  it('sends every file, never more than two at once, and loses none (not the 21st, not the 85th)', async () => {
    let inFlight = 0;
    let most = 0;
    let sends = 0;
    const send: ImportSend = async () => {
      sends++;
      inFlight++;
      most = Math.max(most, inFlight);
      await settle();
      inFlight--;
      return ADDED;
    };
    const queue = queueWith(send);
    const files = Array.from({ length: 85 }, (_, index) => ({
      file: photo(`scan-${index + 1}.jpg`),
      path: `Trip/scan-${index + 1}.jpg`,
    }));
    const started = performance.now();
    queue.add(files);
    await queue.whenIdle();
    const took = performance.now() - started;
    const { items } = queue.getSnapshot();
    expect(items).toHaveLength(85);
    expect(most).toBe(2);
    expect(sends).toBe(85);
    expect(items[20]?.state).toBe('added');
    expect(items[84]?.state).toBe('added');
    expect(items.every((item) => item.state === 'added')).toBe(true);
    expect(countItems(items)).toEqual({
      added: 85,
      needLook: 0,
      notSupported: 0,
      waiting: 0,
      skipped: 0,
    });
    // Recorded for the hand-back: the queue's own cost, with an instant stand-in network.
    console.info(`import queue: 85 files settled in ${took.toFixed(0)} ms`);
  });

  it('takes a configured bound of three, and never more than three whatever is asked', async () => {
    for (const [asked, expected] of [
      [3, 3],
      [10, 3],
      [0, 1],
    ] as const) {
      let inFlight = 0;
      let most = 0;
      const send: ImportSend = async () => {
        inFlight++;
        most = Math.max(most, inFlight);
        await settle();
        inFlight--;
        return ADDED;
      };
      const queue = queueWith(send, { concurrency: asked });
      queue.add(Array.from({ length: 12 }, (_, i) => ({ file: photo(`f${i}.jpg`), path: '' })));
      await queue.whenIdle();
      expect(most, `asked for ${asked}`).toBe(expected);
    }
  });
});

describe('each file ends in an honest state', () => {
  it('sorts mixed answers into added, duplicate, refused, not supported, unknown and busy', async () => {
    const sent: string[] = [];
    const script: Record<string, SendAnswer[]> = {
      'fine.jpg': [ADDED],
      'copy.jpg': [
        answer(
          {
            kind: 'added',
            message: 'Added. You already keep an identical copy.',
            title: 'Copy',
            removableCopyId: '00000000-0000-4000-8000-000000000001',
          },
          201,
        ),
      ],
      'refused.jpg': [
        answer({ kind: 'refused', message: 'This file type cannot be safely processed.' }, 415),
      ],
      'lost.jpg': [answer({ kind: 'unknown' }, 0)],
      'server-error.jpg': [answer({ kind: 'unknown' }, 500)],
      'rate.jpg': [answer({ kind: 'refused', message: 'Slow down.' }, 429, '1'), ADDED],
      'busy.jpg': [
        answer({ kind: 'unknown' }, 503),
        answer({ kind: 'unknown' }, 503),
        answer({ kind: 'unknown' }, 503),
        ADDED,
      ],
    };
    const waits: number[] = [];
    const send: ImportSend = async (request) => {
      const name = (request.file as File).name;
      sent.push(name);
      const next = script[name]?.shift();
      if (!next) throw new Error(`unexpected send of ${name}`);
      return next;
    };
    const queue = queueWith(send, {
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    queue.add([
      ...Object.keys(script).map((name) => ({ file: photo(name), path: '' })),
      { file: photo('huge.jpg', 5000), path: '' },
      {
        file: new File([new Uint8Array(4)], 'notes.exe', { type: 'application/x-msdownload' }),
        path: '',
      },
    ]);
    await queue.whenIdle();

    expect(byName(queue, 'fine.jpg').state).toBe('added');
    expect(byName(queue, 'copy.jpg').state).toBe('duplicate');
    expect(byName(queue, 'copy.jpg').removableCopyId).toBe('00000000-0000-4000-8000-000000000001');
    expect(byName(queue, 'refused.jpg')).toMatchObject({
      state: 'refused',
      message: 'This file type cannot be safely processed.',
      busy: false,
    });
    expect(byName(queue, 'huge.jpg').state).toBe('unsupported');
    expect(byName(queue, 'huge.jpg').message).toContain('larger than 1 KB');
    expect(byName(queue, 'notes.exe').state).toBe('unsupported');
    // No usable answer: sent once and never again on its own.
    expect(byName(queue, 'lost.jpg').state).toBe('unknown');
    expect(byName(queue, 'server-error.jpg').state).toBe('unknown');
    expect(sent.filter((name) => name === 'lost.jpg')).toHaveLength(1);
    expect(sent.filter((name) => name === 'server-error.jpg')).toHaveLength(1);
    // Turned away for now, with Retry-After honoured: sent again, then added.
    expect(byName(queue, 'rate.jpg')).toMatchObject({ state: 'added', attempts: 2 });
    expect(waits).toContain(1000);
    // Busy three times: three sends in all, then not added because the service was busy.
    expect(byName(queue, 'busy.jpg')).toMatchObject({ state: 'refused', busy: true, attempts: 3 });
    expect(sent.filter((name) => name === 'busy.jpg')).toHaveLength(3);
    // Files the browser already knew would be refused never went out.
    expect(sent).not.toContain('huge.jpg');
    expect(sent).not.toContain('notes.exe');
  });

  it('never sends an unknown file again on its own, but does on Try Again', async () => {
    const net = handNetwork();
    const queue = queueWith(net.send);
    queue.add([{ file: photo('lost.jpg'), path: '' }]);
    net.calls[0]?.reply(answer({ kind: 'unknown' }, 0));
    await queue.whenIdle();
    await settle();
    expect(net.calls).toHaveLength(1);
    const lost = byName(queue, 'lost.jpg');
    expect(lost.state).toBe('unknown');
    expect(canTryAgain(lost)).toBe(true);

    queue.retry(lost.id);
    await settle();
    expect(net.calls).toHaveLength(2);
    net.calls[1]?.reply(ADDED);
    await queue.whenIdle();
    expect(byName(queue, 'lost.jpg').state).toBe('added');
  });

  it('treats a send that throws as unknown, not as a reason to send again', async () => {
    let sends = 0;
    const queue = queueWith(async () => {
      sends++;
      throw new Error('connection reset');
    });
    queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(sends).toBe(1);
    expect(byName(queue, 'a.jpg').state).toBe('unknown');
  });
});

describe('Pause, Resume and Stop', () => {
  it('Pause sends nothing new but lets the files on their way finish; Resume carries on', async () => {
    const net = handNetwork();
    const queue = queueWith(net.send);
    queue.add(Array.from({ length: 5 }, (_, i) => ({ file: photo(`p${i}.jpg`), path: '' })));
    expect(net.calls).toHaveLength(2);

    queue.pause();
    expect(queue.getSnapshot().paused).toBe(true);
    expect(queue.getSnapshot().items.filter((item) => item.state === 'paused')).toHaveLength(3);
    net.calls[0]?.reply(ADDED);
    net.calls[1]?.reply(ADDED);
    await settle();
    expect(net.calls).toHaveLength(2);
    expect(byName(queue, 'p0.jpg').state).toBe('added');
    expect(byName(queue, 'p1.jpg').state).toBe('added');
    expect(byName(queue, 'p2.jpg').state).toBe('paused');

    queue.resume();
    expect(net.calls).toHaveLength(4);
    net.calls[2]?.reply(ADDED);
    net.calls[3]?.reply(ADDED);
    await settle();
    net.calls[4]?.reply(ADDED);
    await queue.whenIdle();
    expect(queue.getSnapshot().items.every((item) => item.state === 'added')).toBe(true);
  });

  it('a file added while paused waits, paused', () => {
    const net = handNetwork();
    const queue = queueWith(net.send);
    queue.pause();
    queue.add([{ file: photo('later.jpg'), path: '' }]);
    expect(net.calls).toHaveLength(0);
    expect(byName(queue, 'later.jpg').state).toBe('paused');
  });

  it('Stop lists every file not yet sent as not added, lets the ones on their way finish, and Try Again sends it', async () => {
    const net = handNetwork();
    const settled: ImportItem[] = [];
    const queue = queueWith(net.send, { onSettled: (item) => settled.push(item) });
    queue.add(Array.from({ length: 5 }, (_, i) => ({ file: photo(`s${i}.jpg`), path: '' })));
    queue.stop();
    net.calls[0]?.reply(ADDED);
    net.calls[1]?.reply(answer({ kind: 'unknown' }, 0));
    await queue.whenIdle();
    expect(net.calls).toHaveLength(2);
    expect(byName(queue, 's0.jpg').state).toBe('added');
    expect(byName(queue, 's1.jpg').state).toBe('unknown');
    for (const name of ['s2.jpg', 's3.jpg', 's4.jpg']) {
      expect(byName(queue, name)).toMatchObject({ state: 'skipped', skipReason: 'stopped' });
    }
    // Each file reported its end exactly once.
    expect(settled.map((item) => item.name).sort()).toEqual([
      's0.jpg',
      's1.jpg',
      's2.jpg',
      's3.jpg',
      's4.jpg',
    ]);

    queue.retry(byName(queue, 's3.jpg').id);
    expect(net.calls).toHaveLength(3);
    expect(net.calls[2]?.name).toBe('s3.jpg');
  });

  it('Stop while a file waits to retry after a busy answer: it is not sent again', async () => {
    let release: () => void = () => undefined;
    const sends: string[] = [];
    const queue = queueWith(
      async (request) => {
        sends.push((request.file as File).name);
        return answer({ kind: 'unknown' }, 503);
      },
      {
        wait: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    );
    queue.add([{ file: photo('wait.jpg'), path: '' }]);
    await settle();
    expect(byName(queue, 'wait.jpg')).toMatchObject({ state: 'queued', waitingToRetry: true });
    queue.stop();
    release();
    await queue.whenIdle();
    await settle();
    expect(sends).toEqual(['wait.jpg']);
    expect(byName(queue, 'wait.jpg')).toMatchObject({ state: 'skipped', skipReason: 'stopped' });
  });
});

describe('files settled on an earlier visit', () => {
  it('shows an earlier added file as added without sending it, and keeps an earlier unknown one unknown', async () => {
    const net = handNetwork();
    const queue = queueWith(net.send, {
      earlierState: (file) =>
        file.name === 'done.jpg' ? 'added' : file.name === 'unsure.jpg' ? 'unknown' : null,
    });
    queue.add([
      { file: photo('done.jpg'), path: '' },
      { file: photo('unsure.jpg'), path: '' },
      { file: photo('new.jpg'), path: '' },
    ]);
    expect(net.calls.map((call) => call.name)).toEqual(['new.jpg']);
    expect(byName(queue, 'done.jpg')).toMatchObject({ state: 'added', earlier: true });
    expect(byName(queue, 'unsure.jpg')).toMatchObject({ state: 'unknown', earlier: true });
    expect(canTryAgain(byName(queue, 'done.jpg'))).toBe(false);

    queue.retry(byName(queue, 'unsure.jpg').id);
    expect(net.calls.map((call) => call.name)).toEqual(['new.jpg', 'unsure.jpg']);
  });
});

describe('how long to wait before another attempt', () => {
  it('honours Retry-After in seconds or as a date, within a ceiling, else doubles', () => {
    expect(retryDelayMs('7', 1, 2000, 60_000)).toBe(7000);
    expect(retryDelayMs('600', 1, 2000, 60_000)).toBe(60_000);
    const now = Date.parse('2026-11-02T10:00:00Z');
    expect(retryDelayMs('Mon, 02 Nov 2026 10:00:05 GMT', 1, 2000, 60_000, now)).toBe(5000);
    expect(retryDelayMs(null, 1, 2000, 60_000)).toBe(2000);
    expect(retryDelayMs(null, 2, 2000, 60_000)).toBe(4000);
    expect(retryDelayMs('soon', 2, 2000, 60_000)).toBe(4000);
  });
});

describe('the real send', () => {
  it('goes through the existing upload route and keeps the status and Retry-After', async () => {
    class FakeRequest {
      static last: FakeRequest | null = null;
      url = '';
      headers: Record<string, string> = {};
      timeout = 0;
      status = 0;
      responseText = '';
      upload = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open(_method: string, url: string) {
        this.url = url;
      }
      setRequestHeader(name: string, value: string) {
        this.headers[name] = value;
      }
      getResponseHeader(name: string) {
        return name === 'Retry-After' ? '7' : null;
      }
      send() {
        FakeRequest.last = this;
        this.status = 429;
        this.responseText = JSON.stringify({ message: 'Too many uploads. Try again shortly.' });
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
    const result = await sendThroughUploadRoute({
      applicantId: 'a-1',
      file: photo('a.jpg'),
      contentType: 'image/jpeg',
      onProgress: () => undefined,
    });
    expect(FakeRequest.last?.url).toBe('/api/documents/upload?applicantId=a-1');
    // No folder path or file name travels with the file.
    expect(Object.keys(FakeRequest.last?.headers ?? {})).toEqual(['Content-Type']);
    expect(result).toEqual({
      outcome: { kind: 'refused', message: 'Too many uploads. Try again shortly.' },
      status: 429,
      retryAfter: '7',
    });
  });
});
