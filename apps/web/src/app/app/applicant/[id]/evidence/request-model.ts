import type { DocumentSummary, EvidenceRequest, TriageDocumentState } from '@visastack/services';
import type { StatusWord } from '../../../../../lib/status-words';
import { AWAITING_SUBMISSION } from './due-label';
import type { RequestItemView } from './request-item';

/** Statuses where the traveller's answer is on the request and the date it was sent is worth showing. */
export const ANSWERED_STATUSES: ReadonlySet<string> = new Set([
  'RECEIVED',
  'UNDER_REVIEW',
  'ACCEPTED',
]);

/**
 * The responding document's latest state, for the Processing and Needs Correction groups. `undefined`
 * when the documents could not be read (the request status alone then decides); `null` when the
 * request names no document, or it is gone, so what was sent can no longer be used.
 */
export function respondingDocumentState(
  request: Pick<EvidenceRequest, 'kind' | 'respondingDocumentId'>,
  documents: readonly DocumentSummary[],
  documentsRead: boolean,
): TriageDocumentState | null | undefined {
  if (request.kind !== 'DOCUMENT' || !documentsRead) return undefined;
  const found = request.respondingDocumentId
    ? documents.find((doc) => doc.id === request.respondingDocumentId)
    : undefined;
  if (!found?.latestVersionId || !found.processingStatus || !found.safetyStatus) return null;
  return { processingStatus: found.processingStatus, safetyStatus: found.safetyStatus };
}

// The names of what is asked live in `request-name.ts`, which holds no server code, so the browser
// measurement fixtures and the review step can use them without the services package.
export { requestName, requestTarget } from './request-name';

/**
 * The word and tone on a request's chip: the labels and colours the agency's own summary uses, so
 * the two screens cannot disagree. Received is blue and never green; only Reviewed is green.
 */
export function requestChip(
  item: Pick<RequestItemView, 'group' | 'statusLabel' | 'tone'>,
): StatusWord {
  return { word: item.statusLabel, tone: item.group === 'RECEIVED' ? 'info' : item.tone };
}

/**
 * Where a request sits in the list. Waiting for You: a reply is due, or the file sent could not be
 * used. Being Checked: the file sent is still being checked. Finished for now: received, reviewed
 * or closed, so a request that needs a reply is never mixed in with them.
 */
export type RequestBucket = 'waiting' | 'checking' | 'finished';

export function requestBucket(
  req: Pick<EvidenceRequest, 'status'>,
  item: Pick<RequestItemView, 'group'>,
): RequestBucket {
  if (AWAITING_SUBMISSION.has(req.status) || item.group === 'NEEDS_CORRECTION') return 'waiting';
  return item.group === 'PROCESSING' ? 'checking' : 'finished';
}
