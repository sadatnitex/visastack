'use server';

import {
  accountPrincipal,
  archiveDocument,
  requireAccess,
  restoreDocument,
} from '@visastack/services';
import { unstable_rethrow } from 'next/navigation';
import { withSession } from '../../../../../../../lib/session';

export type ArchiveActionResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly message: string };

/** One answer for every refusal (not signed in as the owner, a guessed id, not available yet). */
const UNAVAILABLE = 'This document is not available to archive or restore right now.';
const IN_RECENTLY_DELETED = 'This document is in Recently Deleted. Restore it from there first.';

async function run(
  change: 'ARCHIVE' | 'RESTORE',
  applicantId: string,
  documentId: string,
): Promise<ArchiveActionResult> {
  if (typeof applicantId !== 'string' || typeof documentId !== 'string') {
    return { ok: false, message: UNAVAILABLE };
  }
  try {
    return await withSession(async ({ db, accountId }) => {
      const access = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { documentId },
        { purpose: change === 'ARCHIVE' ? 'owner_document_archive' : 'owner_document_restore' },
      );
      if (!access.ok || access.value.applicant.id !== applicantId) {
        return { ok: false, message: UNAVAILABLE } satisfies ArchiveActionResult;
      }
      const result =
        change === 'ARCHIVE'
          ? await archiveDocument(documentId, access.value)
          : await restoreDocument(documentId, access.value);
      if (!result.ok) {
        return {
          ok: false,
          message: result.error.code === 'invalid' ? IN_RECENTLY_DELETED : UNAVAILABLE,
        } satisfies ArchiveActionResult;
      }
      return { ok: true, changed: result.value.changed } satisfies ArchiveActionResult;
    });
  } catch (error) {
    // Signing in again (a redirect) goes ahead; anything else is a failed try they can repeat.
    unstable_rethrow(error);
    return { ok: false, message: 'That did not go through. Check your connection and try again.' };
  }
}

/**
 * Archive one document (the owner only). It does not refresh the page itself: the Archive panel
 * keeps its Undo for ten seconds first, then refreshes the list (archive-action.tsx).
 */
export async function archiveDocumentAction(
  applicantId: string,
  documentId: string,
): Promise<ArchiveActionResult> {
  return run('ARCHIVE', applicantId, documentId);
}

/** Bring an archived document back to Current (the owner only). Refreshes like Archive. */
export async function restoreDocumentAction(
  applicantId: string,
  documentId: string,
): Promise<ArchiveActionResult> {
  return run('RESTORE', applicantId, documentId);
}
