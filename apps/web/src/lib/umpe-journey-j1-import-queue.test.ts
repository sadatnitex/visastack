/**
 * Journey J1 (individual intake), the part that lives in the browser layer: dropping 80 mixed files,
 * including a nested folder, onto the import page. ADR 0026 D7: a bounded client-side queue over
 * the per-file upload route, one request per file.
 *
 * Covered here: reading a dropped folder to the bottom; one visible line per file (nothing dropped,
 * not the 21st, not the 80th); safe format limitations (an unsupported kind, a PDF while the scan is
 * off, an empty file and an oversize file are listed as not supported with a plain reason and never
 * sent); hidden system files listed as skipped; the same file twice in one drop listed as a repeat;
 * honest server refusals and exact copies shown per file; at most two files in flight.
 *
 * Not exercisable below the browser (reported, not faked): a real drag and drop in a real browser,
 * the real upload route over the network, the virus scan, and what the server stores and reads
 * (the services-layer J1 file covers the storing and reading).
 *
 * Every file here is made up in the test; none is a real document.
 */
import { describe, expect, it } from 'vitest';
import type { UploadOutcome } from './document-upload-client';
import {
  type DirectoryEntryLike,
  type EntryLike,
  type FileEntryLike,
  readDrop,
} from './import/folder-entries';
import { type ImportItem, ImportQueue, type ImportSend, countItems } from './import/import-queue';

const RULES = { limitBytes: 1000, limitLabel: '1 KB', pdfAccepted: false };

const TYPE_BY_NAME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  txt: 'text/plain',
  zip: 'application/zip',
  exe: 'application/x-msdownload',
};

function makeFile(name: string, size: number): File {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return new File([new Uint8Array(size)], name, {
    type: TYPE_BY_NAME[ext] ?? '',
    lastModified: 1_700_000_000_000,
  });
}

function fileEntry(fullPath: string, size = 16): FileEntryLike {
  const name = fullPath.slice(fullPath.lastIndexOf('/') + 1);
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file(success) {
      success(makeFile(name, size));
    },
  };
}

function dirEntry(fullPath: string, children: readonly EntryLike[]): DirectoryEntryLike {
  const name = fullPath.slice(fullPath.lastIndexOf('/') + 1);
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    createReader() {
      let offset = 0;
      return {
        readEntries(success) {
          // At most 100 entries per call, as Chromium does.
          const batch = children.slice(offset, offset + 100);
          offset += batch.length;
          setTimeout(() => success([...batch]), 0);
        },
      };
    },
  };
}

/**
 * The 80-file drop: 60 loose files plus a "Trip" folder holding 20 more (two nested folders).
 * Mixed on purpose: pictures, text, an unsupported archive and program, a PDF while the scan is
 * off, an empty file, an oversize file, a hidden system file and one file dropped twice.
 */
function eightyFileDrop() {
  const loose: File[] = [];
  for (let i = 1; i <= 52; i++) loose.push(makeFile(`scan-${String(i).padStart(2, '0')}.jpg`, 16));
  loose.push(makeFile('statement-march.png', 16));
  loose.push(makeFile('notes.txt', 16));
  loose.push(makeFile('bundle.zip', 16));
  loose.push(makeFile('setup.exe', 16));
  loose.push(makeFile('letter.pdf', 16));
  loose.push(makeFile('empty.jpg', 0));
  loose.push(makeFile('huge-scan.jpg', 5000));
  // The same file as scan-01.jpg (same name, size and date): listed as a repeat, never sent twice.
  loose.push(makeFile('scan-01.jpg', 16));
  const bank = dirEntry(
    '/Trip/Bank',
    Array.from({ length: 12 }, (_, i) => fileEntry(`/Trip/Bank/bank-${i + 1}.jpg`)),
  );
  const family = dirEntry('/Trip/Family', [
    fileEntry('/Trip/Family/birth.jpg'),
    fileEntry('/Trip/Family/marriage.png'),
    fileEntry('/Trip/Family/.DS_Store'),
  ]);
  const trip = dirEntry('/Trip', [
    bank,
    family,
    fileEntry('/Trip/passport.jpg'),
    fileEntry('/Trip/passport-renewed.jpg'),
    fileEntry('/Trip/payslip-1.jpg'),
    fileEntry('/Trip/payslip-2.jpg'),
    fileEntry('/Trip/rejected-by-server.jpg'),
  ]);
  return { loose, entries: [trip] as EntryLike[] };
}

const byName = (items: readonly ImportItem[], name: string): ImportItem => {
  const item = items.find((each) => each.name === name);
  if (!item) throw new Error(`no line for ${name}`);
  return item;
};

