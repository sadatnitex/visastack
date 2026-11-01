/**
 * Sending one file from the upload form (UX-B). Each file goes in its own request to the
 * same-origin raw-body route (/api/documents/upload), which runs every server check (ownership,
 * quota and rate limit, file checks, iPhone photo conversion, storage, the safety scan and the
 * reading that follow) through the same upload action as before. A request per file is what
 * lets the form show how far each one has got and give each its own result.
 */

import { type UpgradeLineKind, isUpgradeLineKind } from '../components/upgrade-line';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    }
  /**
   * The server answered no, with its reason, and the line to add when a paid plan would give more
   * room (ADR 0025 section 12.2).
   */
  | { readonly kind: 'refused'; readonly message: string; readonly upgrade?: UpgradeLineKind }
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
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  onabort: (() => void) | null;
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
  readonly createRequest?: () => UploadRequest;
}

/** A slow phone connection can take minutes for a few megabytes; past this the answer is unknown. */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export function sendDocumentFile(input: SendFileInput): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const request = input.createRequest
      ? input.createRequest()
      : (new XMLHttpRequest() as unknown as UploadRequest);
    request.open(
      'POST',
      `/api/documents/upload?applicantId=${encodeURIComponent(input.applicantId)}`,
    );
    request.setRequestHeader('Content-Type', input.contentType);
    if (input.docType)
      request.setRequestHeader('X-Document-Kind', encodeURIComponent(input.docType));
    if (input.subject)
      request.setRequestHeader('X-Document-Name', encodeURIComponent(input.subject));
    request.timeout = UPLOAD_TIMEOUT_MS;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) input.onProgress(event.loaded / event.total);
    };
    request.onload = () => resolve(readAnswer(request.status, request.responseText));
    request.onerror = () => resolve({ kind: 'unknown' });
    request.ontimeout = () => resolve({ kind: 'unknown' });
    request.onabort = () => resolve({ kind: 'unknown' });
    request.send(input.file);
  });
}

/** What the route said. Anything that is not its own JSON answer (a sign-in page, a host error page) is unknown. */
export function readAnswer(status: number, body: string): UploadOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: 'unknown' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { kind: 'unknown' };
  const { message, title, upgrade, removableCopyId } = parsed as {
    message?: unknown;
    title?: unknown;
    upgrade?: unknown;
    removableCopyId?: unknown;
  };
  if (typeof message !== 'string') return { kind: 'unknown' };
  if (status === 201) {
    return {
      kind: 'added',
      message,
      title: typeof title === 'string' ? title : null,
      ...(typeof removableCopyId === 'string' && UUID.test(removableCopyId)
        ? { removableCopyId }
        : {}),
    };
  }
  if (status >= 400 && status < 500) {
    return { kind: 'refused', message, ...(isUpgradeLineKind(upgrade) ? { upgrade } : {}) };
  }
  // A server error says nothing certain about whether the file was kept.
  return { kind: 'unknown' };
}
