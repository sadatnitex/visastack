import { describe, expect, it } from 'vitest';
import {
  type DirectoryEntryLike,
  type EntryLike,
  type FileEntryLike,
  MAX_ENTRIES_LOOKED_AT,
  MAX_IMPORT_FILES,
  MAX_PATH_LENGTH,
  captureDrop,
  folderOf,
  isHiddenName,
  readChosenFiles,
  readDrop,
  sanitizeRelativePath,
} from './folder-entries';

/**
 * Reading a folder, with a made-up tree of entries standing in for what a browser hands over.
 * Chromium's `readEntries` returns at most 100 entries per call; the fake does the same.
 */

const BATCH = 100;

function fileEntry(fullPath: string, options: { readonly broken?: boolean } = {}): FileEntryLike {
  const name = fullPath.slice(fullPath.lastIndexOf('/') + 1);
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file(success, failure) {
      if (options.broken) failure?.(new Error('NotReadableError'));
      else success(new File([new Uint8Array(8)], name, { type: 'image/jpeg', lastModified: 5 }));
    },
  };
}

function dirEntry(fullPath: string, children: readonly EntryLike[]) {
  const name = fullPath.slice(fullPath.lastIndexOf('/') + 1);
  let calls = 0;
  const entry: DirectoryEntryLike & { readonly calls: () => number } = {
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    calls: () => calls,
    createReader() {
      let offset = 0;
      return {
        readEntries(success) {
          calls++;
          const batch = children.slice(offset, offset + BATCH);
          offset += batch.length;
          // Asynchronous, as in a browser.
          setTimeout(() => success([...batch]), 0);
        },
      };
    },
  };
  return entry;
}

describe('walking a dropped folder', () => {
  it('goes to the bottom of nested folders and keeps calling readEntries past 100 entries', async () => {
    const many = Array.from({ length: 150 }, (_, i) => fileEntry(`/Trip/Bank/statement-${i}.jpg`));
    const bank = dirEntry('/Trip/Bank', many);
    const deep = dirEntry('/Trip/Family/Child', [fileEntry('/Trip/Family/Child/birth.jpg')]);
    const family = dirEntry('/Trip/Family', [deep, fileEntry('/Trip/Family/marriage.jpg')]);
    const trip = dirEntry('/Trip', [bank, family, fileEntry('/Trip/passport.jpg')]);

    const result = await readDrop({ entries: [trip], loose: [] });
    expect(result.files).toHaveLength(153);
    expect(result.skipped).toEqual([]);
    expect(result.truncated).toBe(false);
    // 150 entries need a full call, a part call and an empty one to know the folder is done.
    expect(bank.calls()).toBe(3);
    const paths = result.files.map((each) => each.path);
    expect(paths).toContain('Trip/Bank/statement-149.jpg');
    expect(paths).toContain('Trip/Family/Child/birth.jpg');
    expect(paths).toContain('Trip/passport.jpg');
  });

  it('leaves hidden and system files out, and lists each one as left out', async () => {
    const tree = dirEntry('/Docs', [
      fileEntry('/Docs/.DS_Store'),
      fileEntry('/Docs/Thumbs.db'),
      fileEntry('/Docs/desktop.ini'),
      dirEntry('/Docs/.git', [fileEntry('/Docs/.git/config'), fileEntry('/Docs/.git/HEAD')]),
      dirEntry('/Docs/__MACOSX', [fileEntry('/Docs/__MACOSX/._passport.jpg')]),
      fileEntry('/Docs/passport.jpg'),
    ]);
    const result = await readDrop({ entries: [tree], loose: [] });
    expect(result.files.map((each) => each.path)).toEqual(['Docs/passport.jpg']);
    expect(result.skipped.map((each) => [each.path, each.reason])).toEqual([
      ['Docs/.DS_Store', 'hidden'],
      ['Docs/Thumbs.db', 'hidden'],
      ['Docs/desktop.ini', 'hidden'],
      // A hidden folder is one line, not one per file inside it.
      ['Docs/.git', 'hidden'],
      ['Docs/__MACOSX', 'hidden'],
    ]);
  });

  it('lists a file the browser could not read instead of losing it', async () => {
    const tree = dirEntry('/A', [
      fileEntry('/A/broken.jpg', { broken: true }),
      fileEntry('/A/ok.jpg'),
    ]);
    const result = await readDrop({ entries: [tree], loose: [] });
    expect(result.files.map((each) => each.file.name)).toEqual(['ok.jpg']);
    expect(result.skipped).toEqual([
      {
        name: 'broken.jpg',
        path: 'A/broken.jpg',
        size: null,
        lastModified: 0,
        reason: 'unreadable',
      },
    ]);
  });

  it(`sends at most ${MAX_IMPORT_FILES} files and lists every one past that as over the limit`, async () => {
    const tree = dirEntry(
      '/Big',
      Array.from({ length: MAX_IMPORT_FILES + 20 }, (_, i) => fileEntry(`/Big/f-${i}.jpg`)),
    );
    const result = await readDrop({ entries: [tree], loose: [] });
    expect(result.files).toHaveLength(MAX_IMPORT_FILES);
    expect(result.skipped).toHaveLength(20);
    expect(result.skipped.every((each) => each.reason === 'over-limit')).toBe(true);
    expect(result.skipped[0]?.path).toBe(`Big/f-${MAX_IMPORT_FILES}.jpg`);
    expect(result.files.length + result.skipped.length).toBe(MAX_IMPORT_FILES + 20);
  });

  it('stops looking past a ceiling and says so', async () => {
    const tree = dirEntry(
      '/Disk',
      Array.from({ length: MAX_ENTRIES_LOOKED_AT + 50 }, (_, i) => fileEntry(`/Disk/f-${i}.jpg`)),
    );
    const result = await readDrop({ entries: [tree], loose: [] });
    expect(result.truncated).toBe(true);
    expect(result.files.length + result.skipped.length).toBe(MAX_ENTRIES_LOOKED_AT);
  });
});

