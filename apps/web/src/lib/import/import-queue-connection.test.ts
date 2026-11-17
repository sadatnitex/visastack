import { describe, expect, it, vi } from 'vitest';
import type { UploadOutcome } from '../document-upload-client';
import { ImportQueue, type ImportQueueOptions, type ImportSend, canTryAgain } from './import-queue';

/*
 * WP-PIC17 (picture-first Q6): the import queue when the connection drops. With the `connection`
 * option a file waits for the connection instead of failing, keeps its upload id and the person
 * it was chosen for, and goes again only when the page is told the connection is back. Without
 * the option nothing changes. Every file here is made up.
 */

const RULES = { limitBytes: 1000, limitLabel: '1 KB', pdfAccepted: false };
const ADDED: UploadOutcome = {
  kind: 'added',
  message: 'Added. It is being checked.',
  title: 'Photo',
};
const UNKNOWN: UploadOutcome = { kind: 'unknown' };

function photo(name: string): File {
  return new File([new Uint8Array(10)], name, { type: 'image/jpeg', lastModified: 1 });
}

interface Sent {
  readonly name: string;
  readonly uploadId: string;
  readonly scope: string | undefined;
  readonly applicantId: string;
}

/** A network that records each send and answers with the next scripted outcome. */
function network(answers: (sent: Sent) => UploadOutcome) {
  const sent: Sent[] = [];
  const send: ImportSend = async (request) => {
    const entry = {
      name: (request.file as File).name,
      uploadId: request.uploadId,
      scope: request.scope,
      applicantId: request.applicantId,
    };
    sent.push(entry);
    return answers(entry);
  };
  return { sent, send };
}

function device(online = true) {
  const state = { online };
  return { state, connection: { isOnline: () => state.online } };
}

