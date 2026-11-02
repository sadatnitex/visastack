import { describe, expect, it } from 'vitest';
import type { UploadOutcome } from '../document-upload-client';
import {
  AUTO_RETRY_LIMIT_SECONDS,
  type ImportItem,
  ImportQueue,
  type ImportQueueOptions,
  type ImportSend,
  canSendAgain,
  canTryAgain,
  countItems,
  retryDelayMs,
  uploadIdFromHash,
} from './import-queue';

/**
 * The import queue with a stand-in for the network. Every file here is made up in the test; none
 * is a real document.
 */

const RULES = { limitBytes: 1000, limitLabel: '1 KB', pdfAccepted: false };

function photo(name: string, size = 10, lastModified = 1): File {
  return new File([new Uint8Array(size)], name, { type: 'image/jpeg', lastModified });
}

const ADDED: UploadOutcome = {
  kind: 'added',
  message: 'Added. It is being checked.',
  title: 'Photo',
};
const UNKNOWN: UploadOutcome = { kind: 'unknown' };
const busy = (retryAfterSeconds: number | null, message: string | null = null): UploadOutcome => ({
  kind: 'busy',
  message,
  retryAfterSeconds,
});
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A network the test answers by hand, one request at a time. */
function handNetwork() {
  const calls: { readonly name: string; readonly reply: (value: UploadOutcome) => void }[] = [];
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
  const item = queue.list().find((each) => each.name === name);
  if (!item) throw new Error(`no line for ${name}`);
  return item;
};
const files = (count: number, prefix = 'f') =>
  Array.from({ length: count }, (_, i) => ({ file: photo(`${prefix}${i}.jpg`), path: '' }));

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
    const started = performance.now();
    await queue.add(
      Array.from({ length: 85 }, (_, index) => ({
        file: photo(`scan-${index + 1}.jpg`),
        path: `Trip/scan-${index + 1}.jpg`,
      })),
    );
    await queue.whenIdle();
    const took = performance.now() - started;
    const items = queue.list();
    expect(items).toHaveLength(85);
    expect(most).toBe(2);
    expect(sends).toBe(85);
    expect(items[20]?.state).toBe('added');
    expect(items[84]?.state).toBe('added');
    expect(countItems(items)).toEqual({
      total: 85,
      added: 85,
      needLook: 0,
      notSupported: 0,
      waiting: 0,
      held: 0,
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
      await queue.add(files(12));
      await queue.whenIdle();
      expect(most, `asked for ${asked}`).toBe(expected);
    }
  });

  it('keeps lines in a map with a stable order, and draws progress at most once per interval', async () => {
    const net = handNetwork();
    let progress: (fraction: number) => void = () => undefined;
    const queue = queueWith(
      (request) => {
        progress = request.onProgress;
        return net.send(request);
      },
      { concurrency: 1, progressIntervalMs: 150 },
    );
    await queue.add(files(3));
    const order = queue.getSnapshot().order;
    let draws = 0;
    queue.subscribe(() => draws++);
    for (let step = 1; step <= 20; step++) progress(step / 21);
    expect(draws).toBe(0);
    await new Promise<void>((resolve) => setTimeout(resolve, 170));
    expect(draws).toBe(1);
    expect(queue.list()[0]?.progress).toBe(95);
    // Progress never reorders or copies the list of lines.
    expect(queue.getSnapshot().order).toBe(order);
    net.calls[0]?.reply(ADDED);
  });
});

