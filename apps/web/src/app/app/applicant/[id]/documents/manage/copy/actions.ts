'use server';

import { accountPrincipal, copyDocumentToPerson, requireAccess } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { after } from 'next/server';
import { isRecordId } from '../../../../../../../lib/record-id';
import { withSession } from '../../../../../../../lib/session';
import { createStorage } from '../../../../../../../lib/storage';
import { triggerIntakeAndReading } from '../../../../../../api/jobs/process-ai-reading/run';

export interface KeepCopyState {
  readonly ok: boolean;
  readonly message: string;
  /** The person the copy was kept for, once it is kept (for the link to their documents). */
  readonly targetId?: string;
}

/** One answer for every refusal (not the owner, a guessed id, not available yet). */
const UNAVAILABLE = 'This document is not available to copy right now.';
const NOT_THROUGH = 'That did not go through. Check your connection and try again.';

/**
 * Keeps a copy of one document under another person of the same account (the owner only). Both
 * records are checked on their own with the owner's access, the service decides again which
 * documents may be copied, and the copy goes through the same safety check as any new file. A
 * refusal says why in plain words; anything unexpected is one fixed line, never a technical one.
 */
export async function keepCopyAction(
  _previous: KeepCopyState,
  formData: FormData,
): Promise<KeepCopyState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');
  const targetId = String(formData.get('targetId') ?? '');
  if (!isRecordId(applicantId) || !isRecordId(documentId) || !isRecordId(targetId)) {
    return { ok: false, message: UNAVAILABLE };
  }
  try {
    return await withSession(async ({ db, accountId }) => {
      const source = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { documentId },
        { purpose: 'owner_document_copy' },
      );
      if (!source.ok || source.value.applicant.id.toLowerCase() !== applicantId.toLowerCase()) {
        return { ok: false, message: UNAVAILABLE } satisfies KeepCopyState;
      }
      const target = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { applicantId: targetId },
        { purpose: 'owner_document_copy' },
      );
      if (!target.ok) return { ok: false, message: UNAVAILABLE } satisfies KeepCopyState;
      const result = await copyDocumentToPerson(
        source.value,
        target.value,
        { storage: createStorage(db) },
        { documentId },
      );
      if (!result.ok) {
        // The service words its refusals for a person; any other kind of failure is the fixed line.
        const plain = ['invalid', 'forbidden', 'not_found', 'upstream_error', 'rate_limited'];
        return {
          ok: false,
          message: plain.includes(result.error.code) ? result.error.message : UNAVAILABLE,
        } satisfies KeepCopyState;
      }
      after(() => triggerIntakeAndReading());
      revalidatePath(`/app/applicant/${applicantId}/documents`);
      revalidatePath(`/app/applicant/${target.value.applicant.id}/documents`);
      return {
        ok: true,
        message: `A copy is kept for ${target.value.applicant.displayName}. It is checked for safety first, like any new file.`,
        targetId: target.value.applicant.id,
      } satisfies KeepCopyState;
    });
  } catch (error) {
    // Signing in again (a redirect) goes ahead; anything else is a failed try they can repeat.
    unstable_rethrow(error);
    return { ok: false, message: NOT_THROUGH };
  }
}
