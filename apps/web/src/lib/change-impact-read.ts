import type { ChangeImpact } from '@visastack/services';

/*
 * The one seam between the What This Change Affects screens and the service that works it out.
 * This file holds the agreed shapes only. The two reads are written when the service functions
 * exist (assessDocumentChangeImpact, assessDetailChangeImpact); until then nothing here runs and
 * no screen calls it.
 */

/**
 * What a read gives a screen: the review, or one of two words.
 * - `refused`: the central gate said no, or the record is not there. The screen shows the same
 *   not-found it shows for any missing record, so a refusal looks exactly like a missing one.
 * - `failed`: the read broke this time. The screen offers to try again.
 */
export type ChangeImpactRead = ChangeImpact | 'refused' | 'failed';

/**
 * What replacing a document means, or (with `replacementDocumentId`, before it is recorded) would
 * mean. Reads as the signed-in person; the ids come from the address and are not trusted.
 */
export type ReadDocumentChangeImpact = (
  applicantId: string,
  documentId: string,
  replacementDocumentId?: string,
) => Promise<ChangeImpactRead>;

/** What the latest change to one confirmed detail means. Reads as the signed-in person. */
export type ReadDetailChangeImpact = (
  applicantId: string,
  factId: string,
) => Promise<ChangeImpactRead>;
