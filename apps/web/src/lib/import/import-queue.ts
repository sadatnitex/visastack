/**
 * The queue behind a batch or folder import (UMPE P2). Pure: no React, no storage, so every rule
 * here is tested without a browser.
 *
 * Each file still goes in its own request through the existing upload route, by way of
 * `sendDocumentFile`, so every server check (ownership, quota and rate limit, file checks, the
 * safety scan and the reading that follows) is exactly the one a single upload gets. What this adds
 * is the batch around it: a bounded number of files in flight at once, a visible state for every
 * file (nothing is dropped, however many are chosen), Pause, Resume, Stop and Try Again.
 *
 * Retry rule (no hidden duplicates): a file is sent again on its own only after a definite busy
 * answer (HTTP 429 or 503: turned away before anything was stored), only when the server asks for
 * a wait of at most `AUTO_RETRY_LIMIT_SECONDS`, and at most `maxAttempts` sends in all. A longer
 * wait is the hourly upload limit: the file, and every file still waiting, is held until the
 * person chooses Try Again for All Paused Files.
 *
 * A file with no usable answer (a timeout, a dropped connection, a server error) may well have
 * been stored. Every file carries one upload id (UMPE P3) on every attempt, and a server that keeps
 * upload receipts answers a repeat with the copy it already stored. Only when the page says the
 * server keeps them (`retryUnknown`) is such a file sent again on its own, with the SAME id, within
 * the same `maxAttempts`; otherwise it stays unknown until the person checks and chooses Try Again
 * (which also reuses the id). Send Again, an explicit new copy, gets a new id.
 *
 * Before each send `beforeSend` runs and is awaited, so the saved list can record the file as
 * unconfirmed first: a reload while it is on its way then shows it as not confirmed, not as new.
 */

import type { UpgradeLineKind } from '../../components/upgrade-line';
import {
  type UploadOutcome,
  reportUploadProblem,
  sendDocumentFile,
} from '../document-upload-client';
import { newUploadId } from '../document-upload-client-id';
import {
  type ShrinkFailure,
  type ShrinkOutcome,
  photoNotShrunkMessage,
  shrinkPhoto,
} from '../photo-shrink';
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
  /** Not sent: the browser-side check (`checkChosenFile`) already knows the server would refuse it. */
  | 'unsupported'
  /** No usable answer: the file may or may not have arrived. Never sent again on its own. */
  | 'unknown'
  /** Not sent, and why is in `skipReason`. */
  | 'skipped'
  /** Waiting while the import is paused. */
  | 'paused'
  /** Not sent: the hourly upload limit was reached; waits for Try Again for All Paused Files. */
  | 'held';

export type SkipReason =
  /** A hidden or system file (.DS_Store, Thumbs.db, a name starting with a dot). */
  | 'hidden'
  /** Past the most files one import takes. */
  | 'over-limit'
  /** The person pressed Stop before it was sent. */
  | 'stopped'
  /** The browser could not read it from the folder. */
  | 'unreadable'
  /** The same file (name, size and date) is already in this import. */
  | 'repeat';

