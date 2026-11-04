/**
 * Sending one file from the upload form (UX-B). Each file goes in its own request to the
 * same-origin raw-body route (/api/documents/upload), which runs every server check (ownership,
 * quota and rate limit, file checks, iPhone photo conversion, storage, the safety scan and the
 * reading that follow) through the same upload action as before. A request per file is what
 * lets the form show how far each one has got and give each its own result.
 */

import { type UpgradeLineKind, isUpgradeLineKind } from '../components/upgrade-line';
import { isRecordId } from './record-id';

export type UploadOutcome =
  /**
   * The server added it; `title` is the name it is listed under. `removableCopyId` is set when it
   * is an exact copy of a document already kept, so Remove This New Copy can be offered (LC-C).
   */
  | {
      readonly kind: 'added';
      readonly message: string;
      readonly title: string | null;
      readonly removableCopyId?: string;
      /** The new document's id, when the server sent one. */
      readonly documentId?: string;
    }
  /**
   * The server answered no, with its reason, and the line to add when a paid plan would give more
   * room (ADR 0025 section 12.2).
   */
  | { readonly kind: 'refused'; readonly message: string; readonly upgrade?: UpgradeLineKind }
  /**
   * Turned away for now before anything was stored (HTTP 429 or 503): busy, or the hourly upload
   * limit. `retryAfterSeconds` is how long the server asked to wait, when it said.
   */
  | {
      readonly kind: 'busy';
      readonly message: string | null;
      readonly retryAfterSeconds: number | null;
    }
  /** No usable answer came back: the file may or may not have arrived. */
  | { readonly kind: 'unknown' };

/** The part of `XMLHttpRequest` this needs, so tests can stand in for it. */
export interface UploadRequest {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  timeout: number;
  readonly status: number;
  readonly responseText: string;
  /** Where the answer came from (after any redirect); optional so a stand-in may leave it out. */
  readonly responseURL?: string;
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null };
  /** Reads a response header (Retry-After); optional so a stand-in may leave it out. */
  getResponseHeader?(name: string): string | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  onabort: (() => void) | null;
}

/** Why a file ended as "not confirmed", in words the server's log can hold. Never a name or a value. */
export const UPLOAD_PROBLEM_REASONS = [
  'network',
  'timeout',
  'abort',
  'unreadable',
  'not_json',
  'server_error',
] as const;
export type UploadProblemReason = (typeof UPLOAD_PROBLEM_REASONS)[number];

export interface UploadProblem {
  readonly route: 'upload' | 'hold';
  readonly reason: UploadProblemReason;
  /** The HTTP status, or 0 when no answer came back. */
  readonly status: number;
  /** True when the answer came from a different address than the one asked (a redirect). */
  readonly redirected: boolean;
  /** Milliseconds from sending to the end. */
  readonly ms: number;
}

/**
 * Tells the server, once, that a file ended with no usable answer, so a failure that never reached
 * the upload code still leaves a reason in the server log. Best effort: it must never throw or
 * hold the file's line up.
 */
