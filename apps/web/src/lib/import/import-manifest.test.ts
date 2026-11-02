import { describe, expect, it } from 'vitest';
import {
  ImportManifest,
  MANIFEST_TTL_MS,
  MAX_MANIFEST_ENTRIES,
  type StorageLike,
} from './import-manifest';
import { ImportQueue, type ImportSend } from './import-queue';

/** The saved list that lets an import pick up after a reload. Made-up file names only. */

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
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

const settledItem = (
  name: string,
  state: 'added' | 'duplicate' | 'unknown' | 'refused' | 'skipped',
) => ({ name, size: 10, lastModified: 1, path: `Trip/${name}`, state, earlier: false });

describe('the saved import list', () => {
  it('remembers added and unknown files per traveller, never the file itself', () => {
    const storage = new MemoryStorage();
    const first = new ImportManifest('a-1', { storage });
    first.record(settledItem('done.jpg', 'added'));
    first.record(settledItem('unsure.jpg', 'unknown'));
    first.record(settledItem('refused.jpg', 'refused'));
    first.record(settledItem('stopped.jpg', 'skipped'));

    const again = new ImportManifest('a-1', { storage });
    expect(again.earlierState({ name: 'done.jpg', size: 10, lastModified: 1 })).toBe('added');
    expect(again.earlierState({ name: 'unsure.jpg', size: 10, lastModified: 1 })).toBe('unknown');
    expect(again.earlierState({ name: 'refused.jpg', size: 10, lastModified: 1 })).toBeNull();
    // A different size or date is a different file.
    expect(again.earlierState({ name: 'done.jpg', size: 11, lastModified: 1 })).toBeNull();
    expect(again.earlierState({ name: 'done.jpg', size: 10, lastModified: 2 })).toBeNull();
    // Another traveller has their own list.
    expect(
      new ImportManifest('a-2', { storage }).earlierState({
        name: 'done.jpg',
        size: 10,
        lastModified: 1,
      }),
    ).toBeNull();
    const saved = JSON.parse(storage.getItem('visastack.import.v1.a-1') ?? '[]') as object[];
    expect(saved).toHaveLength(2);
    expect(Object.keys(saved[0] ?? {}).sort()).toEqual([
      'at',
      'lastModified',
      'name',
      'path',
      'size',
      'state',
    ]);
  });

  it('works the same, only without memory, when storage is blocked, full or holds nonsense', () => {
    const blocked = new ImportManifest('a-1', { storage: new BlockedStorage() });
    expect(() => blocked.record(settledItem('a.jpg', 'added'))).not.toThrow();
    expect(() => blocked.clear()).not.toThrow();
    expect(blocked.earlierState({ name: 'b.jpg', size: 10, lastModified: 1 })).toBeNull();

    for (const junk of ['{', 'null', '"text"', '{"a":1}', '[1,{"name":2},{"name":"x"}]']) {
      const storage = new MemoryStorage();
      storage.setItem('visastack.import.v1.a-1', junk);
      const manifest = new ImportManifest('a-1', { storage });
      expect(manifest.list(), junk).toEqual([]);
    }

    const none = new ImportManifest('a-1', { storage: null });
    none.record(settledItem('a.jpg', 'added'));
    expect(none.earlierState({ name: 'a.jpg', size: 10, lastModified: 1 })).toBe('added');
  });

  it('forgets entries past their time and keeps the list bounded', () => {
    const storage = new MemoryStorage();
    let now = 1_000_000;
    const manifest = new ImportManifest('a-1', { storage, now: () => now });
    manifest.record(settledItem('old.jpg', 'added'));
    now += MANIFEST_TTL_MS + 1;
    expect(new ImportManifest('a-1', { storage, now: () => now }).list()).toEqual([]);

    const big = new ImportManifest('a-2', { storage, now: () => now });
    for (let i = 0; i < MAX_MANIFEST_ENTRIES + 5; i++)
      big.record(settledItem(`f${i}.jpg`, 'added'));
    const reread = new ImportManifest('a-2', { storage, now: () => now });
    expect(reread.list()).toHaveLength(MAX_MANIFEST_ENTRIES);
    expect(reread.earlierState({ name: 'f0.jpg', size: 10, lastModified: 1 })).toBeNull();
  });

  it('after a reload, a re-chosen folder sends only the files not already added', async () => {
    const storage = new MemoryStorage();
    const sent: string[] = [];
    const send: ImportSend = async (request) => {
      sent.push((request.file as File).name);
      return {
        outcome: { kind: 'added', message: 'Added.', title: null },
        status: 201,
        retryAfter: null,
      };
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
        send,
        earlierState: (file) => manifest.earlierState(file),
        onSettled: (item) => manifest.record(item),
      });
    };

    const first = visit();
    first.add(folder.slice(0, 2));
    await first.whenIdle();
    expect(sent).toEqual(['one.jpg', 'two.jpg']);

    // The page is reloaded and the whole folder chosen again.
    const second = visit();
    second.add(folder);
    await second.whenIdle();
    expect(sent).toEqual(['one.jpg', 'two.jpg', 'three.jpg']);
    expect(second.getSnapshot().items.map((item) => [item.name, item.state, item.earlier])).toEqual(
      [
        ['one.jpg', 'added', true],
        ['two.jpg', 'added', true],
        ['three.jpg', 'added', false],
      ],
    );
  });
});
