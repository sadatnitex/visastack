import {
  type AuthorizedApplicant,
  type ChangeImpact,
  type ServiceError,
  accountPrincipal,
  assessDetailChangeImpact,
  assessDocumentChangeImpact,
  requireAccess,
} from '@visastack/services';
import { unstable_rethrow } from 'next/navigation';
import { withSession } from './session';

/*
 * The one seam between the What This Change Affects screens and the service that works it out.
 * Every screen (the page, the replace flow, the saved-detail line) reads through these two
 * functions, so the access check and the meaning of a refusal are decided once.
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

/** Refusals that mean "not yours, not there, or not a thing that can be asked". */
const REFUSED_CODES: ReadonlySet<ServiceError['code']> = new Set([
  'not_found',
  'forbidden',
  'invalid',
]);

/**
 * One read: its own session and its own pass through the central gate (never a proof borrowed
 * from another piece of work), then the service. It never throws for a failed read: the caller
 * gets a word it can show, so a save or a replacement that already succeeded is never undone by
 * this. Sign-in redirects still travel on.
 */
async function read(
  applicantId: string,
  assess: (access: AuthorizedApplicant<'MANAGE'>) => ReturnType<typeof assessDetailChangeImpact>,
): Promise<ChangeImpactRead> {
  try {
    return await withSession(async ({ db, accountId }): Promise<ChangeImpactRead> => {
      const access = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { applicantId },
        { purpose: 'change_impact' },
      );
      if (!access.ok) return REFUSED_CODES.has(access.error.code) ? 'refused' : 'failed';
      const result = await assess(access.value);
      if (result.ok) return result.value;
      return REFUSED_CODES.has(result.error.code) ? 'refused' : 'failed';
    });
  } catch (error) {
    unstable_rethrow(error);
    return 'failed';
  }
}

export const readDocumentChangeImpact: ReadDocumentChangeImpact = (
  applicantId,
  documentId,
  replacementDocumentId,
) =>
  read(applicantId, (access) =>
    assessDocumentChangeImpact(access, {
      documentId,
      ...(replacementDocumentId ? { replacementDocumentId } : {}),
    }),
  );

export const readDetailChangeImpact: ReadDetailChangeImpact = (applicantId, factId) =>
  read(applicantId, (access) => assessDetailChangeImpact(access, { factId }));