export function reportUploadProblem(problem: UploadProblem): void {
  try {
    if (typeof fetch !== 'function') return;
    void fetch('/api/documents/upload-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(problem),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // A report that cannot be sent is simply not sent.
  }
}

function wasRedirected(request: UploadRequest, route: string): boolean {
  try {
    if (!request.responseURL) return false;
    return new URL(request.responseURL, 'https://placeholder.invalid').pathname !== route;
  } catch {
    return false;
  }
}

export interface SendFileInput {
  readonly applicantId: string;
  readonly file: Blob;
  /** The type to send it as (from `checkChosenFile`), so a file the browser left untyped still gets one. */
  readonly contentType: string;
  /** The kind of document chosen for it, or ''. */
  readonly docType: string;
  /** The name of an "Other" kind, or ''. */
  readonly subject: string;
  /** Called with the share of the file sent so far, from 0 to 1. */
  readonly onProgress: (fraction: number) => void;
  /**
   * This file's upload id (UMPE P3): minted once per file and sent on every attempt, so the server
   * answers a repeat with the document the first attempt stored instead of storing a second copy.
   */
  readonly uploadId?: string;
  /** The file's own name, kept privately on the server to suggest a readable name. */
  readonly fileName?: string;
  /**
   * UMPE G1: `hold` sends the file to the family batch route instead, where it waits for the
   * account's Which Person? decision and is filed under nobody until then.
   */
  readonly route?: 'upload' | 'hold';
  readonly createRequest?: () => UploadRequest;
}

/** A slow phone connection can take minutes for a few megabytes; past this the answer is unknown. */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** What a person reads when their phone will not let the file be read. */
export const UPLOAD_UNREADABLE_LINE =
  'Your phone would not let us read this file. It may be kept online only. Save it to your phone, or take a photo of it, then add it again.';

/**
 * The file's bytes copied into memory. A file handed over by a phone's file picker can stop being
 * readable once the page has it (kept online only, moved, or changed), which makes the browser
 * drop the upload at once with no answer. Copying first sends a plain in-memory copy instead, and
 * when the copy cannot be made the person gets the real reason. A browser without `arrayBuffer`
 * sends the file as it is.
 */
async function copyIntoMemory(file: Blob): Promise<Blob | null> {
  if (typeof file.arrayBuffer !== 'function') return file;
  try {
    return new Blob([await file.arrayBuffer()], { type: file.type });
  } catch {
    return null;
  }
}

export async function sendDocumentFile(input: SendFileInput): Promise<UploadOutcome> {
  const copy = await copyIntoMemory(input.file);
  if (!copy) {
    reportUploadProblem({
      route: input.route === 'hold' ? 'hold' : 'upload',
      reason: 'unreadable',
      status: 0,
      redirected: false,
      ms: 0,
    });
    return { kind: 'refused', message: UPLOAD_UNREADABLE_LINE };
  }
  return sendBlob(input, copy);
}

function sendBlob(input: SendFileInput, body: Blob): Promise<UploadOutcome> {
  return new Promise((settle) => {
    const request = input.createRequest
      ? input.createRequest()
      : (new XMLHttpRequest() as unknown as UploadRequest);
    const route = input.route === 'hold' ? 'hold' : 'upload';
    const started = Date.now();
    const resolve = (outcome: UploadOutcome, reason?: UploadProblemReason) => {
      if (outcome.kind === 'unknown' && reason) {
        reportUploadProblem({
          route,
          reason,
          status: reason === 'server_error' || reason === 'not_json' ? request.status : 0,
          redirected: wasRedirected(request, `/api/documents/${route}`),
          ms: Math.min(600_000, Math.max(0, Date.now() - started)),
        });
      }
      settle(outcome);
    };
    request.open(
      'POST',
      `/api/documents/${route}?applicantId=${encodeURIComponent(input.applicantId)}`,
    );
    request.setRequestHeader('Content-Type', input.contentType);
    if (input.docType)
      request.setRequestHeader('X-Document-Kind', encodeURIComponent(input.docType));
    if (input.subject)
      request.setRequestHeader('X-Document-Name', encodeURIComponent(input.subject));
    if (input.uploadId) request.setRequestHeader('X-Upload-Id', input.uploadId);
    if (input.fileName) request.setRequestHeader('X-File-Name', encodeURIComponent(input.fileName));
    request.timeout = UPLOAD_TIMEOUT_MS;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) input.onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      let retryAfter: string | null = null;
      try {
        retryAfter = request.getResponseHeader?.('Retry-After') ?? null;
      } catch {
        retryAfter = null;
      }
      resolve(
        readAnswer(request.status, request.responseText, retryAfter),
        request.status >= 500 ? 'server_error' : 'not_json',
      );
    };
    request.onerror = () => resolve({ kind: 'unknown' }, 'network');
    request.ontimeout = () => resolve({ kind: 'unknown' }, 'timeout');
    request.onabort = () => resolve({ kind: 'unknown' }, 'abort');
    request.send(body);
  });
}

/**
 * Seconds to wait from a Retry-After value (whole seconds, or an HTTP date), or null when there is
 * none or it cannot be read.
 */
export function retryAfterSeconds(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const date = Date.parse(text);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

/** The server's own line from a JSON body, or null. */
function messageOf(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { message } = parsed as { message?: unknown };
    return typeof message === 'string' && message.trim() !== '' ? message : null;
  } catch {
    return null;
  }
}

/**
 * What the route said. Anything that is not its own JSON answer (a sign-in page, a host error
 * page) is unknown, except HTTP 429 and 503: those turn a request away before it is stored, so
 * they are a definite busy answer whatever the body.
 */
export function readAnswer(
  status: number,
  body: string,
  retryAfter: string | null = null,
): UploadOutcome {
  if (status === 429 || status === 503) {
    return {
      kind: 'busy',
      message: messageOf(body),
      retryAfterSeconds: retryAfterSeconds(retryAfter),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: 'unknown' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { kind: 'unknown' };
  const { message, title, upgrade, removableCopyId, documentId } = parsed as {
    message?: unknown;
    title?: unknown;
    upgrade?: unknown;
    removableCopyId?: unknown;
    documentId?: unknown;
  };
  if (typeof message !== 'string') return { kind: 'unknown' };
  if (status === 201) {
    return {
      kind: 'added',
      message,
      title: typeof title === 'string' ? title : null,
      ...(typeof removableCopyId === 'string' && isRecordId(removableCopyId)
        ? { removableCopyId }
        : {}),
      ...(typeof documentId === 'string' && isRecordId(documentId) ? { documentId } : {}),
    };
  }
  if (status >= 400 && status < 500) {
    return { kind: 'refused', message, ...(isUpgradeLineKind(upgrade) ? { upgrade } : {}) };
  }
  // A server error says nothing certain about whether the file was kept.
  return { kind: 'unknown' };
}
