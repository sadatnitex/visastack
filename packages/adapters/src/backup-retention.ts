/**
 * Retention for the encrypted database archives in R2 (S27, owner decision): which archives a
 * prune may remove. Pure: it takes the listed objects and the parsed manifests and returns a
 * plan, so the rules are tested without any storage. `backup-prune.ts` runs it.
 *
 * Policy, for archives with a verified manifest (the immutable `<archive>.manifest.json` written
 * once by `backup-neon.ts`, naming this archive and its exact size):
 * - keep every archive completed in the last 35 days;
 * - keep the newest archive of each of the 12 weeks before that;
 * - keep the newest 7 verified archives whatever their age;
 * - keep the archive `database/latest.json` points at, verified or not;
 * - everything else may go, together with its manifest.
 * Archives without a verified manifest (a failed or interrupted run) are orphans: always reported,
 * and removable only once older than 2 days. Nothing is removed at all when there is no verified
 * archive, or when the newest one is older than 2 days, because then captures may be failing and
 * the old copies may be the only good ones. Anything else under the prefix is never touched.
 */

export const BACKUP_PREFIX = 'database/';
export const LATEST_MANIFEST_KEY = 'database/latest.json';
export const KEEP_ALL_DAYS = 35;
export const KEEP_WEEKLY_WEEKS = 12;
export const KEEP_NEWEST_VERIFIED = 7;
export const ORPHAN_MIN_AGE_MS = 2 * 24 * 60 * 60 * 1000;
export const STALE_CAPTURE_MS = 2 * 24 * 60 * 60 * 1000;
export const STORAGE_WARNING_BYTES = 8 * 1000 ** 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const ARCHIVE_KEY = /^database\/[A-Za-z0-9_-]+\.sql\.vsbk$/;

export interface BackupObject {
  readonly key: string;
  readonly size: number;
  readonly lastModified: Date;
}

/** The parts of a manifest the plan needs; null when the manifest exists but is not valid. */
export interface BackupManifest {
  readonly objectKey: string;
  readonly size: number;
  readonly completedAt: Date;
}

export interface BackupPruneInput {
  /** Everything listed under `database/`. */
  readonly objects: readonly BackupObject[];
  /** Parsed manifests by manifest key, for every manifest key in `objects`. */
  readonly manifests: ReadonlyMap<string, BackupManifest | null>;
  /** The archive `database/latest.json` names, or null when there is none. */
  readonly latestObjectKey: string | null;
  readonly now: Date;
}

export interface BackupPrunePlan {
  readonly totalBytes: number;
  readonly verified: number;
  /** Archive keys kept, with the rule that kept each. */
  readonly keep: readonly { readonly key: string; readonly reason: string }[];
  /** Object keys a prune may delete (archives and their manifests, old orphans). */
  readonly remove: readonly { readonly key: string; readonly reason: string }[];
  /** Archives with no verified manifest, whether or not they may be removed yet. */
  readonly orphans: readonly { readonly key: string; readonly removable: boolean }[];
  /** Set when nothing may be removed this time, and why. */
  readonly paused: string | null;
}

export function manifestKeyFor(archiveKey: string): string {
  return `${archiveKey}.manifest.json`;
}

/** The manifest fields the plan trusts, or null for anything malformed. */
export function parseBackupManifest(text: string): BackupManifest | null {
  try {
    const value = JSON.parse(text) as {
      version?: unknown;
      scope?: unknown;
      objectKey?: unknown;
      size?: unknown;
      sha256?: unknown;
      completedAt?: unknown;
    };
    const completedAt = typeof value.completedAt === 'string' ? new Date(value.completedAt) : null;
    if (
      value.version !== 1 ||
      value.scope !== 'database-only' ||
      typeof value.objectKey !== 'string' ||
      !ARCHIVE_KEY.test(value.objectKey) ||
      typeof value.size !== 'number' ||
      !(value.size > 0) ||
      typeof value.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !completedAt ||
      Number.isNaN(completedAt.getTime())
    ) {
      return null;
    }
    return { objectKey: value.objectKey, size: value.size, completedAt };
  } catch {
    return null;
  }
}

export function planBackupPrune(input: BackupPruneInput): BackupPrunePlan {
  const now = input.now.getTime();
  const totalBytes = input.objects.reduce((sum, object) => sum + object.size, 0);
  const archives = input.objects.filter((object) => ARCHIVE_KEY.test(object.key));
  const verified: { key: string; completedAt: number }[] = [];
  const orphanArchives: BackupObject[] = [];
  for (const archive of archives) {
    const manifest = input.manifests.get(manifestKeyFor(archive.key));
    if (manifest && manifest.objectKey === archive.key && manifest.size === archive.size) {
      verified.push({ key: archive.key, completedAt: manifest.completedAt.getTime() });
    } else {
      orphanArchives.push(archive);
    }
  }
  verified.sort((a, b) => b.completedAt - a.completedAt);

  const keepReasons = new Map<string, string>();
  const keep = (key: string, reason: string) => {
    if (!keepReasons.has(key)) keepReasons.set(key, reason);
  };
  if (input.latestObjectKey) keep(input.latestObjectKey, 'named by database/latest.json');
  for (const archive of verified.slice(0, KEEP_NEWEST_VERIFIED)) {
    keep(archive.key, `one of the newest ${KEEP_NEWEST_VERIFIED} verified archives`);
  }
  const weeklyTaken = new Set<number>();
  for (const archive of verified) {
    const age = now - archive.completedAt;
    if (age <= KEEP_ALL_DAYS * DAY_MS) {
      keep(archive.key, `completed in the last ${KEEP_ALL_DAYS} days`);
      continue;
    }
    const week = Math.floor((age - KEEP_ALL_DAYS * DAY_MS) / WEEK_MS);
    if (week < KEEP_WEEKLY_WEEKS && !weeklyTaken.has(week)) {
      weeklyTaken.add(week);
      keep(archive.key, 'newest archive of its week');
    }
  }

  const newest = verified[0];
  const paused =
    newest === undefined
      ? 'no archive has a verified manifest'
      : now - newest.completedAt > STALE_CAPTURE_MS
        ? 'the newest verified archive is older than 2 days, so captures may be failing'
        : null;

  const remove: { key: string; reason: string }[] = [];
  const orphans = orphanArchives.map((archive) => {
    const removable =
      !keepReasons.has(archive.key) && now - archive.lastModified.getTime() > ORPHAN_MIN_AGE_MS;
    return { key: archive.key, removable };
  });
  if (!paused) {
    for (const archive of verified) {
      if (keepReasons.has(archive.key)) continue;
      remove.push({ key: archive.key, reason: 'outside the retention rules' });
      remove.push({ key: manifestKeyFor(archive.key), reason: 'manifest of a removed archive' });
    }
    for (const orphan of orphans) {
      if (orphan.removable) {
        remove.push({ key: orphan.key, reason: 'no verified manifest, older than 2 days' });
      }
    }
  }
  return {
    totalBytes,
    verified: verified.length,
    keep: [...keepReasons].map(([key, reason]) => ({ key, reason })),
    remove,
    orphans,
    paused,
  };
}
