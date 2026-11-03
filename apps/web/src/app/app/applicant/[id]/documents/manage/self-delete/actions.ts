'use server';

import {
  SELF_DELETE_REFUSALS,
  type SelfDeleteImpact,
  accountPrincipal,
  deleteMyFile,
  previewDeleteMyFile,
  requireAccess,
} from '@visastack/services';
import { after } from 'next/server';
import { documentRemovalRequestsOn, documentSelfDeleteOn } from '../../../../../../../lib/env';
import { triggerErasureWorker } from '../../../../../../../lib/jobs';
import { isRecordId } from '../../../../../../../lib/record-id';
import { withSession } from '../../../../../../../lib/session';
import {
  STEP_UP_NOT_CONFIGURED_MESSAGE,
  tryEstablishStepUp,
} from '../../../../../../../lib/step-up';
import {
  ASK_US_INSTEAD,
  CHANGED,
  GONE,
  NOT_ALLOWED,
  SIGN_IN_AGAIN,
  SWITCHED_OFF,
  TYPE_THE_WORD,
  deletedLine,
} from './messages';

export type SelfDeletePreviewResult =
  | {
      readonly ok: true;
      readonly impact: SelfDeleteImpact;
      /** Deleting will ask for a fresh sign-in first. */
      readonly needsFreshSignIn: boolean;
    }
  | { readonly ok: false; readonly message: string };

export type SelfDeleteResult =
  | { readonly ok: true; readonly message: string }
  /** `stale`: what the file touches changed since the screen was read; read it again. */
  | { readonly ok: false; readonly message: string; readonly stale?: true }
  /** The session is too old for this: go to `signInHref`, which returns to this confirmation. */
  | { readonly ok: false; readonly message: string; readonly signInHref: string };

const SWITCHED_OFF_RESULT = { ok: false, message: SWITCHED_OFF } as const;

/** The owner's MANAGE proof for one document of `applicantId`, from the signed-in session. */
async function manageProof(
  db: Parameters<typeof requireAccess>[0],
  accountId: string,
  applicantId: string,
  documentId: string,
) {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { documentId },
    { purpose: 'owner_document_self_delete' },
  );
  if (!access.ok || access.value.applicant.id !== applicantId) return null;
  return access.value;
}

/** The person's words for each refusal the service gives (SELF_DELETE_REFUSALS). */
function refusalWords(code: string, message: string): { text: string; stale: boolean } {
  const said = (text: string) => ({ text, stale: false });
  const askUs = documentRemovalRequestsOn() ? ` ${ASK_US_INSTEAD}` : '';
  if (code === 'forbidden') return said(NOT_ALLOWED);
  if (code === 'not_found') return said(GONE);
  if (code === 'rate_limited') {
    return said('You have deleted several files in the last hour. Try again later.');
  }
  switch (message) {
    case SELF_DELETE_REFUSALS.stale:
      return { text: CHANGED, stale: true };
    case SELF_DELETE_REFUSALS.alreadyGone:
    case SELF_DELETE_REFUSALS.notLive:
      return said('This file is already in Recently Deleted or being removed. Refresh the page.');
    case SELF_DELETE_REFUSALS.legalHold:
      return said(
        'We have to keep this file for now because of a legal requirement, so it cannot be deleted.',
      );
    case SELF_DELETE_REFUSALS.finishedCase:
      return said(`A finished case used this file, so it is kept with that case.${askUs}`);
    case SELF_DELETE_REFUSALS.agencyAnswer:
      return said(`This file answered a request from an agency, so it is kept.${askUs}`);
    case SELF_DELETE_REFUSALS.word:
      return said(TYPE_THE_WORD);
    case SELF_DELETE_REFUSALS.unavailable:
      return said(SWITCHED_OFF);
    default:
      return said('This file cannot be deleted right now. Refresh the page and try again.');
  }
}

/** What deleting this file will do: the counts to show, and whether a fresh sign-in comes first. */
export async function selfDeletePreviewAction(
  applicantId: string,
  documentId: string,
): Promise<SelfDeletePreviewResult> {
  if (!documentSelfDeleteOn()) return SWITCHED_OFF_RESULT;
  if (!isRecordId(applicantId) || !isRecordId(documentId)) return { ok: false, message: GONE };
  return withSession(async ({ db, accountId }): Promise<SelfDeletePreviewResult> => {
    const access = await manageProof(db, accountId, applicantId, documentId);
    if (!access) return { ok: false, message: NOT_ALLOWED };
    const preview = await previewDeleteMyFile(access, { documentId });
    if (!preview.ok) {
      return { ok: false, message: refusalWords(preview.error.code, preview.error.message).text };
    }
    return { ok: true, ...preview.value };
  });
}

/**
 * Delete My File. The switch, the owner's proof and the typed word are all checked here on the
 * server (the service checks the word and the proof again); the fresh sign-in is asked for only
 * when the service says the file is shared or an open case uses it. After the commit the erasure
 * worker is started at once; the daily run stays the backstop.
 */
export async function selfDeleteAction(
  applicantId: string,
  documentId: string,
  typed: string,
  confirmed: SelfDeleteImpact,
): Promise<SelfDeleteResult> {
  if (!documentSelfDeleteOn()) return SWITCHED_OFF_RESULT;
  if (!isRecordId(applicantId) || !isRecordId(documentId)) return { ok: false, message: GONE };
  if (typeof typed !== 'string') return { ok: false, message: TYPE_THE_WORD };
  const result = await withSession(async ({ db, accountId }): Promise<SelfDeleteResult> => {
    const access = await manageProof(db, accountId, applicantId, documentId);
    if (!access) return { ok: false, message: NOT_ALLOWED };
    let deleted = await deleteMyFile(access, {
      documentId,
      typed,
      confirmed,
      stepUpSatisfied: false,
    });
    if (!deleted.ok && deleted.error.code === 'step_up_required') {
      // Back to this same screen after the sign-in check, with the file's confirmation open.
      const stepUp = await tryEstablishStepUp(
        { accountId, action: 'DELETE_DOCUMENT', resourceId: documentId },
        `/app/applicant/${applicantId}/documents?manage=${documentId}&action=DELETE_MY_FILE`,
      );
      if (stepUp.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE };
      }
      if (stepUp.kind === 'reauth_required') {
        // Returned, not thrown: the confirmation navigates itself, so nothing is left half-awaited.
        return { ok: false, message: SIGN_IN_AGAIN, signInHref: stepUp.reauthUrl };
      }
      deleted = await deleteMyFile(access, { documentId, typed, confirmed, stepUpSatisfied: true });
    }
    if (!deleted.ok) {
      const words = refusalWords(deleted.error.code, deleted.error.message);
      return words.stale
        ? { ok: false, message: words.text, stale: true }
        : { ok: false, message: words.text };
    }
    return { ok: true, message: deletedLine(deleted.value.documentCode, deleted.value.removal) };
  });
  // The files are destroyed and checked in seconds; the daily run only backs this up.
  if (result.ok) after(() => triggerErasureWorker({ limit: 5 }));
  return result;
}
