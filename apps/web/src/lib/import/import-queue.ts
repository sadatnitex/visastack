/**
 * The queue behind a batch or folder import (UMPE P2). Pure: no React, no storage, no timers it
 * does not own, so every rule here is tested without a browser.
 *
 * Each file still goes in its own request through the existing upload route, by way of
 * `sendDocumentFile`, so every server check (ownership, quota and rate limit, file checks, the
 * safety scan and the reading that follows) is exactly the one a single upload gets. What this adds
 * is the batch around it: a bounded number of files in flight at once, a visible final state for
 * every file (nothing is dropped, however many are chosen), Pause, Resume, Stop and Try Again.
 *
 * Retry rule (no hidden duplicates): a file is sent again on its own only when the answer said
 * plainly that it was not taken and that the refusal is passing (HTTP 429 or 503: the host turned
 * the request away before the upload ran, since the route itself never answers either). It is sent
 * at most `maxAttempts` times in all, waiting as long as Retry-After asks (bounded). A file with no
 * usable answer (a timeout, a dropped connection, a server error) may well have been stored, so it
 * is NEVER sent again on its own: it stays unknown until the person checks and chooses Try Again.
 */

import type { UpgradeLineKind } from '../../components/upgrade-line';
import {
  type UploadOutcome,
  type UploadRequest,
  sendDocumentFile,
} from '../document-upload-client';
import { checkChosenFile } from '../upload-rules';

export type ImportState =
  /** Waiting for a free place in the queue. */
  | 'queued'
  /** Being sent, or sent and waiting for the answer. */
  | 'uploading'
  /** Stored and sent for checking. */
  | 'added'
  /** Stored, and the server says it is an exact copy of a document already kept. */
  | 'duplicate'
  /** The server said no, with its reason. */
  | 'refused'
  /** Not sent: this browser-side check (`checkChosenFile`) already knows the server would refuse it. */
  | 'unsupported'
  /** No usable answer: the file may or may not have arrived. Never sent again on its own. */
  | 'unknown'
  /** Not sent, and why is in `skipReason`. */
  | 'skipped'
  /** Waiting while the import is paused. */
  | 'paused';

export type SkipReason =
  /** A hidden or system file (.DS_Store, Thumbs.db, a name starting with a dot). */
  | 'hidden'
  /** Past the most files one import takes. */
  | 'over-limit'
  /** The person pressed Stop before it was sent. */
  | 'stopped'
  /** The browser could not read it from the folder. */
  | 'unreadable';

export interface ImportItem {
  readonly id: number;
  /** The file's own name. */
  readonly name: string;
  /** Where it sat in the chosen folder, cleaned for display ('' for a file chosen on its own). */
  readonly path: string;
  /** Bytes, or null when it was never read (a file past the limit). */
  readonly size: number | null;
  readonly lastModified: number;
  readonly state: ImportState;
  /** Sends made so far for this file (a retry after 429 or 503 counts). */
  readonly attempts: number;
  /** Share sent of the current attempt, 0 to 100. */
  readonly progress: number;
  /** The server's line (added, duplicate, refused) or the check's reason (unsupported). */
  readonly message: string;
  /** The name the document is listed under, once added. */
  readonly title: string | null;
  /** The added document when it is an exact copy that may be removed again (LC-C). */
  readonly removableCopyId: string | null;
  /** The line after a refusal a paid plan would help with. */
  readonly upgrade: UpgradeLineKind | null;
  readonly skipReason: SkipReason | null;
  /** Refused only because the service stayed busy through every attempt. */
  readonly busy: boolean;
  /** Waiting before another attempt because the service was busy. */
  readonly waitingToRetry: boolean;
  /** Settled in an earlier visit to this page (from the saved list), so it was not sent now. */
  readonly earlier: boolean;
}

/** A file to import and where it sat in the folder. */
export interface ImportCandidate {
  readonly file: Blob & {
    readonly name: string;
    readonly lastModified: number;
  };
  /** The cleaned folder path for display, or ''. Never sent to the server. */
  readonly path: string;
}

/** A line for a file that will not be sent, found while reading the folder. */
export interface SkippedEntry {
  readonly name: string;
  readonly path: string;
  readonly size: number | null;
  readonly lastModified: number;
  readonly reason: SkipReason;
}

/** What one send reported: the outcome, the HTTP status (0 when none) and any Retry-After. */
export interface SendAnswer {
  readonly outcome: UploadOutcome;
  readonly status: number;
  readonly retryAfter: string | null;
}

