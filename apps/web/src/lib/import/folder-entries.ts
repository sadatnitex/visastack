/**
 * Reading a dropped or chosen folder in the browser (UMPE P2). Client only: nothing here reaches
 * the server. The folder path of each file is kept for display alone; the upload sends only the
 * file, exactly as a single upload does.
 *
 * - A drop: `DataTransferItem.webkitGetAsEntry()` gives each dropped file or folder; a folder is
 *   walked to the bottom, calling `readEntries` until it returns nothing (Chromium hands back at
 *   most 100 entries per call, so one call would lose the rest).
 * - A folder picker: `<input webkitdirectory>` gives every file with `webkitRelativePath`.
 * - Neither available: the plain files, as a multi-file picker gives them.
 *
 * Hidden and system files are left out and listed as left out. One import takes at most
 * `MAX_IMPORT_FILES`; every file past that is listed as over the limit, never dropped quietly.
 */

import type { ImportCandidate, SkippedEntry } from './import-queue';

/**
 * The most files one import sends: the hourly upload limit (200 an hour per account), so one
 * import can finish within an hour when nothing else was uploaded.
 */
export const MAX_IMPORT_FILES = 200;

/**
 * The most entries one walk looks at (files sent, files listed as not added). Past this the walk
 * stops and says so, so a drop of a whole disk cannot freeze the page.
 */
export const MAX_ENTRIES_LOOKED_AT = 5000;

/** The longest path shown; a longer one keeps its end, which names the file. */
export const MAX_PATH_LENGTH = 180;

export interface FolderReadResult {
  readonly files: readonly ImportCandidate[];
  readonly skipped: readonly SkippedEntry[];
  /** True when the walk stopped at `MAX_ENTRIES_LOOKED_AT` and more entries were left unread. */
  readonly truncated: boolean;
}

/** The parts of the File and Directory Entries API this uses, so tests can build a tree. */
export interface EntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  readonly fullPath: string;
}
export interface FileEntryLike extends EntryLike {
  file(success: (file: File) => void, failure?: (error: unknown) => void): void;
}
export interface DirectoryEntryLike extends EntryLike {
  createReader(): {
    readEntries(success: (entries: EntryLike[]) => void, failure?: (error: unknown) => void): void;
  };
}

const SYSTEM_NAMES = new Set([
  'thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  '__macosx',
  '$recycle.bin',
  'system volume information',
  'icon\r',
]);

/** A hidden or system file or folder: a name starting with a dot, or one the system makes. */
export function isHiddenName(name: string): boolean {
  return name.startsWith('.') || SYSTEM_NAMES.has(name.toLowerCase());
}

// Control characters and the direction overrides that can make a name read as something else.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * A folder path made safe to show: no control characters, no `..` or `.` parts, no leading slash,
 * forward slashes only, and at most `MAX_PATH_LENGTH` characters (the end kept).
 */
export function sanitizeRelativePath(raw: string): string {
  const parts = raw
    .replace(UNSAFE_CHARACTERS, '')
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '.' && part !== '..');
  const joined = parts.join('/');
  if (joined.length <= MAX_PATH_LENGTH) return joined;
  return `...${joined.slice(joined.length - (MAX_PATH_LENGTH - 3))}`;
}

/** The folder part of a cleaned path ('' for a file at the top). */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

class Collector {
  readonly files: ImportCandidate[] = [];
  readonly skipped: SkippedEntry[] = [];
  truncated = false;

  get lookedAt(): number {
    return this.files.length + this.skipped.length;
  }

  /** False once the walk has looked at as many entries as it may. */
  room(): boolean {
    if (this.lookedAt < MAX_ENTRIES_LOOKED_AT) return true;
    this.truncated = true;
    return false;
  }

  /** Whether one more file may be sent in this import. */
  canSend(): boolean {
    return this.files.length < MAX_IMPORT_FILES;
  }

  skip(name: string, path: string, reason: SkippedEntry['reason'], file?: File): void {
    this.skipped.push({
      name: name || 'File',
      path,
      size: file ? file.size : null,
      lastModified: file ? file.lastModified : 0,
      reason,
    });
  }

