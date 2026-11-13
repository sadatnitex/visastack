import type { EvidenceSubmissionList } from '@visastack/services';

/**
 * Which copy the agency sent back on a request, read from the decision history. The request itself
 * cannot say: sending a request back clears the answer it points at (that pointer means "what is
 * being reviewed now", which is nothing until the person answers again), so the page used to find
 * no sent-back copy at all. The history keeps every decision with the exact copy it judged.
 *
 * Pure and free of server code so the page, the data read and the tests share it.
 */

/** The outcomes that send an answer back to the traveller. */
const SENT_BACK_OUTCOMES: ReadonlySet<string> = new Set([
  'NEEDS_REPLACEMENT',
  'CONTRADICTION',
  'CORRECTION_PROPOSED',
]);

export interface SentBackCopy {
  /** `exact`: the history pins one version. `document`: only the document is known (an older send). */
  readonly precision: 'exact' | 'document';
  readonly documentId: string;
  /** The exact version that was sent back; null when only the document is known. */
  readonly versionId: string | null;
  readonly versionNumber: number | null;
  /** The file's name when it was sent; null when only the document is known. */
  readonly title: string | null;
  readonly sentAt: Date | null;
  /** What the agency said, or null when it said nothing. */
  readonly reason: string | null;
}

/**
 * What the page knows about the copy sent back. `none`: the request is not waiting on a corrected
 * answer. `unknown`: it was sent back but the history cannot name the copy (it could not be read,
 * or an older send never recorded one); the page then chooses nothing for the person and says so.
 */
export type SentBackRead =
  | { readonly state: 'none' }
  | { readonly state: 'unknown' }
  | { readonly state: 'copy'; readonly copy: SentBackCopy };

/**
 * The newest copy sent back, only while the request is still waiting on a corrected answer. An
 * exact send beats a decision that only names a document, and the newest of either wins.
 */
export function sentBackCopyOf(
  status: string,
  sends: EvidenceSubmissionList | undefined,
): SentBackRead {
  if (status !== 'NEEDS_REPLACEMENT') return { state: 'none' };
  if (!sends) return { state: 'unknown' };
  const exact = [...sends.submissions].reverse().find((send) => SENT_BACK_OUTCOMES.has(send.state));
  const older = [...sends.legacy]
    .reverse()
    .find((send) => SENT_BACK_OUTCOMES.has(send.state) && send.documentId !== null);
  // The newest decision wins. A legacy decision has no send time, so its decision time is used.
  const exactAt = exact?.decidedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const olderAt = older?.decidedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (exact && exactAt >= olderAt) {
    return {
      state: 'copy',
      copy: {
        precision: 'exact',
        documentId: exact.documentId,
        versionId: exact.documentVersionId,
        versionNumber: exact.versionNumber,
        title: exact.title,
        sentAt: exact.sentAt,
        reason: exact.reason,
      },
    };
  }
  if (older?.documentId) {
    return {
      state: 'copy',
      copy: {
        precision: 'document',
        documentId: older.documentId,
        versionId: null,
        versionNumber: null,
        title: null,
        sentAt: older.sentAt,
        reason: null,
      },
    };
  }
  return { state: 'unknown' };
}
