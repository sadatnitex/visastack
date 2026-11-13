'use server';

import {
  DELETE_DUPLICATE_REFUSALS,
  type DuplicateBlockReason,
  RESTORE_REFUSALS,
  accountPrincipal,
  deleteDuplicate,
  getDocumentLifecycle,
  previewDeleteDuplicate,
  requireAccess,
  restoreDeleted,
} from '@visastack/services';
import { isRecordId } from '../../../../../../../lib/record-id';
import { withSession } from '../../../../../../../lib/session';
import { REMOVAL_WORDS as W, type WordedRefusal, said } from '../removal-words';
import { daysLeft } from './messages';

export type DeletePreviewResult =
  | {
      readonly ok: true;
      /** The copy that stays, as the person's list names it. */
      readonly survivorName: string;
      /** The open cases that will switch to the copy that stays. */
      readonly cases: readonly { readonly missionId: string; readonly title: string }[];
      /** ISO date-time removal starts if it is not restored. */
      readonly purgeAfter: string;
    }
  | ({ readonly ok: false; readonly message: string } & Partial<WordedRefusal>);

export type DeleteResult =
  | { readonly ok: true; readonly days: number }
  | ({ readonly ok: false; readonly message: string } & Partial<WordedRefusal>);

export type RestoreInfoResult =
  | { readonly ok: true; readonly days: number }
  | ({ readonly ok: false; readonly message: string } & Partial<WordedRefusal>);

export type RestoreResult =
  | { readonly ok: true }
  | ({ readonly ok: false; readonly message: string } & Partial<WordedRefusal>);

const NOT_ALLOWED = said(W.notOwnerOfRecord);
const GONE = said(W.documentNoLongerHere);

/** The owner's MANAGE proof for `applicantId`, from the signed-in session; null when refused. */
async function manageProof(
  db: Parameters<typeof requireAccess>[0],
  accountId: string,
  applicantId: string,
) {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { applicantId },
    { purpose: 'owner_document_delete' },
  );
  return access.ok ? access.value : null;
}

const BLOCK_MESSAGES: ReadonlyMap<string, DuplicateBlockReason> = new Map(
  (Object.entries(DELETE_DUPLICATE_REFUSALS.blocked) as [DuplicateBlockReason, string][]).map(
    ([reason, message]) => [message, reason] as const,
  ),
);

const BLOCK_WORDS: Readonly<Record<DuplicateBlockReason, WordedRefusal>> = {
  FINISHED_CASE: said(W.copyKeptFinishedCase),
  AGENCY_REQUEST_ANSWER: said(W.copyKeptAgencyAnswer),
  CONTRIBUTOR_HANDOVER: said(W.copyKeptHandover),
  SHARED_BY_NAME: said(W.copyKeptSharedByName),
  LEGAL_HOLD: said(W.copyKeptLegalHold),
};

/** The person's words for a refusal from Delete Duplicate. */
function deleteRefusal(code: string, message: string): WordedRefusal {
  if (code === 'forbidden') return NOT_ALLOWED;
  if (code === 'not_found') return GONE;
  if (code === 'stale') return said(W.copyAlreadyRecentlyDeleted);
  const reason = BLOCK_MESSAGES.get(message);
  if (reason) return BLOCK_WORDS[reason];
  if (message === DELETE_DUPLICATE_REFUSALS.notDuplicate) return said(W.copyNotDuplicate);
  return said(W.copyCannotBeDeletedNow);
}

/** The person's words for a refusal from Restore. */
function restoreRefusal(code: string, message: string): WordedRefusal {
  if (code === 'forbidden') return NOT_ALLOWED;
  if (message === RESTORE_REFUSALS.tooLate) return said(W.restoreTooLate);
  if (message === RESTORE_REFUSALS.notDeleted) return said(W.restoreNotDeleted);
  return GONE;
}

/** What deleting this copy will do: the copy that stays, the cases that switch, the date. */
export async function deletePreviewAction(
  applicantId: string,
  documentId: string,
): Promise<DeletePreviewResult> {
  return withSession(async ({ db, accountId }): Promise<DeletePreviewResult> => {
    const access = await manageProof(db, accountId, applicantId);
    if (!access) return { ok: false, ...NOT_ALLOWED };
    const preview = await previewDeleteDuplicate(access, { documentId });
    if (!preview.ok) {
      return { ok: false, ...deleteRefusal(preview.error.code, preview.error.message) };
    }
    return {
      ok: true,
      survivorName: preview.value.survivorName,
      cases: preview.value.cases.map((c) => ({ missionId: c.missionId, title: c.title })),
      purgeAfter: preview.value.purgeAfter.toISOString(),
    };
  });
}

/**
 * Delete Duplicate, from the Manage menu or as Remove This New Copy right after an upload
 * (`atUpload`). The page is not redrawn here, so the result line and its Undo stay on screen.
 */
export async function deleteDuplicateAction(
  applicantId: string,
  documentId: string,
  atUpload?: boolean,
): Promise<DeleteResult> {
  // A server action's arguments come from the browser: only exactly `true` marks an upload.
  const fromUpload = atUpload === true;
  if (!isRecordId(applicantId) || !isRecordId(documentId)) return { ok: false, ...GONE };
  return withSession(async ({ db, accountId }): Promise<DeleteResult> => {
    const access = await manageProof(db, accountId, applicantId);
    if (!access) return { ok: false, ...NOT_ALLOWED };
    const deleted = await deleteDuplicate(access, { documentId, atUpload: fromUpload });
    if (!deleted.ok) {
      return { ok: false, ...deleteRefusal(deleted.error.code, deleted.error.message) };
    }
    return { ok: true, days: daysLeft(deleted.value.purgeAfter) };
  });
}

/** How many days this deleted copy has left in Recently Deleted. */
export async function restoreInfoAction(
  applicantId: string,
  documentId: string,
): Promise<RestoreInfoResult> {
  return withSession(async ({ db, accountId }): Promise<RestoreInfoResult> => {
    const access = await manageProof(db, accountId, applicantId);
    if (!access) return { ok: false, ...NOT_ALLOWED };
    const lifecycle = await getDocumentLifecycle(db, documentId, access);
    if (lifecycle?.state !== 'RECENTLY_DELETED' || !lifecycle.purgeAfter) {
      return { ok: false, ...restoreRefusal('invalid', RESTORE_REFUSALS.notDeleted) };
    }
    return { ok: true, days: daysLeft(lifecycle.purgeAfter) };
  });
}

/** Undo (right after deleting) or Restore (from the Recently Deleted list). */
export async function restoreDeletedAction(
  applicantId: string,
  documentId: string,
  source: 'UNDO' | 'RECENTLY_DELETED',
): Promise<RestoreResult> {
  // Recorded on the audit trail, so only the two known words are accepted from the browser.
  if (source !== 'UNDO' && source !== 'RECENTLY_DELETED') return { ok: false, ...GONE };
  if (!isRecordId(applicantId) || !isRecordId(documentId)) return { ok: false, ...GONE };
  return withSession(async ({ db, accountId }): Promise<RestoreResult> => {
    const access = await manageProof(db, accountId, applicantId);
    if (!access) return { ok: false, ...NOT_ALLOWED };
    const restored = await restoreDeleted(access, { documentId, source });
    if (!restored.ok) {
      return { ok: false, ...restoreRefusal(restored.error.code, restored.error.message) };
    }
    return { ok: true };
  });
}
