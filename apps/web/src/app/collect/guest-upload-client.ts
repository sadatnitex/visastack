/**
 * Sending one guest file (UMPE P9) to the desk's own upload route, `/collect/upload`, where the
 * httpOnly desk cookie is sent (it is scoped to `/collect`). Same request shape and same answers
 * as the vault upload route, so the P2 import queue drives it unchanged: 201 kept, 4xx refused with
 * a reason, 429 or 503 not now (with Retry-After), anything else unknown.
 */

import {
  type UploadOutcome,
  type UploadRequest,
  readAnswer,
} from '../../lib/document-upload-client';
import type { ImportSend } from '../../lib/import/import-queue';

export const GUEST_UPLOAD_PATH = '/collect/upload';

/** A slow phone connection can take minutes for a few megabytes; past this the answer is unknown. */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export function sendGuestFile(
  input: Parameters<ImportSend>[0],
  createRequest: () => UploadRequest = () => new XMLHttpRequest() as unknown as UploadRequest,
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const request = createRequest();
    request.open('POST', GUEST_UPLOAD_PATH);
    request.setRequestHeader('Content-Type', input.contentType);
    request.setRequestHeader('X-Upload-Id', input.uploadId);
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
      resolve(readAnswer(request.status, request.responseText, retryAfter));
    };
    request.onerror = () => resolve({ kind: 'unknown' });
    request.ontimeout = () => resolve({ kind: 'unknown' });
    request.onabort = () => resolve({ kind: 'unknown' });
    request.send(input.file);
  });
}