export type ImportSend = (request: {
  readonly applicantId: string;
  readonly file: Blob;
  readonly contentType: string;
  readonly onProgress: (fraction: number) => void;
}) => Promise<SendAnswer>;

/** How an earlier visit left a file with the same name, size and date. */
export type EarlierState = 'added' | 'duplicate' | 'unknown';

export interface ImportQueueOptions {
  readonly applicantId: string;
  readonly rules: {
    readonly limitBytes: number;
    readonly limitLabel: string;
    readonly pdfAccepted: boolean;
  };
  /** Files in flight at once: default 2, never more than 3. */
  readonly concurrency?: number;
  /** Sends for one file in all, counting the first: default and most 3. */
  readonly maxAttempts?: number;
  /** First wait after a busy answer without Retry-After; doubles each time. */
  readonly baseDelayMs?: number;
  /** The longest wait honoured, whatever Retry-After asks. */
  readonly maxDelayMs?: number;
  readonly send?: ImportSend;
  readonly wait?: (ms: number) => Promise<void>;
  /** How an earlier visit left this file, from the saved list. */
  readonly earlierState?: (file: {
    readonly name: string;
    readonly size: number;
    readonly lastModified: number;
  }) => EarlierState | null;
  /** Called once each time a file reaches a final state in this visit. */
  readonly onSettled?: (item: ImportItem) => void;
}

export interface ImportSnapshot {
  readonly items: readonly ImportItem[];
  readonly paused: boolean;
}

export const DEFAULT_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 3;
export const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60_000;

/** States a file will not leave on its own. */
export const FINAL_STATES: ReadonlySet<ImportState> = new Set([
  'added',
  'duplicate',
  'refused',
  'unsupported',
  'unknown',
  'skipped',
]);

/** HTTP answers that say the request was turned away before anything was stored, for now. */
export function isPassingRefusal(status: number): boolean {
  return status === 429 || status === 503;
}

/** Whether Try Again is offered: the file is still at hand and another send may succeed. */
export function canTryAgain(item: Pick<ImportItem, 'state' | 'skipReason'>): boolean {
  return (
    item.state === 'refused' ||
    item.state === 'unknown' ||
    (item.state === 'skipped' && item.skipReason === 'stopped')
  );
}

/**
 * How long to wait before the next attempt: what Retry-After asks (seconds or a date), else a
 * doubling wait, never more than `maxMs`.
 */
export function retryDelayMs(
  retryAfter: string | null,
  attempt: number,
  baseMs: number,
  maxMs: number,
  now: number = Date.now(),
): number {
  const fallback = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  if (!retryAfter) return fallback;
  const text = retryAfter.trim();
  if (/^\d+$/.test(text)) return Math.min(maxMs, Number(text) * 1000);
  const date = Date.parse(text);
  if (Number.isNaN(date)) return fallback;
  return Math.min(maxMs, Math.max(0, date - now));
}

/** The real send: the existing per-file upload, with its HTTP status and Retry-After kept. */
export const sendThroughUploadRoute: ImportSend = async (request) => {
  type Readable = UploadRequest & { getResponseHeader?: (name: string) => string | null };
  let made: Readable | null = null;
  const outcome = await sendDocumentFile({
    applicantId: request.applicantId,
    file: request.file,
    contentType: request.contentType,
    docType: '',
    subject: '',
    onProgress: request.onProgress,
    createRequest: () => {
      made = new XMLHttpRequest() as unknown as Readable;
      return made;
    },
  });
  const sent = made as Readable | null;
  let retryAfter: string | null = null;
  try {
    retryAfter = sent?.getResponseHeader?.('Retry-After') ?? null;
  } catch {
    retryAfter = null;
  }
  return { outcome, status: sent?.status ?? 0, retryAfter };
};

const defaultWait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function clampConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(value)));
}

function clampAttempts(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MAX_ATTEMPTS;
  return Math.min(MAX_ATTEMPTS, Math.max(1, Math.floor(value)));
}

const blank = {
  attempts: 0,
  progress: 0,
  message: '',
  title: null,
  removableCopyId: null,
  upgrade: null,
  skipReason: null,
  busy: false,
  waitingToRetry: false,
  earlier: false,
} as const;

export class ImportQueue {
  private readonly options: ImportQueueOptions;
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly send: ImportSend;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly files = new Map<number, { file: Blob; contentType: string }>();
  private readonly listeners = new Set<() => void>();
  private readonly idleWaiters: (() => void)[] = [];
  private snapshot: ImportSnapshot = { items: [], paused: false };
  private nextId = 1;
  private active = 0;
  /** Bumped by Stop, so a file waiting to retry knows not to go out again. */
  private generation = 0;

