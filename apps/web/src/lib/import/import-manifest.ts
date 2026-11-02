/**
 * The small saved list that lets an import pick up after a reload (UMPE P2). It lives in this
 * browser only, one list per traveller, and holds for each file only a SHA-256 of its name, size
 * and date, how it ended and when: never a name, a folder path or the file itself. When the same
 * folder is chosen again, a file the list says was added is shown as added and not sent again
 * (Send Again is offered), and one it says was not confirmed, or was on its way when the page
 * went, stays not confirmed until the person chooses Try Again.
 *
 * A file is written as "unconfirmed" right before it is sent, and saved at once, so a reload during
 * the send never makes it look new. Other changes are saved together a moment later (and at once
 * when the page is hidden or the import finishes).
 *
 * Storage can be missing, full, blocked or hold anything at all, and Web Crypto can be missing:
 * every read and write is guarded, and the page works the same without it, only without memory.
 */

import {
  type EarlierState,
  type FileIdentity,
  type ImportItem,
  fingerprintOf,
} from './import-queue';

const KEY_PREFIX = 'visastack.import.v2.';
/** The first version stored names and paths; it is removed wherever it is found. */
const OLD_KEY_PREFIX = 'visastack.import.v1.';
/** Entries kept per traveller; the oldest go first. */
export const MAX_MANIFEST_ENTRIES = 2000;
/** How long an entry is remembered. */
export const MANIFEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Changes other than the before-send mark are saved together after this long. */
export const SAVE_DELAY_MS = 400;

export interface ManifestEntry {
  /** SHA-256, hex, of the name, size and date joined. */
  readonly h: string;
  /** How it ended. */
  readonly e: EarlierState;
  /** When (ms since 1970). */
  readonly at: number;
}

/** The part of `Storage` this uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type Hasher = (text: string) => Promise<string | null>;

/** SHA-256 hex through Web Crypto, or null where it is missing. */
export const sha256Hex: Hasher = async (text) => {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  } catch {
    return null;
  }
};

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const ENDINGS: ReadonlySet<string> = new Set(['added', 'duplicate', 'unknown', 'unconfirmed']);

function isEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as { readonly [K in keyof ManifestEntry]?: unknown };
  return (
    typeof entry.h === 'string' &&
    /^[0-9a-f]{64}$/.test(entry.h) &&
    typeof entry.e === 'string' &&
    ENDINGS.has(entry.e) &&
    typeof entry.at === 'number'
  );
}

/** One traveller's saved list, read once and written as files go out and settle. */
export class ImportManifest {
  private readonly key: string;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly hash: Hasher;
  private readonly entries = new Map<string, ManifestEntry>();
  /** Hashes already worked out this visit, by plain fingerprint (memory only). */
  private readonly hashes = new Map<string, string | null>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    applicantId: string,
    options: {
      readonly storage?: StorageLike | null;
      readonly now?: () => number;
      readonly hash?: Hasher;
    } = {},
  ) {
    this.key = `${KEY_PREFIX}${applicantId}`;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.now = options.now ?? Date.now;
    this.hash = options.hash ?? sha256Hex;
    try {
      this.storage?.removeItem(`${OLD_KEY_PREFIX}${applicantId}`);
    } catch {
      // Blocked storage holds nothing to remove.
    }
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
      if (isEntry(value) && value.at >= oldest) this.entries.set(value.h, value);
    }
  }

  private async hashOf(file: FileIdentity): Promise<string | null> {
    const plain = fingerprintOf(file);
    if (this.hashes.has(plain)) return this.hashes.get(plain) ?? null;
    const hashed = await this.hash(plain);
    this.hashes.set(plain, hashed);
    return hashed;
  }

  /** How an earlier visit left a file with this name, size and date, if it did. */
  async earlierState(file: FileIdentity): Promise<EarlierState | null> {
    if (this.entries.size === 0) return null;
    const hashed = await this.hashOf(file);
    return hashed ? (this.entries.get(hashed)?.e ?? null) : null;
  }

  /** How many files are remembered. */
  get size(): number {
    return this.entries.size;
  }

  /** Remembered entries (hashes, endings and times only). */
  list(): readonly ManifestEntry[] {
    return Array.from(this.entries.values());
  }

  /** Marks a file as on its way and saves at once: awaited before every send. */
  async markSending(item: Pick<ImportItem, 'name' | 'size' | 'lastModified'>): Promise<void> {
    if (item.size === null) return;
    const hashed = await this.hashOf({
      name: item.name,
      size: item.size,
      lastModified: item.lastModified,
    });
    if (!hashed) return;
    this.put(hashed, 'unconfirmed');
    this.saveNow();
  }

  /**
   * Records how a file ended in this visit. Added, duplicate and unknown are remembered; any other
   * ending (refused, not sent, held, paused) means nothing was stored, so the entry is removed.
   */
  async record(
    item: Pick<ImportItem, 'name' | 'size' | 'lastModified' | 'state' | 'earlier'>,
  ): Promise<void> {
    if (item.earlier || item.size === null) return;
    const hashed = await this.hashOf({
      name: item.name,
      size: item.size,
      lastModified: item.lastModified,
    });
    if (!hashed) return;
    if (item.state === 'added' || item.state === 'duplicate' || item.state === 'unknown') {
      this.put(hashed, item.state);
    } else if (this.entries.has(hashed)) {
      this.entries.delete(hashed);
    } else {
      return;
    }
    this.saveSoon();
  }

  /** Forgets the whole list for this traveller, in this browser. */
  clear(): void {
    this.entries.clear();
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      this.storage?.removeItem(this.key);
    } catch {
      // Nothing to do: without storage there was nothing remembered.
    }
  }

  /** Saves any change still waiting (the page is being hidden, or the import finished). */
  flush(): void {
    if (this.saveTimer === null) return;
    this.saveNow();
  }

  private put(hashed: string, ending: EarlierState): void {
    this.entries.delete(hashed);
    this.entries.set(hashed, { h: hashed, e: ending, at: this.now() });
    while (this.entries.size > MAX_MANIFEST_ENTRIES) {
      const first = this.entries.keys().next();
      if (first.done) break;
      this.entries.delete(first.value);
    }
  }

  private saveSoon(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
  }

  private saveNow(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      if (this.entries.size === 0) this.storage?.removeItem(this.key);
      else this.storage?.setItem(this.key, JSON.stringify(Array.from(this.entries.values())));
    } catch {
      // Full or blocked: the import carries on; only the memory for next time is lost.
    }
  }
}