  /** A file from a picker or a loose drop, with its folder path when it has one. */
  take(file: File, rawPath: string): void {
    if (!this.room()) return;
    const path = sanitizeRelativePath(rawPath);
    const parts = rawPath.split(/[\\/]+/).filter(Boolean);
    if (parts.some(isHiddenName) || isHiddenName(file.name)) {
      this.skip(file.name, path, 'hidden', file);
      return;
    }
    if (!this.canSend()) {
      this.skip(file.name, path, 'over-limit', file);
      return;
    }
    this.files.push({ file, path: path.includes('/') ? path : '' });
  }

  result(): FolderReadResult {
    return { files: this.files, skipped: this.skipped, truncated: this.truncated };
  }
}

/**
 * Files from a file input. With `webkitdirectory` each carries `webkitRelativePath`; without it,
 * the plain files. The same limit and the same hidden-file rule apply either way.
 */
export function readChosenFiles(chosen: readonly File[]): FolderReadResult {
  const collector = new Collector();
  for (const file of chosen) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    collector.take(file, relative || file.name);
  }
  return collector.result();
}

/** What a drop holds, captured while the drop event is still running (the browser clears it after). */
export interface CapturedDrop {
  readonly entries: readonly EntryLike[];
  readonly loose: readonly File[];
}

/**
 * Takes what a drop holds, synchronously: the browser empties `DataTransfer` once the event
 * handler returns, so the entries must be taken before any waiting.
 */
export function captureDrop(transfer: DataTransfer): CapturedDrop {
  const entries: EntryLike[] = [];
  const loose: File[] = [];
  const items = transfer.items ? Array.from(transfer.items) : [];
  if (items.length === 0) return { entries, loose: Array.from(transfer.files ?? []) };
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry =
      typeof item.webkitGetAsEntry === 'function'
        ? (item.webkitGetAsEntry() as EntryLike | null)
        : null;
    if (entry) {
      entries.push(entry);
      continue;
    }
    const file = item.getAsFile();
    if (file) loose.push(file);
  }
  return { entries, loose };
}

function readBatch(reader: ReturnType<DirectoryEntryLike['createReader']>): Promise<EntryLike[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function fileOf(entry: FileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** The path of an entry without its leading slash ('/Trip/passport.jpg' is 'Trip/passport.jpg'). */
function entryPath(entry: EntryLike): string {
  return entry.fullPath || entry.name;
}

async function walk(entry: EntryLike, collector: Collector): Promise<void> {
  if (!collector.room()) return;
  const path = sanitizeRelativePath(entryPath(entry));
  if (isHiddenName(entry.name)) {
    // A hidden folder is one line, not one per file inside it.
    collector.skip(entry.name, path, 'hidden');
    return;
  }
  if (entry.isFile) {
    if (!collector.canSend()) {
      // Past the limit the file is never opened; its name is enough for its line.
      collector.skip(entry.name, path, 'over-limit');
      return;
    }
    try {
      const file = await fileOf(entry as FileEntryLike);
      collector.files.push({ file, path: path.includes('/') ? path : '' });
    } catch {
      collector.skip(entry.name, path, 'unreadable');
    }
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as DirectoryEntryLike).createReader();
  for (;;) {
    let batch: EntryLike[];
    try {
      batch = await readBatch(reader);
    } catch {
      collector.skip(entry.name, path, 'unreadable');
      return;
    }
    if (batch.length === 0) return;
    for (const child of batch) {
      await walk(child, collector);
      if (collector.truncated) return;
    }
  }
}

/** Reads everything a drop held: folders walked to the bottom, loose files as they are. */
export async function readDrop(captured: CapturedDrop): Promise<FolderReadResult> {
  const collector = new Collector();
  for (const file of captured.loose) collector.take(file, file.name);
  for (const entry of captured.entries) {
    await walk(entry, collector);
    if (collector.truncated) break;
  }
  return collector.result();
}

/** Whether this browser offers a folder picker. */
export function folderPickerSupported(input: HTMLInputElement | null): boolean {
  return input !== null && 'webkitdirectory' in input;
}
