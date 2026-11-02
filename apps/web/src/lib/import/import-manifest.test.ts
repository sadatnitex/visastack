import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ImportManifest,
  MANIFEST_TTL_MS,
  MAX_MANIFEST_ENTRIES,
  SAVE_DELAY_MS,
  type StorageLike,
  sha256Hex,
} from './import-manifest';
import { ImportQueue, type ImportSend } from './import-queue';

/** The saved list that lets an import pick up after a reload. Made-up file names only. */

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  writes = 0;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes++;
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

class BlockedStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('SecurityError');
  }
  setItem(): void {
    throw new Error('QuotaExceededError');
  }
  removeItem(): void {
    throw new Error('SecurityError');
  }
}

const KEY = 'visastack.import.v2.a-1';
const file = (name: string) => ({ name, size: 10, lastModified: 1 });
const ended = (name: string, state: 'added' | 'duplicate' | 'unknown' | 'refused' | 'skipped') => ({
  ...file(name),
  state,
  earlier: false,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the saved import list', () => {
  it('keeps only a SHA-256 of name, size and date with the ending and a time; never a name or path', async () => {
    const storage = new MemoryStorage();
    const manifest = new ImportManifest('a-1', { storage });
    await manifest.record(ended('Passport Nazmus.jpg', 'added'));
    manifest.flush();
    const raw = storage.getItem(KEY) ?? '';
    expect(raw).not.toContain('Passport');
    expect(raw).not.toContain('Nazmus');
    const saved = JSON.parse(raw) as { h: string; e: string; at: number }[];
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0] ?? {}).sort()).toEqual(['at', 'e', 'h']);
    expect(saved[0]?.h).toBe(await sha256Hex('Passport Nazmus.jpg\u000010\u00001'));
    expect(saved[0]?.h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('removes the first version of the list, which held names, wherever it finds it', () => {
    const storage = new MemoryStorage();
    storage.setItem('visastack.import.v1.a-1', '[{"name":"passport.jpg"}]');
    new ImportManifest('a-1', { storage });
    expect(storage.getItem('visastack.import.v1.a-1')).toBeNull();
  });

  it('remembers added and unknown files per traveller, and forgets refused ones', async () => {
    const storage = new MemoryStorage();
    const first = new ImportManifest('a-1', { storage });
    await first.record(ended('done.jpg', 'added'));
    await first.record(ended('unsure.jpg', 'unknown'));
    await first.record(ended('refused.jpg', 'refused'));
    first.flush();

    const again = new ImportManifest('a-1', { storage });
    expect(await again.earlierState(file('done.jpg'))).toBe('added');
    expect(await again.earlierState(file('unsure.jpg'))).toBe('unknown');
    expect(await again.earlierState(file('refused.jpg'))).toBeNull();
    expect(await again.earlierState({ name: 'done.jpg', size: 11, lastModified: 1 })).toBeNull();
    expect(await new ImportManifest('a-2', { storage }).earlierState(file('done.jpg'))).toBeNull();
  });

  it('saves the before-send mark at once, and other changes together a moment later', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const manifest = new ImportManifest('a-1', { storage });
    await manifest.markSending(file('a.jpg'));
    expect(storage.writes).toBe(1);
    expect(await new ImportManifest('a-1', { storage }).earlierState(file('a.jpg'))).toBe(
      'unconfirmed',
    );
    await manifest.record(ended('a.jpg', 'added'));
    await manifest.record(ended('b.jpg', 'added'));
    expect(storage.writes).toBe(1);
    vi.advanceTimersByTime(SAVE_DELAY_MS);
    expect(storage.writes).toBe(2);
    expect(await new ImportManifest('a-1', { storage }).earlierState(file('a.jpg'))).toBe('added');
  });

  it('works the same, only without memory, when storage is blocked or holds nonsense, or hashing is missing', async () => {
    const blocked = new ImportManifest('a-1', { storage: new BlockedStorage() });
    await expect(blocked.markSending(file('a.jpg'))).resolves.toBeUndefined();
    await expect(blocked.record(ended('a.jpg', 'added'))).resolves.toBeUndefined();
    expect(() => blocked.flush()).not.toThrow();
    expect(() => blocked.clear()).not.toThrow();

    for (const junk of [
      '{',
      'null',
      '"text"',
      '{"a":1}',
      '[1,{"h":2},{"h":"x","e":"added","at":1}]',
    ]) {
      const storage = new MemoryStorage();
      storage.setItem(KEY, junk);
      expect(new ImportManifest('a-1', { storage }).list(), junk).toEqual([]);
    }

    const noCrypto = new ImportManifest('a-1', {
      storage: new MemoryStorage(),
      hash: async () => null,
    });
    await noCrypto.record(ended('a.jpg', 'added'));
    expect(noCrypto.size).toBe(0);
  });

  it('forgets entries past their time, keeps the list bounded, and Forget removes it all', async () => {
    const storage = new MemoryStorage();
    let now = 1_000_000;
    const manifest = new ImportManifest('a-1', { storage, now: () => now });
    await manifest.record(ended('old.jpg', 'added'));
    manifest.flush();
    now += MANIFEST_TTL_MS + 1;
    expect(new ImportManifest('a-1', { storage, now: () => now }).list()).toEqual([]);

    const big = new ImportManifest('a-2', { storage, now: () => now });
    for (let i = 0; i < MAX_MANIFEST_ENTRIES + 5; i++)
      await big.record(ended(`f${i}.jpg`, 'added'));
    big.flush();
    const reread = new ImportManifest('a-2', { storage, now: () => now });
    expect(reread.list()).toHaveLength(MAX_MANIFEST_ENTRIES);
    expect(await reread.earlierState(file('f0.jpg'))).toBeNull();

    reread.clear();
    expect(storage.getItem('visastack.import.v2.a-2')).toBeNull();
  });

  it('after a reload, a re-chosen folder sends only the files not already added, and a file mid-send is not confirmed', async () => {
    const storage = new MemoryStorage();
    const sent: string[] = [];
    let hang = false;
    const send: ImportSend = (request) => {
      sent.push((request.file as File).name);
      if (hang) return new Promise(() => undefined);
      return Promise.resolve({ kind: 'added', message: 'Added.', title: null });
    };
    const folder = ['one.jpg', 'two.jpg', 'three.jpg'].map((name) => ({
      file: new File([new Uint8Array(10)], name, { type: 'image/jpeg', lastModified: 1 }),
      path: `Trip/${name}`,
    }));
    const visit = () => {
      const manifest = new ImportManifest('a-1', { storage });
      return new ImportQueue({
        applicantId: 'a-1',
        rules: { limitBytes: 1000, limitLabel: '1 KB', pdfAccepted: false },
        concurrency: 1,
        send,
        earlierState: (each) => manifest.earlierState(each),
        beforeSend: (item) => manifest.markSending(item),
        onSettled: (item) => {
          void manifest.record(item).then(() => manifest.flush());
        },
      });
    };

    const first = visit();
    await first.add(folder.slice(0, 1));
    await first.whenIdle();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // The second file is on its way when the page goes.
    hang = true;
    await first.add(folder.slice(1, 2));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual(['one.jpg', 'two.jpg']);

    hang = false;
    const second = visit();
    await second.add(folder);
    await second.whenIdle();
    expect(sent).toEqual(['one.jpg', 'two.jpg', 'three.jpg']);
    expect(second.list().map((item) => [item.name, item.state, item.earlier])).toEqual([
      ['one.jpg', 'added', true],
      ['two.jpg', 'unknown', true],
      ['three.jpg', 'added', false],
    ]);
  });
});