describe('each file ends in an honest state', () => {
  it('sorts mixed answers into added, duplicate, refused, not supported, unknown and busy', async () => {
    const sent: string[] = [];
    const script: Record<string, UploadOutcome[]> = {
      'fine.jpg': [ADDED],
      'copy.jpg': [
        {
          kind: 'added',
          message: 'Added. You already keep an identical copy.',
          title: 'Copy',
          removableCopyId: '00000000-0000-4000-8000-000000000001',
        },
      ],
      'refused.jpg': [{ kind: 'refused', message: 'This file type cannot be safely processed.' }],
      'lost.jpg': [UNKNOWN],
      'rate.jpg': [busy(1), ADDED],
      'busy.jpg': [busy(null), busy(null), busy(null), ADDED],
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
    await queue.add([
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
    expect(byName(queue, 'refused.jpg')).toMatchObject({
      state: 'refused',
      message: 'This file type cannot be safely processed.',
      busy: false,
    });
    expect(byName(queue, 'huge.jpg').state).toBe('unsupported');
    expect(byName(queue, 'notes.exe').state).toBe('unsupported');
    // No usable answer: sent once and never again on its own.
    expect(byName(queue, 'lost.jpg').state).toBe('unknown');
    expect(sent.filter((name) => name === 'lost.jpg')).toHaveLength(1);
    // Busy for a second, with Retry-After honoured: sent again, then added.
    expect(byName(queue, 'rate.jpg')).toMatchObject({ state: 'added', attempts: 2 });
    expect(waits).toContain(1000);
    // Busy three times: three sends in all, then not added because the service was busy.
    expect(byName(queue, 'busy.jpg')).toMatchObject({ state: 'refused', busy: true, attempts: 3 });
    expect(sent.filter((name) => name === 'busy.jpg')).toHaveLength(3);
    expect(sent).not.toContain('huge.jpg');
    expect(sent).not.toContain('notes.exe');
  });

  it('never sends an unknown file again on its own, but does on Try Again', async () => {
    const net = handNetwork();
    const queue = queueWith(net.send);
    await queue.add([{ file: photo('lost.jpg'), path: '' }]);
    net.calls[0]?.reply(UNKNOWN);
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
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(sends).toBe(1);
    expect(byName(queue, 'a.jpg').state).toBe('unknown');
  });

  it('runs the before-send step, awaited, before every send', async () => {
    const steps: string[] = [];
    const queue = queueWith(
      async (request) => {
        steps.push(`send ${(request.file as File).name}`);
        return steps.filter((step) => step.startsWith('send')).length === 1 ? busy(0) : ADDED;
      },
      {
        beforeSend: async (item) => {
          await settle();
          steps.push(`mark ${item.name} ${item.attempts}`);
        },
      },
    );
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(steps).toEqual(['mark a.jpg 1', 'send a.jpg', 'mark a.jpg 2', 'send a.jpg']);
  });

  it('starts sends in queue order even when an earlier before-send step is the slower one', async () => {
    const network = handNetwork();
    const queue = queueWith(network.send, {
      beforeSend: async (item) => {
        // The first file's step takes many turns, the second's none: without ordering the second
        // file would reach the network first.
        if (item.name === 's0.jpg') for (let turn = 0; turn < 5; turn += 1) await settle();
      },
    });
    await queue.add(files(2, 's'));
    for (let turn = 0; turn < 10; turn += 1) await settle();
    expect(network.calls.map((call) => call.name)).toEqual(['s0.jpg', 's1.jpg']);
  });
});

describe('the hourly upload limit', () => {
  it(`holds the file and every waiting file when asked to wait more than ${AUTO_RETRY_LIMIT_SECONDS} s, and sends them on Try Again for All Paused Files`, async () => {
    const net = handNetwork();
    const queue = queueWith(net.send);
    await queue.add(files(5, 'h'));
    net.calls[0]?.reply(busy(1800, 'Too many uploads in a short time.'));
    await settle();
    // The one already on its way finishes; nothing more goes out.
    net.calls[1]?.reply(ADDED);
    await queue.whenIdle();
    expect(net.calls).toHaveLength(2);
    expect(byName(queue, 'h0.jpg')).toMatchObject({
      state: 'held',
      message: 'Too many uploads in a short time.',
      attempts: 1,
    });
    for (const name of ['h2.jpg', 'h3.jpg', 'h4.jpg'])
      expect(byName(queue, name).state).toBe('held');
    expect(countItems(queue.list()).held).toBe(4);

    queue.retryHeld();
    await settle();
    expect(net.calls.map((call) => call.name).slice(2)).toEqual(['h0.jpg', 'h2.jpg']);
  });

  it(`waits on its own through a Retry-After of ${AUTO_RETRY_LIMIT_SECONDS} s or less`, async () => {
    const waits: number[] = [];
    let sends = 0;
    const queue = queueWith(async () => (++sends === 1 ? busy(AUTO_RETRY_LIMIT_SECONDS) : ADDED), {
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(waits).toEqual([AUTO_RETRY_LIMIT_SECONDS * 1000]);
    expect(byName(queue, 'a.jpg').state).toBe('added');
  });
});

describe('the same file twice', () => {
  it('lists a file already in this import as already there, and does not send it', async () => {
    const net = handNetwork();
    const queue = queueWith(net.send);
    await queue.add([{ file: photo('a.jpg'), path: 'Trip/a.jpg' }]);
    net.calls[0]?.reply(ADDED);
    await queue.whenIdle();
    await queue.add([
      { file: photo('a.jpg'), path: 'Trip/a.jpg' },
      { file: photo('b.jpg'), path: 'Trip/b.jpg' },
      { file: photo('b.jpg'), path: 'Trip/Copy/b.jpg' },
    ]);
    expect(net.calls.map((call) => call.name)).toEqual(['a.jpg', 'b.jpg']);
    const repeats = queue.list().filter((item) => item.skipReason === 'repeat');
    expect(repeats.map((item) => item.path)).toEqual(['Trip/a.jpg', 'Trip/Copy/b.jpg']);
  });
});

describe('Pause, Resume and Stop', () => {
  it('Pause sends nothing new but lets the files on their way finish; Resume carries on', async () => {
    const net = handNetwork();
    const queue = queueWith(net.send);
    await queue.add(files(5, 'p'));
    expect(net.calls).toHaveLength(2);

    queue.pause();
    expect(queue.getSnapshot().paused).toBe(true);
    expect(queue.list().filter((item) => item.state === 'paused')).toHaveLength(3);
    net.calls[0]?.reply(ADDED);
    net.calls[1]?.reply(ADDED);
    await settle();
    expect(net.calls).toHaveLength(2);
    expect(byName(queue, 'p2.jpg').state).toBe('paused');

    queue.resume();
    await settle();
    expect(net.calls).toHaveLength(4);
    net.calls[2]?.reply(ADDED);
    net.calls[3]?.reply(ADDED);
    await settle();
    net.calls[4]?.reply(ADDED);
    await queue.whenIdle();
    expect(queue.list().every((item) => item.state === 'added')).toBe(true);
  });

  it('a file added while paused waits, paused', async () => {
    const net = handNetwork();
    const queue = queueWith(net.send);
    queue.pause();
    await queue.add([{ file: photo('later.jpg'), path: '' }]);
    expect(net.calls).toHaveLength(0);
    expect(byName(queue, 'later.jpg').state).toBe('paused');
  });

  it('Stop lists every file not yet sent as not added, lets the ones on their way finish, and Try Again sends it', async () => {
    const net = handNetwork();
    const settled: ImportItem[] = [];
    const queue = queueWith(net.send, { onSettled: (item) => settled.push(item) });
    await queue.add(files(5, 's'));
    queue.stop();
    net.calls[0]?.reply(ADDED);
    net.calls[1]?.reply(UNKNOWN);
    await queue.whenIdle();
    expect(net.calls).toHaveLength(2);
    expect(byName(queue, 's0.jpg').state).toBe('added');
    expect(byName(queue, 's1.jpg').state).toBe('unknown');
    for (const name of ['s2.jpg', 's3.jpg', 's4.jpg']) {
      expect(byName(queue, name)).toMatchObject({ state: 'skipped', skipReason: 'stopped' });
    }
    expect(settled.map((item) => item.name).sort()).toEqual([
      's0.jpg',
      's1.jpg',
      's2.jpg',
      's3.jpg',
      's4.jpg',
    ]);

    queue.retry(byName(queue, 's3.jpg').id);
    await settle();
    expect(net.calls).toHaveLength(3);
    expect(net.calls[2]?.name).toBe('s3.jpg');
  });

  it('Stop while a file waits to retry after a busy answer: it is not sent again', async () => {
    let release: () => void = () => undefined;
    const sends: string[] = [];
    const queue = queueWith(
      async (request) => {
        sends.push((request.file as File).name);
        return busy(5);
      },
      {
        wait: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    );
    await queue.add([{ file: photo('wait.jpg'), path: '' }]);
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

const EARLIER = new Map<string, 'added' | 'unknown' | 'unconfirmed'>([
  ['done.jpg', 'added'],
  ['unsure.jpg', 'unknown'],
  ['mid-send.jpg', 'unconfirmed'],
]);

describe('files settled on an earlier visit', () => {
  it('shows an earlier added file as added with Send Again, and an earlier unknown or unconfirmed one as not confirmed', async () => {
    const net = handNetwork();
    const queue = queueWith(net.send, {
      earlierState: async (file) => EARLIER.get(file.name) ?? null,
    });
    await queue.add([
      { file: photo('done.jpg'), path: '' },
      { file: photo('unsure.jpg'), path: '' },
      { file: photo('mid-send.jpg'), path: '' },
      { file: photo('new.jpg'), path: '' },
    ]);
    expect(net.calls.map((call) => call.name)).toEqual(['new.jpg']);
    const done = byName(queue, 'done.jpg');
    expect(done).toMatchObject({ state: 'added', earlier: true });
    expect(byName(queue, 'unsure.jpg')).toMatchObject({ state: 'unknown', earlier: true });
    expect(byName(queue, 'mid-send.jpg')).toMatchObject({ state: 'unknown', earlier: true });
    expect(canTryAgain(done)).toBe(false);
    expect(canSendAgain(done)).toBe(true);

    queue.retry(byName(queue, 'mid-send.jpg').id);
    queue.sendAgain(done.id);
    await settle();
    expect(net.calls.map((call) => call.name)).toEqual(['new.jpg', 'mid-send.jpg']);
    net.calls[0]?.reply(ADDED);
    await settle();
    expect(net.calls.map((call) => call.name)).toEqual(['new.jpg', 'mid-send.jpg', 'done.jpg']);
  });
});

describe('how long to wait before another attempt', () => {
  it('honours the wait asked for, within a ceiling, else doubles', () => {
    expect(retryDelayMs(7, 1)).toBe(7000);
    expect(retryDelayMs(600, 1)).toBe(AUTO_RETRY_LIMIT_SECONDS * 1000);
    expect(retryDelayMs(null, 1, 2000)).toBe(2000);
    expect(retryDelayMs(null, 2, 2000)).toBe(4000);
  });
});

describe('upload ids: a file is never stored twice (UMPE P3)', () => {
  /**
   * A stand-in server that keeps upload receipts: the first send of an id stores one document, a
   * repeat of the id answers with that same document. `lose` drops the answer of the next sends,
   * the way a timeout does after the server has stored the file.
   */
  function receiptServer() {
    const stored = new Map<string, string>();
    const sent: { readonly name: string; readonly uploadId: string; readonly fileName: string }[] =
      [];
    let lose = 0;
    const send: ImportSend = async (request) => {
      sent.push({
        name: (request.file as File).name,
        uploadId: request.uploadId,
        fileName: request.fileName,
      });
      if (!stored.has(request.uploadId)) stored.set(request.uploadId, `doc-${stored.size + 1}`);
      if (lose > 0) {
        lose--;
        return UNKNOWN;
      }
      return ADDED;
    };
    return {
      send,
      sent,
      stored,
      loseNext: (count: number) => {
        lose = count;
      },
    };
  }

  let counter = 0;
  const ids = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

  it('sends a file with no answer again on its own, with the same id, and stores it once', async () => {
    const server = receiptServer();
    server.loseNext(1);
    const queue = queueWith(server.send, { retryUnknown: true, newUploadId: ids });
    await queue.add([{ file: photo('statement.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(byName(queue, 'statement.jpg')).toMatchObject({ state: 'added', attempts: 2 });
    expect(server.sent.map((s) => s.uploadId)).toEqual([
      byName(queue, 'statement.jpg').uploadId,
      byName(queue, 'statement.jpg').uploadId,
    ]);
    expect(server.sent[0]?.fileName).toBe('statement.jpg');
    expect(server.stored.size).toBe(1);
  });

  it('stops sending again after the most attempts, and leaves it unknown', async () => {
    const server = receiptServer();
    server.loseNext(10);
    const queue = queueWith(server.send, { retryUnknown: true, newUploadId: ids });
    await queue.add([{ file: photo('lost.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(byName(queue, 'lost.jpg')).toMatchObject({ state: 'unknown', attempts: 3 });
    expect(new Set(server.sent.map((s) => s.uploadId)).size).toBe(1);
    expect(server.stored.size).toBe(1);
  });

  it('never sends an unknown file again on its own when the server keeps no receipts', async () => {
    const server = receiptServer();
    server.loseNext(1);
    const queue = queueWith(server.send, { newUploadId: ids });
    await queue.add([{ file: photo('lost.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(byName(queue, 'lost.jpg')).toMatchObject({ state: 'unknown', attempts: 1 });
    expect(server.sent).toHaveLength(1);
  });

  it('reuses the id on Try Again, and gives Send Again a new one', async () => {
    const server = receiptServer();
    server.loseNext(1);
    const queue = queueWith(server.send, { newUploadId: ids });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    const first = byName(queue, 'a.jpg').uploadId;
    queue.retry(byName(queue, 'a.jpg').id);
    await queue.whenIdle();
    expect(byName(queue, 'a.jpg')).toMatchObject({ state: 'added', uploadId: first });
    expect(server.stored.size).toBe(1);

    const earlier = queueWith(server.send, {
      newUploadId: ids,
      earlierState: () => 'added',
    });
    await earlier.add([{ file: photo('b.jpg'), path: '' }]);
    const before = byName(earlier, 'b.jpg').uploadId;
    earlier.sendAgain(byName(earlier, 'b.jpg').id);
    await earlier.whenIdle();
    expect(byName(earlier, 'b.jpg').uploadId).not.toBe(before);
    expect(server.sent.at(-1)?.uploadId).toBe(byName(earlier, 'b.jpg').uploadId);
  });

  it('keeps the same id through a busy answer and its automatic retry', async () => {
    const answers = [busy(1), ADDED];
    const sent: string[] = [];
    const queue = queueWith(
      async (request) => {
        sent.push(request.uploadId);
        return answers.shift() ?? ADDED;
      },
      { newUploadId: ids },
    );
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe(sent[1]);
  });

  it('leaves a file waiting to be sent again as unknown, never as not added, on Stop', async () => {
    const server = receiptServer();
    server.loseNext(1);
    let release: () => void = () => undefined;
    const queue = queueWith(server.send, {
      retryUnknown: true,
      newUploadId: ids,
      wait: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await settle();
    await settle();
    queue.stop();
    release();
    await queue.whenIdle();
    await settle();
    expect(byName(queue, 'a.jpg')).toMatchObject({ state: 'unknown' });
    expect(server.sent).toHaveLength(1);
  });

  it('takes the id from uploadIdFor, so the same file chosen again sends the same id', async () => {
    const sent: string[] = [];
    const send: ImportSend = async (request) => {
      sent.push(request.uploadId);
      return ADDED;
    };
    const derive = (file: { name: string; size: number; lastModified: number }) =>
      `11111111-1111-4111-8111-${String(file.size).padStart(12, '0')}`;
    const one = queueWith(send, { uploadIdFor: derive });
    await one.add([{ file: photo('same.jpg', 42), path: '' }]);
    await one.whenIdle();
    const two = queueWith(send, { uploadIdFor: derive });
    await two.add([{ file: photo('same.jpg', 42), path: '' }]);
    await two.whenIdle();
    expect(sent).toEqual([
      '11111111-1111-4111-8111-000000000042',
      '11111111-1111-4111-8111-000000000042',
    ]);
  });

  it('shapes a SHA-256 as a version 4 id, and refuses anything else', () => {
    const hex = 'ab'.repeat(32);
    const id = uploadIdFromHash(hex);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uploadIdFromHash(hex)).toBe(id);
    expect(uploadIdFromHash('ab'.repeat(31))).toBeNull();
    expect(uploadIdFromHash(null)).toBeNull();
  });
});