export interface ImportItem {
  readonly id: number;
  /** The file's own name. */
  readonly name: string;
  /** Where it sat in the chosen folder, cleaned for display ('' for a file chosen on its own). */
  readonly path: string;
  /** Bytes, or null when it was never read (a file past the limit). */
  readonly size: number | null;
  readonly lastModified: number;
  /** Name, size and date joined: the same file chosen again has the same one. Memory only. */
  readonly fingerprint: string;
  readonly state: ImportState;
  /** Sends made so far for this file (a retry after a busy answer counts). */
  readonly attempts: number;
  /** Share sent of the current attempt, 0 to 100. */
  readonly progress: number;
  /** The server's line (added, duplicate, refused, busy) or the check's reason (unsupported). */
  readonly message: string;
  /** The name the document is listed under, once added. */
  readonly title: string | null;
  /** The added document when it is an exact copy that may be removed again (LC-C). */
  readonly removableCopyId: string | null;
  /** The stored document's id once the server confirmed it (null before, or from an older server). */
  readonly documentId: string | null;
  /** The line after a refusal a paid plan would help with. */
  readonly upgrade: UpgradeLineKind | null;
  readonly skipReason: SkipReason | null;
  /** Being made smaller before it is sent (a photo over the limit, P2). */
  readonly preparing: boolean;
  /** The size of the smaller copy that was sent in place of a large photo, or null. */
  readonly shrunkTo: number | null;
  /** Refused only because the service stayed busy through every attempt. */
  readonly busy: boolean;
  /** Waiting before another attempt because the service was busy for a moment. */
  readonly waitingToRetry: boolean;
  /** Settled in an earlier visit to this page (from the saved list), so it was not sent now. */
  readonly earlier: boolean;
  /** The id sent with every attempt at this file, so the server never stores it twice. */
  readonly uploadId: string;
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

export type ImportSend = (request: {
  readonly applicantId: string;
  readonly file: Blob;
  readonly contentType: string;
  /** The same on every attempt at this file. */
  readonly uploadId: string;
  /** The file's own name, kept privately by the server to suggest a readable name. */
  readonly fileName: string;
  /**
   * Who the file was chosen for (`scopeFor` when it joined the queue, '' without it). Every
   * attempt, Try Again and resume carries the same one, so a file never goes to someone else.
   */
  readonly scope?: string;
  readonly onProgress: (fraction: number) => void;
}) => Promise<UploadOutcome>;

/** How an earlier visit left a file with the same name, size and date. */
export type EarlierState = 'added' | 'duplicate' | 'unknown' | 'unconfirmed';

export interface FileIdentity {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
}

export interface ImportQueueOptions {
  readonly applicantId: string;
  /**
   * Who the files being added are for, as a short key. The same file chosen again for a different
   * person is a new file for that person, so the "already in this import" check is kept apart for
   * each key. Default: one key for everything.
   */
  readonly scopeFor?: () => string;
  readonly rules: {
    readonly limitBytes: number;
    readonly limitLabel: string;
    readonly pdfAccepted: boolean;
    /**
     * Make a JPEG or PNG photo over the limit smaller before it is sent, one photo at a time,
     * instead of listing it as too large (P2). Off unless the page turns it on.
     */
    readonly shrinkPhotos?: boolean;
  };
  /** Makes a photo smaller; default the browser's. Replaced in tests, which have no canvas. */
  readonly shrink?: (file: File, limitBytes: number) => Promise<ShrinkOutcome>;
  /** Files in flight at once: default 2, never more than 3. */
  readonly concurrency?: number;
  /** Sends for one file in all, counting the first: default and most 3. */
  readonly maxAttempts?: number;
  /** First wait after a busy answer without Retry-After; doubles each time. */
  readonly baseDelayMs?: number;
  /** The longest wait the queue sleeps through on its own. */
  readonly maxDelayMs?: number;
  /** At most one progress redraw per this many ms. */
  readonly progressIntervalMs?: number;
  readonly send?: ImportSend;
  readonly wait?: (ms: number) => Promise<void>;
  /** How an earlier visit left this file, from the saved list. */
  readonly earlierState?: (
    file: FileIdentity,
  ) => EarlierState | null | Promise<EarlierState | null>;
  /** Awaited before every send of a file (each attempt). */
  readonly beforeSend?: (item: ImportItem) => void | Promise<void>;
  /** Called each time a file reaches an ending in this visit (held counts: nothing was stored). */
  readonly onSettled?: (item: ImportItem) => void;
  /**
   * The upload id for a file when it joins the queue. Default: a random one. The import page
   * derives it from the traveller and the file's name, size and date, so choosing the same folder
   * again after a reload sends the same id.
   */
  readonly uploadIdFor?: (file: FileIdentity, scope: string) => string | Promise<string>;
  /** A fresh random id, for Send Again (an explicit new copy). */
  readonly newUploadId?: () => string;
  /**
   * Whether the server keeps upload receipts, so a file with no answer may be sent again on its
   * own with the same id. Default false: without receipts a repeat could store a second copy.
   */
  readonly retryUnknown?: boolean;
  /**
   * Whether the device has a connection (WP-PIC17, background sync). Given only where the page can
   * be woken when the connection returns; without it the queue behaves exactly as before. While it
   * says there is none, nothing new is sent and files stay Waiting. A file that fails while there
   * is none goes back to Waiting with the same upload id, without using an attempt, but only when
   * the server keeps upload receipts (`retryUnknown`): otherwise it may have been stored, so it
   * stays Not Confirmed for the person to check.
   */
  readonly connection?: { readonly isOnline: () => boolean };
  /**
   * WP-PIC17: asked before files waiting for the connection go out again. True: the same person is
   * still signed in on this device. False: signed out or another account: every waiting file is
   * dropped (listed as not added, or Not Confirmed where it may have arrived) and nothing is sent.
   * A throw (no answer): nothing is sent; after `MAX_UNANSWERED_CHECKS` in a row, dropped too.
   */
  readonly confirmResume?: () => Promise<boolean>;
}

export interface ImportSnapshot {
  /** Line ids in the order they were added. */
  readonly order: readonly number[];
  readonly byId: ReadonlyMap<number, ImportItem>;
  readonly paused: boolean;
  /**
   * WP-PIC17: files are waiting for the connection and will go on their own when it returns (never
   * while paused: then the person's Resume is what sends them).
   */
  readonly waitingForConnection?: boolean;
  /** Changes on every redraw. */
  readonly version: number;
}

export const DEFAULT_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 3;
export const MAX_ATTEMPTS = 3;
/** The longest Retry-After the queue waits through on its own; longer is the hourly limit. */
export const AUTO_RETRY_LIMIT_SECONDS = 120;
/**
 * WP-PIC17: sends with no answer while the device was offline that are not counted as attempts,
 * per file. After these, a flapping connection uses the normal attempts, so no file goes forever.
 */
export const MAX_OFFLINE_FREE_RETRIES = 3;
/** WP-PIC17: account checks in a row with no answer before waiting files are dropped. */
export const MAX_UNANSWERED_CHECKS = 3;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = AUTO_RETRY_LIMIT_SECONDS * 1000;
const PROGRESS_INTERVAL_MS = 150;

/** States a file will not leave without the person. */
export const FINAL_STATES: ReadonlySet<ImportState> = new Set([
  'added',
  'duplicate',
  'refused',
  'unsupported',
  'unknown',
  'skipped',
  'held',
]);

export function fingerprintOf(file: FileIdentity): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

/**
 * An upload id shaped as a version 4 UUID from the first 32 hex digits of a SHA-256, so the same
 * traveller and file always give the same id. Null when the hash is not 64 hex digits.
 */
export function uploadIdFromHash(hex: string | null): string | null {
  if (!hex || !/^[0-9a-f]{64}$/.test(hex)) return null;
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Whether Try Again is offered: the file is still at hand and another send may succeed. */
export function canTryAgain(item: Pick<ImportItem, 'state' | 'skipReason'>): boolean {
  return (
    item.state === 'refused' ||
    item.state === 'unknown' ||
    (item.state === 'skipped' && item.skipReason === 'stopped')
  );
}

/** Whether Send Again is offered: a file an earlier visit added, sent again only if asked. */
export function canSendAgain(item: Pick<ImportItem, 'state' | 'earlier'>): boolean {
  return item.earlier && (item.state === 'added' || item.state === 'duplicate');
}

/** How long to wait before the next attempt: what the server asked, else a doubling wait. */
export function retryDelayMs(
  retryAfterSeconds: number | null,
  attempt: number,
  baseMs: number = BASE_DELAY_MS,
  maxMs: number = MAX_DELAY_MS,
): number {
  if (retryAfterSeconds !== null) return Math.min(maxMs, Math.max(0, retryAfterSeconds * 1000));
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/** The real send: the existing per-file upload, with no kind chosen. */
export const sendThroughUploadRoute: ImportSend = (request) =>
  sendDocumentFile({
    applicantId: request.applicantId,
    file: request.file,
    contentType: request.contentType,
    docType: '',
    subject: '',
    uploadId: request.uploadId,
    fileName: request.fileName,
    onProgress: request.onProgress,
  });

/** UMPE G1: the same send, to the family batch route (each file waits for Which Person?). */
export const sendThroughHoldRoute: ImportSend = (request) =>
  sendDocumentFile({
    applicantId: request.applicantId,
    file: request.file,
    contentType: request.contentType,
    docType: '',
    subject: '',
    uploadId: request.uploadId,
    fileName: request.fileName,
    onProgress: request.onProgress,
    route: 'hold',
  });

const defaultWait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function clamp(value: number | undefined, fallback: number, most: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(most, Math.max(1, Math.floor(value)));
}

const blank = {
  attempts: 0,
  progress: 0,
  message: '',
  title: null,
  removableCopyId: null,
  documentId: null,
  upgrade: null,
  skipReason: null,
  preparing: false,
  shrunkTo: null,
  busy: false,
  waitingToRetry: false,
  earlier: false,
} as const;

/** A file the queue still holds to send: the bytes (a smaller copy once a photo was shrunk). */
interface HeldFile {
  readonly file: Blob;
  /** Who the file was chosen for (`scopeFor` when it joined the queue). */
  readonly scope: string;
  readonly contentType: string;
  /** A photo over the limit that is still to be made smaller. */
  readonly shrink: boolean;
}

export class ImportQueue {
  private readonly options: ImportQueueOptions;
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly send: ImportSend;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly progressIntervalMs: number;
  private readonly newUploadId: () => string;
  private readonly files = new Map<number, HeldFile>();
  private readonly listeners = new Set<() => void>();
  private readonly idleWaiters: (() => void)[] = [];
  /** Lines by id; each line object is replaced, never changed, so a row can tell it is unchanged. */
  private readonly byId = new Map<number, ImportItem>();
  private order: readonly number[] = [];
  private paused = false;
  private version = 0;
  private snapshot: ImportSnapshot;
  private nextId = 1;
  private active = 0;
  /** Bumped by Stop, so a file waiting to retry knows not to go out again. */
  private generation = 0;
  /**
   * Sends start in queue order. Each file's `beforeSend` (an async fingerprint and save) waits for
   * the one before it, so two files in flight never swap places because one hash finished first;
   * which request is "the first" is then the same on every machine, however loaded.
   */
  private startGate: Promise<void> = Promise.resolve();
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  /** Adds run one after another, so a second add sees every line of the first. */
  private adding: Promise<void> = Promise.resolve();
  /** Sending stopped because the device has no connection; cleared by `resumeAfterConnection`. */
  private connectionLost = false;
  /** Files put back to wait after a send with no answer: the server may hold them already. */
  private readonly mayBeStored = new Set<number>();
  /** Per file, sends with no answer while offline that were not counted as attempts. */
  private readonly offlineFreeRetries = new Map<number, number>();
  /** An account check before a resume is on its way. */
  private checkingAccount = false;
  /** Account checks in a row that got no answer. */
  private unansweredChecks = 0;

  constructor(options: ImportQueueOptions) {
    this.options = options;
    this.concurrency = clamp(options.concurrency, DEFAULT_CONCURRENCY, MAX_CONCURRENCY);
    this.maxAttempts = clamp(options.maxAttempts, MAX_ATTEMPTS, MAX_ATTEMPTS);
    this.send = options.send ?? sendThroughUploadRoute;
    this.wait = options.wait ?? defaultWait;
    this.progressIntervalMs = options.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
    this.newUploadId = options.newUploadId ?? newUploadId;
    this.snapshot = this.makeSnapshot();
  }

  /** For `useSyncExternalStore`: the same object until something changes. */
  readonly getSnapshot = (): ImportSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Every line, in order. */
  list(): ImportItem[] {
    const out: ImportItem[] = [];
    for (const id of this.order) {
      const item = this.byId.get(id);
      if (item) out.push(item);
    }
    return out;
  }

  get(id: number): ImportItem | undefined {
    return this.byId.get(id);
  }

  /** Files in flight right now. */
  get inFlight(): number {
    return this.active;
  }

  /** True while files wait for the connection to return (only with the `connection` option). */
  get waitingForConnection(): boolean {
    return this.snapshot.waitingForConnection === true;
  }

  /**
   * The connection is back (a background sync wake or the browser's online event): files waiting
   * for it go out again, in their order, with the upload id and person they were chosen with.
   * Does nothing unless files are waiting for the connection and the device is online again.
   */
  async resumeAfterConnection(): Promise<void> {
    if (!this.connectionLost || this.offline() || this.checkingAccount) return;
    const confirm = this.options.confirmResume;
    if (confirm) {
      this.checkingAccount = true;
      let same: boolean | null;
      try {
        same = await confirm();
      } catch {
        same = null;
      } finally {
        this.checkingAccount = false;
      }
      if (same === false) {
        this.dropWaiting();
        return;
      }
      if (same !== true) {
        this.unansweredChecks++;
        if (this.unansweredChecks >= MAX_UNANSWERED_CHECKS) this.dropWaiting();
        return;
      }
      this.unansweredChecks = 0;
      if (!this.connectionLost || this.offline()) return;
    }
    this.connectionLost = false;
    this.emit();
    this.pump();
  }

  /**
   * Signed out or another account since the files were chosen: Stop, and the files are let go, so
   * not even Try Again can send them under someone else's sign-in.
   */
  private dropWaiting(): void {
    this.stop();
    for (const item of this.byId.values()) {
      if (item.state !== 'uploading') this.files.delete(item.id);
    }
    this.emit();
  }

  /**
   * Adds one import: the files to send and the lines for files that will not be sent. Each file is
   * checked first: one already in this import, one an earlier visit settled, and one this browser
   * already knows would be refused are listed, not sent.
   */
  add(
    candidates: readonly ImportCandidate[],
    skipped: readonly SkippedEntry[] = [],
  ): Promise<void> {
    const run = this.adding.then(() => this.addNow(candidates, skipped));
    this.adding = run.catch(() => undefined);
    return run;
  }

  private async addNow(
    candidates: readonly ImportCandidate[],
    skipped: readonly SkippedEntry[],
  ): Promise<void> {
    // Who these files are for is read once, before any await: the upload ids and every later send
    // use this one choice, even if the person picker changes while the ids are worked out.
    const scope = this.options.scopeFor?.() ?? '';
    const uploadIds = await Promise.all(
      candidates.map(async ({ file }) => {
        try {
          const id = await this.options.uploadIdFor?.(
            {
              name: file.name || 'Photo',
              size: file.size,
              lastModified: file.lastModified,
            },
            scope,
          );
          return typeof id === 'string' && id !== '' ? id : this.newUploadId();
        } catch {
          return this.newUploadId();
        }
      }),
    );
    const earlier = await Promise.all(
      candidates.map(async ({ file }) => {
        try {
          return (
            (await this.options.earlierState?.({
              name: file.name || 'Photo',
              size: file.size,
              lastModified: file.lastModified,
            })) ?? null
          );
        } catch {
          return null;
        }
      }),
    );
    const seen = new Set<string>();
    for (const item of this.byId.values()) {
      if (item.state !== 'skipped') seen.add(item.fingerprint);
    }
    const added: ImportItem[] = [];
    candidates.forEach(({ file, path }, index) => {
      const id = this.nextId++;
      const name = file.name || 'Photo';
      const fingerprint = `${scope}\u0000${fingerprintOf({ name, size: file.size, lastModified: file.lastModified })}`;
      const base = {
        ...blank,
        id,
        name,
        path,
        size: file.size,
        lastModified: file.lastModified,
        fingerprint,
        uploadId: uploadIds[index] ?? this.newUploadId(),
      };
      if (seen.has(fingerprint)) {
        added.push({ ...base, state: 'skipped', skipReason: 'repeat' });
        return;
      }
      seen.add(fingerprint);
      const check = checkChosenFile({ name, size: file.size, type: file.type }, this.options.rules);
      if (!check.ok) {
        added.push({ ...base, state: 'unsupported', message: check.reason });
        return;
      }
      this.files.set(id, {
        file,
        contentType: check.contentType,
        shrink: check.shrink === true,
        scope,
      });
      const before = earlier[index];
      if (before === 'added' || before === 'duplicate') {
        added.push({ ...base, state: before, earlier: true });
        return;
      }
      // A file an earlier visit could not confirm (or was sending when the page went) is not sent
      // again on its own: the person checks the documents list first, then chooses Try Again.
      if (before === 'unknown' || before === 'unconfirmed') {
        added.push({ ...base, state: 'unknown', earlier: true });
        return;
      }
      added.push({ ...base, state: this.paused ? 'paused' : 'queued' });
    });
    for (const entry of skipped) {
      added.push({
        ...blank,
        id: this.nextId++,
        name: entry.name,
        path: entry.path,
        size: entry.size,
        lastModified: entry.lastModified,
        fingerprint: fingerprintOf({
          name: entry.name,
          size: entry.size ?? -1,
          lastModified: entry.lastModified,
        }),
        state: 'skipped',
        skipReason: entry.reason,
        uploadId: this.newUploadId(),
      });
    }
    if (added.length === 0) return;
    for (const item of added) this.byId.set(item.id, item);
    this.order = [...this.order, ...added.map((item) => item.id)];
    this.emit();
    this.pump();
  }

  /** No new file is sent; files already on their way finish. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const item of this.byId.values()) {
      if (item.state === 'queued' && !item.waitingToRetry) this.put({ ...item, state: 'paused' });
    }
    this.emit();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const item of this.byId.values()) {
      if (item.state === 'paused') this.put({ ...item, state: 'queued' });
    }
    this.emit();
    this.pump();
  }

  /** Every file not yet sent is listed as not added; files already on their way finish. */
  stop(): void {
    this.generation++;
    this.paused = false;
    this.connectionLost = false;
    const stopped: ImportItem[] = [];
    for (const item of this.byId.values()) {
      if (item.state !== 'queued' && item.state !== 'paused' && item.state !== 'held') continue;
      // A file put back after a send with no answer may already be stored: Not Confirmed, never
      // "not added".
      const next: ImportItem = this.mayBeStored.has(item.id)
        ? { ...item, state: 'unknown', message: '', waitingToRetry: false, progress: 0 }
        : { ...item, state: 'skipped', skipReason: 'stopped', waitingToRetry: false, progress: 0 };
      this.mayBeStored.delete(item.id);
      this.put(next);
      stopped.push(next);
    }
    this.emit();
    for (const item of stopped) this.options.onSettled?.(item);
  }

  /** Try Again on one line: offered only where `canTryAgain` says so. */
  retry(id: number): void {
    const item = this.byId.get(id);
    if (!item || !canTryAgain(item) || !this.files.has(id)) return;
    this.requeue(item);
  }

  /**
   * Send Again on a line an earlier visit added: offered only where `canSendAgain` says so. The
   * person asks for a new copy, so it goes with a new upload id.
   */
  sendAgain(id: number): void {
    const item = this.byId.get(id);
    if (!item || !canSendAgain(item) || !this.files.has(id)) return;
    this.requeue({ ...item, uploadId: this.newUploadId() });
  }

  /** Try Again for All Paused Files: every file held by the hourly limit goes back in line. */
  retryHeld(): void {
    let any = false;
    for (const item of this.byId.values()) {
      if (item.state !== 'held' || !this.files.has(item.id)) continue;
      this.put({
        ...item,
        ...blank,
        shrunkTo: item.shrunkTo,
        state: this.paused ? 'paused' : 'queued',
      });
      any = true;
    }
    if (!any) return;
    this.emit();
    this.pump();
  }

  /** Clears every line that will not change any more. */
  clearFinished(): void {
    for (const id of this.order) {
      const item = this.byId.get(id);
      if (item && FINAL_STATES.has(item.state)) {
        this.byId.delete(id);
        this.files.delete(id);
        this.offlineFreeRetries.delete(id);
      }
    }
    this.order = this.order.filter((id) => this.byId.has(id));
    this.emit();
  }

  /** Resolves once nothing is in flight and nothing is waiting to go (paused and held files wait). */
  async whenIdle(): Promise<void> {
    await this.adding;
    if (this.isIdle()) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private requeue(item: ImportItem): void {
    this.put({
      ...item,
      ...blank,
      shrunkTo: item.shrunkTo,
      state: this.paused ? 'paused' : 'queued',
    });
    this.emit();
    this.pump();
  }

  private isIdle(): boolean {
    if (this.active > 0) return false;
    for (const item of this.byId.values()) if (item.state === 'queued') return false;
    return true;
  }

  /** True only when the page gave a connection and it says there is none. */
  private offline(): boolean {
    const connection = this.options.connection;
    if (!connection) return false;
    try {
      return !connection.isOnline();
    } catch {
      return false;
    }
  }

  /** Marks the queue as waiting for the connection; returns true when that is news. */
  private loseConnection(): boolean {
    if (this.connectionLost) return false;
    this.connectionLost = true;
    return true;
  }

  private pump(): void {
    while (!this.paused && this.active < this.concurrency) {
      const next = this.nextQueued();
      if (!next) break;
      if (this.offline()) {
        if (this.loseConnection()) this.emit();
        break;
      }
      this.active++;
      this.update(next.id, { state: 'uploading', progress: 0 });
      void this.run(next.id);
    }
    if (this.isIdle()) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  private nextQueued(): ImportItem | undefined {
    for (const id of this.order) {
      const item = this.byId.get(id);
      if (item?.state === 'queued' && !item.waitingToRetry) return item;
    }
    return undefined;
  }

  private async run(id: number): Promise<void> {
    const generation = this.generation;
    try {
      if (!this.files.has(id)) {
        this.settle(id, { state: 'unknown' });
        return;
      }
      for (;;) {
        // The connection went while this file waited out a busy answer: it waits for it instead.
        if (this.offline()) {
          this.waitForConnection(id, this.byId.get(id)?.attempts ?? 0, generation);
          return;
        }
        const attempts = (this.byId.get(id)?.attempts ?? 0) + 1;
        this.update(id, { attempts, progress: 0, state: 'uploading', waitingToRetry: false });
        const sending = this.byId.get(id);
        const beforeSend = this.options.beforeSend;
        // A large photo is made smaller inside its turn at the gate, so sends still start in queue
        // order and only one photo is being made smaller at a time.
        const shrinking = this.files.get(id)?.shrink === true;
        const shrunk: { failure: ShrinkFailure | null } = { failure: null };
        if ((sending && beforeSend) || shrinking || this.options.rules.shrinkPhotos === true) {
          const turn = this.startGate.then(async () => {
            if (shrinking) shrunk.failure = await this.shrinkOne(id);
            if (shrunk.failure || !sending || !beforeSend) return;
            try {
              await beforeSend(sending);
            } catch {
              // The saved list is a convenience; the upload goes ahead without it.
            }
          });
          this.startGate = turn;
          await turn;
        }
        const notShrunk = shrunk.failure;
        if (notShrunk) {
          this.settle(id, {
            state: 'unsupported',
            preparing: false,
            message: photoNotShrunkMessage(
              notShrunk,
              this.options.rules.limitLabel,
              this.options.rules.pdfAccepted,
            ),
          });
          if (notShrunk === 'unreadable') {
            reportUploadProblem({
              route: 'upload',
              reason: 'unreadable',
              status: 0,
              redirected: false,
              ms: 0,
            });
          }
          return;
        }
        const held = this.files.get(id);
        if (!held) {
          this.settle(id, { state: 'unknown' });
          return;
        }
        let outcome: UploadOutcome;
        try {
          outcome = await this.send({
            applicantId: this.options.applicantId,
            file: held.file,
            contentType: held.contentType,
            uploadId: sending?.uploadId ?? this.newUploadId(),
            fileName: sending?.name ?? '',
            scope: held.scope,
            onProgress: (fraction) => this.progress(id, fraction),
          });
        } catch {
          outcome = { kind: 'unknown' };
        }
        // No answer while the device has no connection: with upload receipts the same id is safe
        // to send again, so the file waits for the connection and this attempt is not counted.
        const freeRetries = this.offlineFreeRetries.get(id) ?? 0;
        if (
          outcome.kind === 'unknown' &&
          this.options.retryUnknown === true &&
          this.offline() &&
          freeRetries < MAX_OFFLINE_FREE_RETRIES
        ) {
          this.offlineFreeRetries.set(id, freeRetries + 1);
          this.mayBeStored.add(id);
          this.waitForConnection(id, attempts - 1, generation);
          return;
        }
        // Any other no-answer send that will go again on its own may also be stored already.
        if (outcome.kind === 'unknown') this.mayBeStored.add(id);
        // No answer: sent again on its own only when the server keeps upload receipts, so the
        // repeat (same id) is answered with the copy already stored, never a second one.
        const retryingUnknown =
          outcome.kind === 'unknown' &&
          this.options.retryUnknown === true &&
          attempts < this.maxAttempts;
        if (outcome.kind !== 'busy' && !retryingUnknown) {
          this.settle(id, outcomeChange(outcome));
          return;
        }
        if (outcome.kind !== 'busy') {
          // It may have been stored, so it is never listed as not added: Stop or Pause during the
          // wait leaves it unknown, with Try Again (same id) for the person.
          this.update(id, { waitingToRetry: true, progress: 0 });
          await this.wait(
            retryDelayMs(
              null,
              attempts,
              this.options.baseDelayMs ?? BASE_DELAY_MS,
              this.options.maxDelayMs ?? MAX_DELAY_MS,
            ),
          );
          if (this.generation !== generation || this.paused) {
            this.settle(id, { state: 'unknown', message: '', progress: 0 });
            return;
          }
          continue;
        }
        const message = outcome.message ?? '';
        const asked = outcome.retryAfterSeconds;
        if (asked !== null && asked > AUTO_RETRY_LIMIT_SECONDS) {
          this.holdAll(id, message);
          return;
        }
        if (attempts >= this.maxAttempts) {
          this.settle(id, { state: 'refused', busy: true, message });
          return;
        }
        // Nothing was stored, so Stop and Pause can take this file back safely.
        if (this.generation !== generation) {
          this.settle(id, { state: 'skipped', skipReason: 'stopped', progress: 0 });
          return;
        }
        if (this.paused) {
          this.update(id, { state: 'paused', progress: 0 });
          this.options.onSettled?.(this.byId.get(id) as ImportItem);
          return;
        }
        this.update(id, { state: 'queued', waitingToRetry: true, progress: 0 });
        await this.wait(
          retryDelayMs(
            asked,
            attempts,
            this.options.baseDelayMs ?? BASE_DELAY_MS,
            this.options.maxDelayMs ?? MAX_DELAY_MS,
          ),
        );
        // Stop already listed it as not added (it was waiting, not in flight).
        if (this.generation !== generation) return;
        if (this.paused) {
          this.update(id, { state: 'paused', waitingToRetry: false });
          return;
        }
      }
    } finally {
      this.active--;
      this.pump();
    }
  }

  /**
   * Makes one large photo smaller (P2) and keeps the smaller copy in place of the original for this
   * and every later attempt. Called inside the photo's turn at the start gate. Returns why it
   * could not be done, or null when the smaller copy is ready.
   */
  private async shrinkOne(id: number): Promise<ShrinkFailure | null> {
    const held = this.files.get(id);
    if (!held) return 'unreadable';
    this.update(id, { preparing: true });
    const shrink = this.options.shrink ?? shrinkPhoto;
    let shrunk: ShrinkOutcome;
    try {
      shrunk = await shrink(held.file as File, this.options.rules.limitBytes);
    } catch {
      shrunk = { ok: false, reason: 'unreadable' };
    }
    if (!shrunk.ok) return shrunk.reason;
    this.files.set(id, {
      file: shrunk.file,
      contentType: shrunk.file.type,
      shrink: false,
      scope: held.scope,
    });
    this.update(id, { preparing: false, shrunkTo: shrunk.toBytes });
    return null;
  }

  /**
   * Puts a file back in line to wait for the connection, with the attempts it had before. Stop
   * since it started leaves it Not Confirmed (it may have been stored), never quietly waiting.
   */
  private waitForConnection(id: number, attempts: number, generation: number): void {
    if (this.generation !== generation) {
      this.settle(id, { state: 'unknown', message: '', progress: 0 });
      return;
    }
    this.loseConnection();
    this.update(id, {
      state: this.paused ? 'paused' : 'queued',
      attempts,
      progress: 0,
      waitingToRetry: false,
    });
    // As after a busy answer: a paused file that was certainly not stored has an ending for now, so
    // the saved list hears of it. One that may be stored stays "sending" there (Not Confirmed).
    if (this.paused && !this.mayBeStored.has(id)) {
      this.options.onSettled?.(this.byId.get(id) as ImportItem);
    }
  }

  /** The hourly limit: this file and every file still waiting are held, nothing more is sent. */
  private holdAll(id: number, message: string): void {
    for (const item of this.byId.values()) {
      if (item.id !== id && (item.state === 'queued' || item.state === 'paused')) {
        this.put({ ...item, state: 'held', waitingToRetry: false, progress: 0 });
      }
    }
    this.settle(id, { state: 'held', message, progress: 0 });
  }

  /** Progress changes nothing else, so it is drawn at most once per interval. */
  private progress(id: number, fraction: number): void {
    const item = this.byId.get(id);
    const progress = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
    if (!item || item.progress === progress) return;
    this.put({ ...item, progress });
    if (this.progressTimer !== null) return;
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      this.emit();
    }, this.progressIntervalMs);
  }

  private settle(id: number, change: Partial<ImportItem>): void {
    this.mayBeStored.delete(id);
    this.update(id, { waitingToRetry: false, ...change });
    const item = this.byId.get(id);
    // A smaller copy of a photo is only kept for a retry; once the file is stored it is let go.
    if (item?.shrunkTo != null && (item.state === 'added' || item.state === 'duplicate')) {
      this.files.delete(id);
    }
    if (item) this.options.onSettled?.(item);
  }

  private put(item: ImportItem): void {
    this.byId.set(item.id, item);
  }

  private update(id: number, change: Partial<ImportItem>): void {
    const item = this.byId.get(id);
    if (!item) return;
    this.put({ ...item, ...change });
    this.emit();
  }

  private makeSnapshot(): ImportSnapshot {
    return {
      order: this.order,
      byId: this.byId,
      paused: this.paused,
      waitingForConnection: this.connectionLost && !this.paused && this.hasQueued(),
      version: this.version,
    };
  }

  private hasQueued(): boolean {
    for (const item of this.byId.values()) if (item.state === 'queued') return true;
    return false;
  }

  private emit(): void {
    this.version++;
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }
}

function outcomeChange(outcome: Exclude<UploadOutcome, { kind: 'busy' }>): Partial<ImportItem> {
  if (outcome.kind === 'added') {
    return {
      state: outcome.removableCopyId ? 'duplicate' : 'added',
      progress: 100,
      message: outcome.message,
      title: outcome.title,
      removableCopyId: outcome.removableCopyId ?? null,
      documentId: outcome.documentId ?? null,
    };
  }
  if (outcome.kind === 'refused') {
    return { state: 'refused', message: outcome.message, upgrade: outcome.upgrade ?? null };
  }
  return { state: 'unknown', message: '' };
}

/** Counts for the summary line. */
export interface ImportCounts {
  readonly total: number;
  readonly added: number;
  readonly needLook: number;
  readonly notSupported: number;
  readonly waiting: number;
  readonly held: number;
  readonly skipped: number;
}

export function countItems(items: Iterable<Pick<ImportItem, 'state'>>): ImportCounts {
  let total = 0;
  let added = 0;
  let needLook = 0;
  let notSupported = 0;
  let waiting = 0;
  let held = 0;
  let skipped = 0;
  for (const { state } of items) {
    total++;
    if (state === 'added' || state === 'duplicate') added++;
    else if (state === 'refused' || state === 'unknown') needLook++;
    else if (state === 'unsupported') notSupported++;
    else if (state === 'skipped') skipped++;
    else if (state === 'held') held++;
    else waiting++;
  }
  return { total, added, needLook, notSupported, waiting, held, skipped };
}