  constructor(options: ImportQueueOptions) {
    this.options = options;
    this.concurrency = clampConcurrency(options.concurrency);
    this.maxAttempts = clampAttempts(options.maxAttempts);
    this.send = options.send ?? sendThroughUploadRoute;
    this.wait = options.wait ?? defaultWait;
  }

  /** For `useSyncExternalStore`: the same object until something changes. */
  readonly getSnapshot = (): ImportSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Files in flight right now. */
  get inFlight(): number {
    return this.active;
  }

  /**
   * Adds one import: the files to send and the lines for files that will not be sent. Each file is
   * checked first; one this browser already knows would be refused is listed, not sent.
   */
  add(candidates: readonly ImportCandidate[], skipped: readonly SkippedEntry[] = []): void {
    const paused = this.snapshot.paused;
    const added: ImportItem[] = [];
    for (const { file, path } of candidates) {
      const id = this.nextId++;
      const base = {
        ...blank,
        id,
        name: file.name || 'Photo',
        path,
        size: file.size,
        lastModified: file.lastModified,
      };
      const earlier = this.options.earlierState?.({
        name: base.name,
        size: file.size,
        lastModified: file.lastModified,
      });
      const check = checkChosenFile(
        { name: base.name, size: file.size, type: file.type },
        this.options.rules,
      );
      if (earlier === 'added' || earlier === 'duplicate') {
        added.push({ ...base, state: earlier, earlier: true });
        continue;
      }
      if (!check.ok) {
        added.push({ ...base, state: 'unsupported', message: check.reason });
        continue;
      }
      this.files.set(id, { file, contentType: check.contentType });
      // A file an earlier visit could not confirm is not sent again on its own: the person checks
      // the documents list first, then chooses Try Again.
      if (earlier === 'unknown') {
        added.push({ ...base, state: 'unknown', earlier: true });
        continue;
      }
      added.push({ ...base, state: paused ? 'paused' : 'queued' });
    }
    for (const entry of skipped) {
      added.push({
        ...blank,
        id: this.nextId++,
        name: entry.name,
        path: entry.path,
        size: entry.size,
        lastModified: entry.lastModified,
        state: 'skipped',
        skipReason: entry.reason,
      });
    }
    if (added.length === 0) return;
    this.commit([...this.snapshot.items, ...added]);
    this.pump();
  }

  /** No new file is sent; files already on their way finish. */
  pause(): void {
    if (this.snapshot.paused) return;
    this.commit(
      this.snapshot.items.map((item) =>
        item.state === 'queued' && !item.waitingToRetry ? { ...item, state: 'paused' } : item,
      ),
      true,
    );
  }

  resume(): void {
    if (!this.snapshot.paused) return;
    this.commit(
      this.snapshot.items.map((item) =>
        item.state === 'paused' ? { ...item, state: 'queued' } : item,
      ),
      false,
    );
    this.pump();
  }

  /** Every file not yet sent is listed as not added; files already on their way finish. */
  stop(): void {
    this.generation++;
    const stopped: ImportItem[] = [];
    const items = this.snapshot.items.map((item): ImportItem => {
      if (item.state !== 'queued' && item.state !== 'paused') return item;
      const next: ImportItem = {
        ...item,
        state: 'skipped',
        skipReason: 'stopped',
        waitingToRetry: false,
        progress: 0,
      };
      stopped.push(next);
      return next;
    });
    this.commit(items, false);
    for (const item of stopped) this.options.onSettled?.(item);
  }

  /** Try Again on one line: offered only where `canTryAgain` says so. */
  retry(id: number): void {
    const item = this.snapshot.items.find((each) => each.id === id);
    if (!item || !canTryAgain(item) || !this.files.has(id)) return;
    this.update(id, {
      ...blank,
      state: this.snapshot.paused ? 'paused' : 'queued',
    });
    this.pump();
  }

  /** Clears every line that will not change any more. */
  clearFinished(): void {
    const keep = this.snapshot.items.filter((item) => !FINAL_STATES.has(item.state));
    const kept = new Set(keep.map((item) => item.id));
    for (const id of this.files.keys()) if (!kept.has(id)) this.files.delete(id);
    this.commit(keep);
  }

  /** Resolves once nothing is in flight and nothing is waiting to go (paused files wait). */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private isIdle(): boolean {
    return this.active === 0 && !this.snapshot.items.some((item) => item.state === 'queued');
  }