describe('J1 individual intake: the 80-file import queue', () => {
  it('reads the dropped folder to the bottom and lists all 80 entries', async () => {
    const drop = eightyFileDrop();
    const read = await readDrop(drop);
    expect(read.files.length + read.skipped.length).toBe(80);
    expect(read.truncated).toBe(false);
    expect(read.skipped.map((each) => [each.name, each.reason])).toEqual([['.DS_Store', 'hidden']]);
    const paths = read.files.map((each) => each.path);
    expect(paths).toContain('Trip/Bank/bank-12.jpg');
    expect(paths).toContain('Trip/Family/birth.jpg');
  });

  it('gives every one of the 80 files its own settled line, with honest per-file statuses', async () => {
    const drop = eightyFileDrop();
    const read = await readDrop(drop);
    const sent: string[] = [];
    let inFlight = 0;
    let most = 0;
    const send: ImportSend = async (request) => {
      const name = (request.file as File).name;
      sent.push(name);
      inFlight++;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight--;
      if (name === 'rejected-by-server.jpg') {
        return { kind: 'refused', message: 'This file could not be read as a picture.' };
      }
      if (name === 'scan-52.jpg') {
        return {
          kind: 'added',
          message: 'Added. This is an exact copy of a document you already keep.',
          title: 'Scan',
          removableCopyId: 'doc-copy-1',
        };
      }
      const outcome: UploadOutcome = {
        kind: 'added',
        message: 'Added. It is being checked.',
        title: name,
      };
      return outcome;
    };
    const queue = new ImportQueue({
      applicantId: 'applicant-j1',
      rules: RULES,
      send,
      wait: () => Promise.resolve(),
    });
    await queue.add(read.files, read.skipped);
    await queue.whenIdle();
    const items = queue.list();

    // One line for every entry dropped: nothing disappears, not the 21st, not the 80th.
    expect(items).toHaveLength(80);
    expect(items[20]?.state).not.toBe('queued');
    expect(items[79]?.state).not.toBe('queued');
    for (const item of items) {
      expect(['queued', 'uploading', 'paused'], item.name).not.toContain(item.state);
    }
    expect(most).toBeLessThanOrEqual(2);

    // Safe format limitations: listed with a plain reason, never sent to the server.
    for (const name of ['bundle.zip', 'setup.exe', 'letter.pdf', 'empty.jpg', 'huge-scan.jpg']) {
      const item = byName(items, name);
      expect(item.state, name).toBe('unsupported');
      expect(item.message, name).not.toBe('');
      expect(sent, name).not.toContain(name);
    }
    expect(byName(items, 'bundle.zip').message).toMatch(/cannot be added/);
    expect(byName(items, 'letter.pdf').message).toMatch(/PDF files can be added only/);

    // The file dropped twice is one upload and one repeat line.
    const repeats = items.filter((each) => each.name === 'scan-01.jpg');
    expect(repeats.map((each) => each.state).sort()).toEqual(['added', 'skipped']);
    expect(repeats.find((each) => each.state === 'skipped')?.skipReason).toBe('repeat');
    expect(sent.filter((name) => name === 'scan-01.jpg')).toHaveLength(1);

    // The server's honest answers are kept per file.
    expect(byName(items, 'rejected-by-server.jpg').state).toBe('refused');
    expect(byName(items, 'rejected-by-server.jpg').message).toMatch(/could not be read/);
    expect(byName(items, 'scan-52.jpg').state).toBe('duplicate');
    expect(byName(items, '.DS_Store').state).toBe('skipped');

    // Every upload carries its own id, the same per file across attempts.
    const ids = items.filter((each) => each.state === 'added').map((each) => each.uploadId);
    expect(new Set(ids).size).toBe(ids.length);

    expect(countItems(items)).toEqual({
      total: 80,
      added: 72,
      needLook: 1,
      notSupported: 5,
      waiting: 0,
      held: 0,
      skipped: 2,
    });
    expect(sent).toHaveLength(73);
  }, 120_000);

  it('negative: the 21st file of a plain 80-file batch is sent and settled, not lost', async () => {
    const sent: string[] = [];
    const send: ImportSend = async (request) => {
      sent.push((request.file as File).name);
      return { kind: 'added', message: 'Added.', title: null };
    };
    const queue = new ImportQueue({
      applicantId: 'applicant-j1',
      rules: RULES,
      send,
      wait: () => Promise.resolve(),
    });
    await queue.add(
      Array.from({ length: 80 }, (_, i) => ({ file: makeFile(`page-${i + 1}.jpg`, 8), path: '' })),
    );
    await queue.whenIdle();
    expect(sent).toContain('page-21.jpg');
    expect(sent).toHaveLength(80);
    expect(queue.list()[20]).toMatchObject({ name: 'page-21.jpg', state: 'added' });
  });

  it('negative: an answer that never says what happened is shown as unknown, not as added', async () => {
    const queue = new ImportQueue({
      applicantId: 'applicant-j1',
      rules: RULES,
      send: async () => ({ kind: 'unknown' }),
      wait: () => Promise.resolve(),
    });
    await queue.add([{ file: makeFile('lost-on-the-way.jpg', 8), path: '' }]);
    await queue.whenIdle();
    expect(queue.list()[0]?.state).toBe('unknown');
    expect(queue.list()[0]?.attempts).toBe(1);
  });
});