describe('files from a picker', () => {
  const picked = (name: string, relative: string) => {
    const file = new File([new Uint8Array(3)], name, { type: 'image/png' });
    Object.defineProperty(file, 'webkitRelativePath', { value: relative });
    return file;
  };

  it('keeps the folder path from a folder picker, and works without one', () => {
    const result = readChosenFiles([
      picked('a.png', 'Trip/Photos/a.png'),
      picked('.hidden.png', 'Trip/.hidden.png'),
      picked('b.png', 'Trip/.cache/b.png'),
      picked('c.png', ''),
    ]);
    expect(result.files.map((each) => [each.file.name, each.path])).toEqual([
      ['a.png', 'Trip/Photos/a.png'],
      ['c.png', ''],
    ]);
    expect(result.skipped.map((each) => [each.name, each.reason])).toEqual([
      ['.hidden.png', 'hidden'],
      ['b.png', 'hidden'],
    ]);
  });

  it(`lists files past ${MAX_IMPORT_FILES} from a plain multi-file pick as over the limit`, () => {
    const many = Array.from({ length: MAX_IMPORT_FILES + 3 }, (_, i) => picked(`p${i}.png`, ''));
    const result = readChosenFiles(many);
    expect(result.files).toHaveLength(MAX_IMPORT_FILES);
    expect(result.skipped.map((each) => each.reason)).toEqual([
      'over-limit',
      'over-limit',
      'over-limit',
    ]);
    expect(result.skipped[0]?.size).toBe(3);
  });
});

describe('capturing a drop', () => {
  it('takes folder entries where the browser gives them and plain files otherwise', () => {
    const folder = dirEntry('/F', []);
    const loose = new File([new Uint8Array(1)], 'loose.png', { type: 'image/png' });
    const transfer = {
      items: [
        { kind: 'file', webkitGetAsEntry: () => folder, getAsFile: () => null },
        { kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => loose },
        { kind: 'string', webkitGetAsEntry: () => null, getAsFile: () => null },
      ],
      files: [],
    } as unknown as DataTransfer;
    expect(captureDrop(transfer)).toEqual({ entries: [folder], loose: [loose] });

    const older = { items: undefined, files: [loose] } as unknown as DataTransfer;
    expect(captureDrop(older)).toEqual({ entries: [], loose: [loose] });
  });
});

describe('cleaning a folder path for display', () => {
  it('drops parent steps, leading slashes, control characters and direction overrides', () => {
    expect(sanitizeRelativePath('/Trip/../../etc/passwd')).toBe('Trip/etc/passwd');
    expect(sanitizeRelativePath('\\\\server\\share\\.\\a.jpg')).toBe('server/share/a.jpg');
    expect(sanitizeRelativePath('Trip/\u0000pass\u001bport\u202egpj.exe')).toBe(
      'Trip/passportgpj.exe',
    );
    expect(sanitizeRelativePath('')).toBe('');
  });

  it('keeps a long path to its end, which names the file', () => {
    const long = `${'Folder/'.repeat(60)}passport.jpg`;
    const clean = sanitizeRelativePath(long);
    expect(clean.length).toBe(MAX_PATH_LENGTH);
    expect(clean.startsWith('...')).toBe(true);
    expect(clean.endsWith('/passport.jpg')).toBe(true);
  });

  it('knows the folder part and the hidden names', () => {
    expect(folderOf('Trip/Bank/a.jpg')).toBe('Trip/Bank');
    expect(folderOf('a.jpg')).toBe('');
    expect(isHiddenName('.DS_Store')).toBe(true);
    expect(isHiddenName('THUMBS.DB')).toBe(true);
    expect(isHiddenName('passport.jpg')).toBe(false);
  });
});
