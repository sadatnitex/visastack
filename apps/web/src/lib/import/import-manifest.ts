/**
 * The small saved list that lets an import pick up after a reload (UMPE P2). It lives in this
 * browser only, one list per traveller, and holds each settled file's name, size, date, folder
 * path and how it ended; never the file itself. When the same folder is chosen again, a file the
 * list says was added (same name, size and date) is shown as added and not sent again, and one it
 * says was not confirmed stays not confirmed until the person chooses Try Again.
 *
 * Storage can be missing, full, blocked or hold anything at all (a private window, cleared site
 * data, another version of the page): every read and write is guarded, and the page works the
 * same without it, only without the memory.
 */

import type { EarlierState, ImportItem } from './import-queue';

const KEY_PREFIX = 'visastack.import.v1.';
/** Entries kept per traveller; the oldest go first. */
export const MAX_MANIFEST_ENTRIES = 2000;
/** How long an entry is remembered. */
export const MANIFEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface ManifestEntry {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
  readonly path: string;
  readonly state: EarlierState;
  /** When it settled (ms since 1970). */
  readonly at: number;
}

/** The part of `Storage` this uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function fingerprint(file: {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
}): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const REMEMBERED: ReadonlySet<string> = new Set(['added', 'duplicate', 'unknown']);

function isEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as { readonly [K in keyof ManifestEntry]?: unknown };
  return (
    typeof entry.name === 'string' &&
    typeof entry.size === 'number' &&
    typeof entry.lastModified === 'number' &&
    typeof entry.path === 'string' &&
    typeof entry.state === 'string' &&
    REMEMBERED.has(entry.state) &&
    typeof entry.at === 'number'
  );
}

/** One traveller's saved list, read once and written as files settle. */
export class ImportManifest {
  private readonly key: string;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly entries = new Map<string, ManifestEntry>();

  constructor(
    applicantId: string,
    options: { readonly storage?: StorageLike | null; readonly now?: () => number } = {},
  ) {
    this.key = `${KEY_PREFIX}${applicantId}`;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.now = options.now ?? Date.now;
    this.load();
  }

  private load(): void {
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(this.key) ?? null;
    } catch {
      return;
    }
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    const oldest = this.now() - MANIFEST_TTL_MS;
    for (const value of parsed) {
      if (isEntry(value) && value.at >= oldest) this.entries.set(fingerprint(value), value);
    }
  }

  /** How an earlier visit left a file with this name, size and date, if it did. */
  earlierState(file: {
    readonly name: string;
    readonly size: number;
    readonly lastModified: number;
  }): EarlierState | null {
    return this.entries.get(fingerprint(file))?.state ?? null;
  }

  /** Remembered entries, for the note about an earlier import. */
  list(): readonly ManifestEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Remembers how a file ended. Only an added, duplicate or unknown file changes what happens next
   * time; any other ending clears what was remembered for it (a file refused now is sent again
   * when chosen again).
   */
  record(
    item: Pick<ImportItem, 'name' | 'size' | 'lastModified' | 'path' | 'state' | 'earlier'>,
  ): void {
    if (item.earlier || item.size === null) return;
    const id = fingerprint({ name: item.name, size: item.size, lastModified: item.lastModified });
    if (item.state === 'added' || item.state === 'duplicate' || item.state === 'unknown') {
      this.entries.delete(id);
      this.entries.set(id, {
        name: item.name,
        size: item.size,
        lastModified: item.lastModified,
        path: item.path,
        state: item.state,
        at: this.now(),
      });
    } else if (item.state === 'refused' && this.entries.get(id)?.state === 'unknown') {
      // A Try Again that was refused: the earlier "not confirmed" no longer applies.
      this.entries.delete(id);
    } else {
      return;
    }
    while (this.entries.size > MAX_MANIFEST_ENTRIES) {
      const first = this.entries.keys().next();
      if (first.done) break;
      this.entries.delete(first.value);
    }
    this.save();
  }

  /** Forgets the whole list for this traveller. */
  clear(): void {
    this.entries.clear();
    try {
      this.storage?.removeItem(this.key);
    } catch {
      // Nothing to do: without storage there was nothing remembered.
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(Array.from(this.entries.values())));
    } catch {
      // Full or blocked: the import carries on; only the memory for next time is lost.
    }
  }
}
