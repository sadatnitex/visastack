import { describe, expect, it, vi } from 'vitest';
import { type BackupStore, nextListingToken, runBackupPrune } from './backup-prune';
import {
  type BackupManifest,
  type BackupObject,
  LATEST_MANIFEST_KEY,
  manifestKeyFor,
  parseBackupManifest,
  planBackupPrune,
} from './backup-retention';

/**
 * Retention for encrypted database archives (S27): what a prune may remove, on a fake object list.
 * The guards: nothing is deleted unless BACKUP_PRUNE is exactly "on"; the newest 7 verified
 * archives are never deleted, whatever their age; nothing is deleted when captures look stalled.
 */

const NOW = new Date('2026-12-31T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const SIZE = 1000;

function at(daysAgo: number): Date {
  return new Date(NOW.getTime() - daysAgo * DAY);
}

function archiveKey(daysAgo: number): string {
  return `database/backup-${String(daysAgo).padStart(4, '0')}d.sql.vsbk`;
}

function orphanKey(daysAgo: number): string {
  return `database/orphan-${String(daysAgo).padStart(4, '0')}d.sql.vsbk`;
}

function manifestText(key: string, completedAt: Date, size = SIZE): string {
  return JSON.stringify({
    version: 1,
    scope: 'database-only',
    objectKey: key,
    sha256: 'a'.repeat(64),
    size,
    completedAt: completedAt.toISOString(),
    keyId: 'backup-v1',
  });
}

/** One verified archive per listed age (in days), plus its manifest, plus latest.json for the newest. */
function world(ages: readonly number[], options: { orphans?: readonly number[] } = {}) {
  const objects: BackupObject[] = [];
  const texts = new Map<string, string>();
  for (const age of ages) {
    const key = archiveKey(age);
    objects.push({ key, size: SIZE, lastModified: at(age) });
    const text = manifestText(key, at(age));
    objects.push({ key: manifestKeyFor(key), size: text.length, lastModified: at(age) });
    texts.set(manifestKeyFor(key), text);
  }
  for (const age of options.orphans ?? []) {
    objects.push({ key: orphanKey(age), size: SIZE, lastModified: at(age) });
  }
  const newest = Math.min(...ages);
  if (Number.isFinite(newest)) {
    const latest = manifestText(archiveKey(newest), at(newest));
    objects.push({ key: LATEST_MANIFEST_KEY, size: latest.length, lastModified: at(newest) });
    texts.set(LATEST_MANIFEST_KEY, latest);
  }
  const manifests = new Map<string, BackupManifest | null>();
  for (const [key, text] of texts) {
    if (key !== LATEST_MANIFEST_KEY) manifests.set(key, parseBackupManifest(text, NOW));
  }
  return {
    objects,
    texts,
    manifests,
    latestObjectKey: Number.isFinite(newest) ? archiveKey(newest) : null,
  };
}

function plan(ages: readonly number[], options: { orphans?: readonly number[] } = {}) {
  const w = world(ages, options);
  return planBackupPrune({ ...w, now: NOW });
}

function removedArchives(result: ReturnType<typeof plan>): string[] {
  return result.remove.map((item) => item.key).filter((key) => key.endsWith('.sql.vsbk'));
}

function fakeStore(
  w: ReturnType<typeof world>,
): BackupStore & { remove: ReturnType<typeof vi.fn> } {
  return {
    list: async () => w.objects,
    readText: async (key) => w.texts.get(key) ?? null,
    remove: vi.fn(async () => undefined),
  };
}

describe('planBackupPrune', () => {
  it('keeps every archive from the last 35 days', () => {
    const ages = Array.from({ length: 36 }, (_, day) => day);
    expect(removedArchives(plan(ages))).toEqual([]);
  });

  it('keeps the newest archive of each of the 12 most recent calendar weeks after that, and nothing older', () => {
    // Daily archives for 200 days.
    const ages = Array.from({ length: 200 }, (_, day) => day);
    const result = plan(ages);
    const kept = new Set(result.keep.map((item) => item.key));
    for (let day = 0; day <= 35; day++) expect(kept.has(archiveKey(day))).toBe(true);
    // Fixed calendar weeks counted from the epoch: the youngest archive older than 35 days in each.
    const week = (age: number) => Math.floor(at(age).getTime() / (7 * DAY));
    const lineWeek = week(35);
    const weekly: number[] = [];
    for (let age = 36; age < 200; age++) {
      if (week(age) > lineWeek - 12 && !weekly.some((taken) => week(taken) === week(age))) {
        weekly.push(age);
      }
    }
    // 12 weeks, or 11 when the week holding the 35-day line has no archive older than the line.
    expect(weekly.length).toBeGreaterThanOrEqual(11);
    expect(weekly.length).toBeLessThanOrEqual(12);
    for (const age of weekly) expect(kept.has(archiveKey(age))).toBe(true);
    expect(kept.size).toBe(36 + weekly.length);
    expect(Math.max(...weekly)).toBeLessThanOrEqual(35 + 12 * 7);
    // Each removed archive goes with its manifest.
    for (const key of removedArchives(result)) {
      expect(result.remove.map((item) => item.key)).toContain(manifestKeyFor(key));
    }
    expect(removedArchives(result)).toHaveLength(200 - kept.size);
  });

  it('settles at about 35 dailies plus 12 weeklies, oldest about 119 days, with a daily capture and a daily prune', () => {
    // Day by day for 200 days: capture at 05:17, then prune at once with pruning on.
    const start = new Date('2026-03-01T05:17:00Z').getTime();
    let objects: BackupObject[] = [];
    const manifests = new Map<string, BackupManifest | null>();
    let latest: string | null = null;
    let now = new Date(start);
    for (let day = 0; day < 200; day++) {
      now = new Date(start + day * DAY);
      const key = `database/day-${String(day).padStart(3, '0')}.sql.vsbk`;
      const text = manifestText(key, now);
      objects.push({ key, size: SIZE, lastModified: now });
      objects.push({ key: manifestKeyFor(key), size: text.length, lastModified: now });
      manifests.set(manifestKeyFor(key), parseBackupManifest(text, now));
      latest = key;
      const result = planBackupPrune({ objects, manifests, latestObjectKey: latest, now });
      expect(result.paused).toBeNull();
      const removed = new Set(result.remove.map((item) => item.key));
      objects = objects.filter((object) => !removed.has(object.key));
    }
    const archives = objects.filter((object) => object.key.endsWith('.sql.vsbk'));
    const ages = archives.map((object) => (now.getTime() - object.lastModified.getTime()) / DAY);
    const dailies = ages.filter((age) => age <= 35).length;
    const weeklies = ages.filter((age) => age > 35).length;
    expect(dailies).toBe(36);
    expect(weeklies).toBeGreaterThanOrEqual(11);
    expect(weeklies).toBeLessThanOrEqual(12);
    expect(Math.max(...ages)).toBeGreaterThanOrEqual(112);
    expect(Math.max(...ages)).toBeLessThanOrEqual(126);
    // Every manifest left belongs to an archive that is still there.
    const left = new Set(archives.map((object) => object.key));
    for (const object of objects) {
      if (object.key.endsWith('.manifest.json')) {
        expect(left.has(object.key.replace(/\.manifest\.json$/, ''))).toBe(true);
      }
    }
  });

  it('never deletes the newest 7 verified archives, however old they are', () => {
    // Captures ran only now and then: the 7 newest are months apart, the newest only a day old.
    const ages = [1, 60, 120, 180, 240, 300, 360, 400, 500];
    const result = plan(ages);
    const removed = removedArchives(result);
    for (const age of [1, 60, 120, 180, 240, 300, 360]) {
      expect(removed).not.toContain(archiveKey(age));
    }
    expect(removed).toEqual([archiveKey(400), archiveKey(500)]);
  });

  it('removes nothing when the newest verified archive is older than 2 days, or none is verified', () => {
    const stale = plan(Array.from({ length: 200 }, (_, day) => day + 3));
    expect(stale.paused).toMatch(/older than 2 days/);
    expect(stale.remove).toEqual([]);
    const none = plan([], { orphans: [10, 20] });
    expect(none.paused).toMatch(/no archive has a verified manifest/);
    expect(none.remove).toEqual([]);
    expect(none.orphans).toEqual([
      { key: orphanKey(10), removable: true },
      { key: orphanKey(20), removable: true },
    ]);
  });

  it('reports archives with no verified manifest, and removes them only once older than 2 days', () => {
    const result = plan([0, 1], { orphans: [1, 3] });
    expect(result.orphans).toEqual([
      { key: orphanKey(1), removable: false },
      { key: orphanKey(3), removable: true },
    ]);
    expect(result.remove.map((item) => item.key)).toEqual([orphanKey(3)]);
  });

  it('treats an archive whose manifest names another archive or another size as unverified', () => {
    const w = world([0, 1, 2]);
    const key = archiveKey(2);
    w.manifests.set(manifestKeyFor(key), { objectKey: key, size: SIZE + 1, completedAt: at(2) });
    const result = planBackupPrune({ ...w, now: NOW });
    expect(result.verified).toBe(2);
    expect(result.orphans).toEqual([{ key, removable: false }]);
  });

  it('never removes the archive latest.json names, nor anything that is not an archive or manifest', () => {
    const w = world(Array.from({ length: 200 }, (_, day) => day));
    w.objects.push({ key: 'database/notes.txt', size: 5, lastModified: at(400) });
    const result = planBackupPrune({ ...w, latestObjectKey: archiveKey(150), now: NOW });
    const removed = result.remove.map((item) => item.key);
    expect(removed).not.toContain(archiveKey(150));
    expect(removed).not.toContain('database/notes.txt');
    expect(removed).not.toContain(LATEST_MANIFEST_KEY);
  });

  it('reads only well-formed manifests, and refuses one completed in the future beyond clock skew', () => {
    expect(parseBackupManifest('not json', NOW)).toBeNull();
    expect(parseBackupManifest(JSON.stringify({ version: 1 }), NOW)).toBeNull();
    const good = manifestText(archiveKey(1), at(1));
    expect(parseBackupManifest(good, NOW)).toEqual({
      objectKey: archiveKey(1),
      size: SIZE,
      completedAt: at(1),
    });
    expect(
      parseBackupManifest(good.replace(archiveKey(1), 'documents/clean/secret.sql.vsbk'), NOW),
    ).toBeNull();
    const minutesAhead = (minutes: number) =>
      manifestText(archiveKey(0), new Date(NOW.getTime() + minutes * 60 * 1000));
    expect(parseBackupManifest(minutesAhead(9), NOW)).not.toBeNull();
    expect(parseBackupManifest(minutesAhead(11), NOW)).toBeNull();
    expect(parseBackupManifest(minutesAhead(60 * 24 * 30), NOW)).toBeNull();
  });

  it('deletes an old orphan archive together with its manifest file, and old manifests whose archive is gone', () => {
    const w = world([0, 1]);
    const orphan = orphanKey(5);
    w.objects.push({ key: orphan, size: SIZE, lastModified: at(5) });
    // A manifest that does not verify (wrong size), so the archive is an orphan.
    w.objects.push({ key: manifestKeyFor(orphan), size: 10, lastModified: at(5) });
    w.manifests.set(manifestKeyFor(orphan), { objectKey: orphan, size: 1, completedAt: at(5) });
    const gone = (age: number) => manifestKeyFor(`database/gone-${age}d.sql.vsbk`);
    w.objects.push({ key: gone(4), size: 10, lastModified: at(4) });
    w.objects.push({ key: gone(1), size: 10, lastModified: at(1) });
    const removed = planBackupPrune({ ...w, now: NOW }).remove.map((item) => item.key);
    expect(removed).toEqual([orphan, manifestKeyFor(orphan), gone(4)]);
  });
});

describe('runBackupPrune', () => {
  const ages = Array.from({ length: 200 }, (_, day) => day);

  it.each([undefined, '', 'true', 'ON', 'yes'])(
    'deletes nothing and says what it would delete when BACKUP_PRUNE is %j',
    async (setting) => {
      const w = world(ages);
      const store = fakeStore(w);
      const lines: string[] = [];
      const outcome = await runBackupPrune({
        store,
        pruneSetting: setting,
        now: NOW,
        log: (line) => lines.push(line),
      });
      expect(store.remove).not.toHaveBeenCalled();
      expect(outcome.deleted).toEqual([]);
      expect(outcome.mode).toBe('report');
      expect(lines.some((line) => line.startsWith('Would delete: '))).toBe(true);
      expect(lines.at(-1)).toMatch(/Report only/);
    },
  );

  it('deletes exactly the plan when BACKUP_PRUNE is "on"', async () => {
    const w = world(ages);
    const store = fakeStore(w);
    const outcome = await runBackupPrune({
      store,
      pruneSetting: 'on',
      now: NOW,
      log: () => undefined,
    });
    expect(store.remove).toHaveBeenCalledOnce();
    expect(store.remove.mock.calls[0]?.[0]).toEqual(outcome.plan.remove.map((item) => item.key));
    const keptArchives = outcome.plan.keep.length;
    expect(outcome.deleted).toHaveLength((200 - keptArchives) * 2);
  });

  it('reports the storage total and warns above 8 GB', async () => {
    const lines: string[] = [];
    const w = world([0, 1]);
    w.objects.push({ key: archiveKey(5), size: 9 * 1000 ** 3, lastModified: at(5) });
    await runBackupPrune({
      store: fakeStore(w),
      pruneSetting: undefined,
      now: NOW,
      log: (line) => lines.push(line),
    });
    expect(lines[0]).toMatch(/^Backup storage: 9\.00 GB in \d+ objects; 2 verified archives\.$/);
    expect(lines.some((line) => line.startsWith('::warning title=Backup storage::'))).toBe(true);
  });

  it('refuses a listing page that says more follow but gives no way to read them', () => {
    expect(nextListingToken({ IsTruncated: false })).toBeUndefined();
    expect(nextListingToken({ IsTruncated: true, NextContinuationToken: 'next' })).toBe('next');
    expect(() => nextListingToken({ IsTruncated: true })).toThrow('incomplete backup listing');
    expect(() => nextListingToken({ IsTruncated: true, NextContinuationToken: '' })).toThrow();
  });

  it('stops before deleting anything when a manifest cannot be read', async () => {
    const w = world(ages);
    const store = fakeStore(w);
    store.readText = async () => {
      throw new Error('backup manifest unavailable');
    };
    await expect(
      runBackupPrune({ store, pruneSetting: 'on', now: NOW, log: () => undefined }),
    ).rejects.toThrow('unavailable');
    expect(store.remove).not.toHaveBeenCalled();
  });
});
