import type { DocumentSummary, EvidenceRequest, TriageDocumentState } from '@visastack/services';
import { humanizeCode } from '../../../../../lib/format-code';
import { fieldLabel } from '../../../../../lib/master-profile';
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

/** A person-readable name for what is being asked for, never the stored key. */
export function requestTarget(req: {
  readonly kind: string;
  readonly fieldKey?: string | null;
  readonly docType?: string | null;
}): string {
  if (req.kind === 'FIELD') {
    const label = req.fieldKey ? fieldLabel(req.fieldKey) : undefined;
    return label ?? (req.fieldKey ? humanizeCode(req.fieldKey) : 'Not specified');
  }
  return req.docType ? humanizeCode(req.docType) : 'Not specified';
}

/** "Detail: Passport Number" or "Document: Bank Statement". */
export function requestName(req: {
  readonly kind: string;
  readonly fieldKey?: string | null;
  readonly docType?: string | null;
}): string {
  return `${req.kind === 'FIELD' ? 'Detail' : 'Document'}: ${requestTarget(req)}`;
}

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