function queueWith(send: ImportSend, extra: Partial<ImportQueueOptions> = {}) {
  let next = 0;
  return new ImportQueue({
    applicantId: 'a-1',
    rules: RULES,
    send,
    wait: () => Promise.resolve(),
    newUploadId: () => `id-${++next}`,
    ...extra,
  });
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('switch off: no connection option', () => {
  it('sends as before even when the browser says it is offline (behaviour unchanged)', async () => {
    const { sent, send } = network(() => ADDED);
    const queue = queueWith(send);
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(sent.map((s) => s.name)).toEqual(['a.jpg']);
    expect(queue.list()[0]?.state).toBe('added');
    expect(queue.waitingForConnection).toBe(false);
  });

  it('leaves a failed send Not Confirmed as before, with receipts off', async () => {
    const { sent, send } = network(() => UNKNOWN);
    const queue = queueWith(send);
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(sent).toHaveLength(1);
    expect(queue.list()[0]?.state).toBe('unknown');
  });
});

describe('offline before sending', () => {
  it('sends nothing, keeps every file Waiting and says it waits for the connection', async () => {
    const { sent, send } = network(() => ADDED);
    const { state, connection } = device(false);
    const queue = queueWith(send, { connection });
    await queue.add([
      { file: photo('a.jpg'), path: '' },
      { file: photo('b.jpg'), path: '' },
    ]);
    await flush();
    expect(sent).toHaveLength(0);
    expect(queue.list().map((item) => item.state)).toEqual(['queued', 'queued']);
    expect(queue.list().every((item) => item.attempts === 0)).toBe(true);
    expect(queue.waitingForConnection).toBe(true);

    // A wake while still offline changes nothing.
    queue.resumeAfterConnection();
    await flush();
    expect(sent).toHaveLength(0);
    expect(queue.waitingForConnection).toBe(true);

    state.online = true;
    queue.resumeAfterConnection();
    await queue.whenIdle();
    expect(sent.map((s) => s.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(queue.list().map((item) => item.state)).toEqual(['added', 'added']);
    expect(queue.waitingForConnection).toBe(false);
  });

  it('never says Added (or anything settled) before the server answers', async () => {
    const { send } = network(() => ADDED);
    const { connection } = device(false);
    const queue = queueWith(send, { connection });
    const seen = new Set<string>();
    queue.subscribe(() => {
      for (const item of queue.list()) seen.add(item.state);
    });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    expect([...seen].filter((state) => state !== 'queued')).toEqual([]);
  });
});

describe('the connection drops while a file is on its way', () => {
  it('with receipts: back to Waiting with the same upload id, the attempt not used', async () => {
    const { state, connection } = device(true);
    const { sent, send } = network(() => {
      if (sent.length === 1) {
        state.online = false;
        return UNKNOWN;
      }
      return ADDED;
    });
    const queue = queueWith(send, { connection, retryUnknown: true });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    const waiting = queue.list()[0];
    expect(waiting?.state).toBe('queued');
    expect(waiting?.attempts).toBe(0);
    expect(queue.waitingForConnection).toBe(true);
    expect(sent).toHaveLength(1);

    state.online = true;
    queue.resumeAfterConnection();
    await queue.whenIdle();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.uploadId).toBe(sent[0]?.uploadId);
    expect(queue.list()[0]?.state).toBe('added');
    expect(queue.list()[0]?.attempts).toBe(1);
  });

  it('without receipts: stays Not Confirmed (it may have arrived) and is never sent again alone', async () => {
    const { state, connection } = device(true);
    const { sent, send } = network(() => {
      state.online = false;
      return UNKNOWN;
    });
    const queue = queueWith(send, { connection, retryUnknown: false });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(queue.list()[0]?.state).toBe('unknown');
    state.online = true;
    queue.resumeAfterConnection();
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('Stop during the send leaves the file Not Confirmed, never quietly waiting', async () => {
    const { state, connection } = device(true);
    let release: (value: UploadOutcome) => void = () => undefined;
    const send: ImportSend = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const queue = queueWith(send, { connection, retryUnknown: true });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    queue.stop();
    state.online = false;
    release(UNKNOWN);
    await queue.whenIdle();
    expect(queue.list()[0]?.state).toBe('unknown');
  });
});

describe('a resumed file goes to the person it was chosen for', () => {
  it('keeps the chosen person through offline, a change of person and the resume', async () => {
    const { sent, send } = network(() => ADDED);
    const { state, connection } = device(false);
    let chosen = 'person-1';
    const queue = queueWith(send, { connection, scopeFor: () => chosen });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    chosen = 'person-2';
    await queue.add([{ file: photo('b.jpg'), path: '' }]);
    state.online = true;
    queue.resumeAfterConnection();
    await queue.whenIdle();
    expect(sent.map((s) => [s.name, s.scope])).toEqual([
      ['a.jpg', 'person-1'],
      ['b.jpg', 'person-2'],
    ]);
  });

  it('Try Again after a change of person still sends to the first person', async () => {
    let first = true;
    const { sent, send } = network(() => {
      if (first) {
        first = false;
        return UNKNOWN;
      }
      return ADDED;
    });
    let chosen = 'person-1';
    const queue = queueWith(send, { scopeFor: () => chosen });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    chosen = 'person-2';
    const id = queue.list()[0]?.id ?? 0;
    queue.retry(id);
    await queue.whenIdle();
    expect(sent.map((s) => s.scope)).toEqual(['person-1', 'person-1']);
  });
});

describe('a file waiting out a busy answer when the connection goes', () => {
  it('waits for the connection instead of sending into nothing', async () => {
    const { state, connection } = device(true);
    const { sent, send } = network(() =>
      sent.length === 1 ? { kind: 'busy', message: null, retryAfterSeconds: 1 } : ADDED,
    );
    const queue = queueWith(send, {
      connection,
      wait: async () => {
        state.online = false;
      },
    });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    expect(sent).toHaveLength(1);
    expect(queue.list()[0]?.state).toBe('queued');
    expect(queue.list()[0]?.attempts).toBe(1);
    expect(queue.waitingForConnection).toBe(true);
    state.online = true;
    queue.resumeAfterConnection();
    await queue.whenIdle();
    expect(sent).toHaveLength(2);
    expect(queue.list()[0]?.state).toBe('added');
  });
});

describe('the waiting-for-connection line is never stale', () => {
  it('goes when Stop lists the waiting files as not added', async () => {
    const { send } = network(() => ADDED);
    const { connection } = device(false);
    const queue = queueWith(send, { connection });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    expect(queue.getSnapshot().waitingForConnection).toBe(true);
    queue.stop();
    expect(queue.list()[0]?.state).toBe('skipped');
    expect(queue.getSnapshot().waitingForConnection).toBe(false);
  });

  it('is not shown while paused (Resume, not the connection, sends them), and comes back on Resume', async () => {
    const { sent, send } = network(() => ADDED);
    const { state, connection } = device(false);
    const queue = queueWith(send, { connection });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    queue.pause();
    expect(queue.getSnapshot().waitingForConnection).toBe(false);
    queue.resume();
    expect(queue.getSnapshot().waitingForConnection).toBe(true);
    state.online = true;
    queue.resumeAfterConnection();
    await queue.whenIdle();
    expect(sent).toHaveLength(1);
    expect(queue.getSnapshot().waitingForConnection).toBe(false);
  });

  it('a file put back while paused after a no-answer send stays unsettled in the saved list (it may be stored)', async () => {
    const { state, connection } = device(true);
    const settled: string[] = [];
    let queue: ImportQueue | null = null;
    const { send } = network(() => {
      queue?.pause();
      state.online = false;
      return UNKNOWN;
    });
    queue = queueWith(send, {
      connection,
      retryUnknown: true,
      onSettled: (item) => settled.push(item.state),
    });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    expect(queue.list()[0]?.state).toBe('paused');
    expect(settled).toEqual([]);
  });
});

describe('TURN fixes (Q6)', () => {
  it('Stop after a no-answer send put back offline says Not Confirmed, never not added', async () => {
    const { state, connection } = device(true);
    const settled: string[] = [];
    const { send } = network(() => {
      state.online = false;
      return UNKNOWN;
    });
    const queue = queueWith(send, {
      connection,
      retryUnknown: true,
      onSettled: (item) => settled.push(item.state),
    });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    expect(queue.list()[0]?.state).toBe('queued');
    queue.stop();
    expect(queue.list()[0]?.state).toBe('unknown');
    expect(settled).toEqual(['unknown']);
  });

  it('Pause then Stop after such a send also says Not Confirmed', async () => {
    const { state, connection } = device(true);
    const settled: string[] = [];
    const { send } = network(() => {
      state.online = false;
      return UNKNOWN;
    });
    const queue = queueWith(send, {
      connection,
      retryUnknown: true,
      onSettled: (item) => settled.push(item.state),
    });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    queue.pause();
    queue.stop();
    expect(queue.list()[0]?.state).toBe('unknown');
    expect(settled).toEqual(['unknown']);
  });

  it('reads the chosen person once: a change while the upload ids are worked out changes nothing', async () => {
    const { sent, send } = network(() => ADDED);
    let chosen = 'person-a';
    const scopesForIds: string[] = [];
    const queue = queueWith(send, {
      scopeFor: () => chosen,
      uploadIdFor: async (file, scope) => {
        scopesForIds.push(scope);
        chosen = 'person-b';
        await flush();
        return `${scope}:${file.name}`;
      },
    });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(scopesForIds).toEqual(['person-a']);
    expect(sent.map((s) => [s.scope, s.uploadId])).toEqual([['person-a', 'person-a:a.jpg']]);
  });

  it('a flapping connection cannot resend a file without limit', async () => {
    const { state, connection } = device(true);
    const { sent, send } = network(() => {
      state.online = false;
      return UNKNOWN;
    });
    const queue = queueWith(send, { connection, retryUnknown: true });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    for (let wake = 0; wake < 20; wake++) {
      await flush();
      state.online = true;
      await queue.resumeAfterConnection();
    }
    await flush();
    // Three sends free of charge, then the normal three attempts: never more.
    expect(sent.length).toBeLessThanOrEqual(6);
    expect(queue.list()[0]?.state).toBe('unknown');
    const before = sent.length;
    state.online = true;
    await queue.resumeAfterConnection();
    await flush();
    expect(sent).toHaveLength(before);
  });
});

describe('the account check before a resume (Q6 hardening)', () => {
  it('another account or signed out: nothing is sent and the files are dropped', async () => {
    const { sent, send } = network(() => ADDED);
    const { state, connection } = device(false);
    const confirmResume = vi.fn(async () => false);
    const queue = queueWith(send, { connection, confirmResume });
    await queue.add([
      { file: photo('a.jpg'), path: '' },
      { file: photo('b.jpg'), path: '' },
    ]);
    await flush();
    state.online = true;
    await queue.resumeAfterConnection();
    await flush();
    expect(confirmResume).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
    expect(queue.list().map((item) => item.state)).toEqual(['skipped', 'skipped']);
    expect(queue.list().some((item) => item.state === 'added')).toBe(false);
    expect(queue.getSnapshot().waitingForConnection).toBe(false);
    // Not even Try Again can send them now.
    for (const item of queue.list()) queue.retry(item.id);
    await flush();
    expect(sent).toHaveLength(0);
  });

  it('the same account: the check passes and the files go', async () => {
    const { sent, send } = network(() => ADDED);
    const { state, connection } = device(false);
    const queue = queueWith(send, { connection, confirmResume: async () => true });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    state.online = true;
    await queue.resumeAfterConnection();
    await queue.whenIdle();
    expect(sent).toHaveLength(1);
  });

  it('no answer to the check: asked again on its own; after three in a row the files are dropped', async () => {
    const { sent, send } = network(() => ADDED);
    const { state, connection } = device(false);
    const confirmResume = vi.fn(async () => null);
    const queue = queueWith(send, { connection, confirmResume });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    state.online = true;
    await queue.resumeAfterConnection();
    await flush();
    expect(confirmResume).toHaveBeenCalledTimes(3);
    expect(sent).toHaveLength(0);
    expect(queue.list()[0]?.state).toBe('skipped');
    expect(queue.list()[0]?.skipReason).toBe('signed-out');
  });
});

describe('second review round (Q6)', () => {
  it('Resume after Pause cannot skip the account check', async () => {
    const { sent, send } = network(() => ADDED);
    const { state, connection } = device(false);
    const confirmResume = vi.fn(async () => false);
    const queue = queueWith(send, { connection, confirmResume });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    queue.pause();
    state.online = true;
    queue.resume();
    await flush();
    expect(confirmResume).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
  });

  it('a new file added once back online cannot skip the account check', async () => {
    const { sent, send } = network(() => ADDED);
    const { state, connection } = device(false);
    const confirmResume = vi.fn(async () => false);
    const queue = queueWith(send, { connection, confirmResume });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    state.online = true;
    await queue.add([{ file: photo('b.jpg'), path: '' }]);
    await flush();
    expect(confirmResume).toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('a send finishing after the drop cannot start the waiting files without the check', async () => {
    const { state, connection } = device(true);
    let release: (value: UploadOutcome) => void = () => undefined;
    const sent: string[] = [];
    const send: ImportSend = (request) => {
      sent.push((request.file as File).name);
      if (sent.length === 1) {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve(ADDED);
    };
    const confirmResume = vi.fn(async () => false);
    const queue = queueWith(send, { connection, confirmResume });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    // b is chosen while a is on its way and the connection is gone: b waits for it.
    state.online = false;
    await queue.add([{ file: photo('b.jpg'), path: '' }]);
    await flush();
    expect(queue.getSnapshot().waitingForConnection).toBe(true);
    state.online = true;
    release(ADDED);
    await flush();
    await flush();
    expect(confirmResume).toHaveBeenCalled();
    expect(sent).toEqual(['a.jpg']);
  });

  it('the no-answer count starts again after a drop', async () => {
    const { sent, send } = network(() => ADDED);
    const { state, connection } = device(false);
    let answers: (boolean | null)[] = [null, null, null];
    const queue = queueWith(send, {
      connection,
      confirmResume: async () => (answers.length > 0 ? (answers.shift() as boolean | null) : true),
    });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    state.online = true;
    await queue.resumeAfterConnection();
    expect(queue.list()[0]?.skipReason).toBe('signed-out');
    state.online = false;
    answers = [null, true];
    await queue.add([{ file: photo('b.jpg'), path: '' }]);
    await flush();
    state.online = true;
    await queue.resumeAfterConnection();
    await queue.whenIdle();
    expect(sent.map((s) => s.name)).toEqual(['b.jpg']);
  });

  it('Try Again on a Not Confirmed file, then Stop: still Not Confirmed', async () => {
    let first = true;
    const { send } = network(() => {
      if (first) {
        first = false;
        return UNKNOWN;
      }
      return ADDED;
    });
    const { state, connection } = device(true);
    const queue = queueWith(send, { connection });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    expect(queue.list()[0]?.state).toBe('unknown');
    state.online = false;
    queue.retry(queue.list()[0]?.id ?? 0);
    await flush();
    expect(queue.list()[0]?.state).toBe('queued');
    queue.stop();
    expect(queue.list()[0]?.state).toBe('unknown');
  });

  it('a busy answer after a no-answer send, then Stop: Not Confirmed, never not added', async () => {
    let call = 0;
    let queue: ImportQueue | null = null;
    const { send } = network(() => {
      call++;
      if (call === 1) return UNKNOWN;
      queue?.stop();
      return { kind: 'busy', message: null, retryAfterSeconds: 1 };
    });
    queue = queueWith(send, { retryUnknown: true });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await queue.whenIdle();
    await flush();
    expect(queue.list()[0]?.state).toBe('unknown');
  });

  it('files dropped for another sign-in are never offered Try Again', async () => {
    const { send } = network(() => ADDED);
    const { state, connection } = device(false);
    const queue = queueWith(send, { connection, confirmResume: async () => false });
    await queue.add([{ file: photo('a.jpg'), path: '' }]);
    await flush();
    state.online = true;
    await queue.resumeAfterConnection();
    const item = queue.list()[0];
    expect(item?.skipReason).toBe('signed-out');
    expect(item ? canTryAgain(item) : true).toBe(false);
  });
});