  private pump(): void {
    while (!this.snapshot.paused && this.active < this.concurrency) {
      const next = this.snapshot.items.find(
        (item) => item.state === 'queued' && !item.waitingToRetry,
      );
      if (!next) break;
      this.active++;
      this.update(next.id, { state: 'uploading', progress: 0 });
      void this.run(next.id);
    }
    if (this.isIdle()) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  private async run(id: number): Promise<void> {
    const held = this.files.get(id);
    const generation = this.generation;
    try {
      if (!held) {
        this.settle(id, { state: 'unknown' });
        return;
      }
      for (;;) {
        const attempts = (this.find(id)?.attempts ?? 0) + 1;
        this.update(id, { attempts, progress: 0, state: 'uploading', waitingToRetry: false });
        let answer: SendAnswer;
        try {
          answer = await this.send({
            applicantId: this.options.applicantId,
            file: held.file,
            contentType: held.contentType,
            onProgress: (fraction) => {
              const progress = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
              if (this.find(id)?.progress !== progress) this.update(id, { progress });
            },
          });
        } catch {
          answer = { outcome: { kind: 'unknown' }, status: 0, retryAfter: null };
        }
        if (isPassingRefusal(answer.status)) {
          if (attempts >= this.maxAttempts) {
            this.settle(id, { state: 'refused', busy: true, message: '' });
            return;
          }
          // Nothing was stored, so Stop and Pause can take this file back safely.
          if (this.generation !== generation) {
            this.settle(id, { state: 'skipped', skipReason: 'stopped', progress: 0 });
            return;
          }
          if (this.snapshot.paused) {
            this.update(id, { state: 'paused', progress: 0 });
            return;
          }
          this.update(id, { state: 'queued', waitingToRetry: true, progress: 0 });
          await this.wait(
            retryDelayMs(
              answer.retryAfter,
              attempts,
              this.options.baseDelayMs ?? BASE_DELAY_MS,
              this.options.maxDelayMs ?? MAX_DELAY_MS,
            ),
          );
          // Stop already listed it as not added (it was waiting, not in flight).
          if (this.generation !== generation) return;
          if (this.snapshot.paused) {
            this.update(id, { state: 'paused', waitingToRetry: false });
            return;
          }
          continue;
        }
        this.settle(id, outcomeChange(answer.outcome));
        return;
      }
    } finally {
      this.active--;
      this.pump();
    }
  }

  private find(id: number): ImportItem | undefined {
    return this.snapshot.items.find((item) => item.id === id);
  }

  private settle(id: number, change: Partial<ImportItem>): void {
    this.update(id, { waitingToRetry: false, ...change });
    const item = this.find(id);
    if (item && (item.state === 'added' || item.state === 'duplicate')) this.files.delete(id);
    if (item) this.options.onSettled?.(item);
  }

  private update(id: number, change: Partial<ImportItem>): void {
    this.commit(
      this.snapshot.items.map((item) => (item.id === id ? { ...item, ...change } : item)),
    );
  }

  private commit(items: readonly ImportItem[], paused: boolean = this.snapshot.paused): void {
    this.snapshot = { items, paused };
    for (const listener of this.listeners) listener();
  }
}

function outcomeChange(outcome: UploadOutcome): Partial<ImportItem> {
  if (outcome.kind === 'added') {
    return {
      state: outcome.removableCopyId ? 'duplicate' : 'added',
      progress: 100,
      message: outcome.message,
      title: outcome.title,
      removableCopyId: outcome.removableCopyId ?? null,
    };
  }
  if (outcome.kind === 'refused') {
    return { state: 'refused', message: outcome.message, upgrade: outcome.upgrade ?? null };
  }
  return { state: 'unknown', message: '' };
}

/** Counts for the summary line. */
export interface ImportCounts {
  readonly added: number;
  readonly needLook: number;
  readonly notSupported: number;
  readonly waiting: number;
  readonly skipped: number;
}

export function countItems(items: readonly Pick<ImportItem, 'state'>[]): ImportCounts {
  let added = 0;
  let needLook = 0;
  let notSupported = 0;
  let waiting = 0;
  let skipped = 0;
  for (const { state } of items) {
    if (state === 'added' || state === 'duplicate') added++;
    else if (state === 'refused' || state === 'unknown') needLook++;
    else if (state === 'unsupported') notSupported++;
    else if (state === 'skipped') skipped++;
    else waiting++;
  }
  return { added, needLook, notSupported, waiting, skipped };
}
