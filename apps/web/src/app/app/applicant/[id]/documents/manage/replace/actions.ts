'use server';

import {
  accountPrincipal,
  listReplacementOptions,
  replaceDocument,
  requireAccess,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { documentTypeLabel } from '../../../../../../../lib/labels';
import { withSession } from '../../../../../../../lib/session';
import { pdfUploadsAccepted } from '../../../../../../../lib/upload-preflight';
import { replacedMessage } from './messages';

/** One document the person can choose as the newer one, as the Replace flow shows it. */
export interface ReplaceCandidateView {
  readonly documentId: string;
  readonly name: string;
  /** ISO date-time the document was added. */
  readonly uploadedAt: string;
  /** Checked and readable; false while the safety check is still running. */
  readonly ready: boolean;
}

export type ReplaceOptionsResult =
  | {
      readonly ok: true;
      /** The kind's catalogue key, for the upload, or '' when the kind is not known. */
      readonly docType: string;
      /** The kind as people read it ("Passport"), or null when not known. */
      readonly kindLabel: string | null;
      readonly candidates: readonly ReplaceCandidateView[];
      readonly cases: readonly { readonly missionId: string; readonly title: string }[];
      /** Whether PDF files can be added here (they need a real virus scanner). */
      readonly pdfAccepted: boolean;
    }
  | { readonly ok: false; readonly message: string };

export type ReplaceResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string };

const NOT_ALLOWED = 'You can replace only your own documents.';

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
    { purpose: 'owner_document_replace' },
  );
  if (!access.ok || access.value.applicant.id !== applicantId) return null;
  return access.value;
}

function refusalMessage(code: string, message: string): string {
  if (code === 'forbidden') return NOT_ALLOWED;
  if (code === 'not_found')
    return 'That document is no longer here. Refresh the page and try again.';
  if (message.includes('still being checked')) {
    return 'The newer document is still being checked. Try again in a moment.';
  }
  if (message.includes('same kind')) return 'Choose a document of the same kind.';
  if (message.includes('cannot replace itself'))
    return 'Choose a different document as the newer one.';
  if (message.includes('already been replaced') || message.includes('itself been replaced')) {
    return 'One of these documents was replaced already. Refresh the page to see the latest.';
  }
  return 'This document cannot be replaced right now. Refresh the page and try again.';
}

/** What the Replace flow needs for one document: the possible newer ones and the cases it updates. */
export async function replaceOptionsAction(
  applicantId: string,
  documentId: string,
): Promise<ReplaceOptionsResult> {
  return withSession(async ({ db, accountId }) => {
    const access = await manageProof(db, accountId, applicantId, documentId);
    if (!access) return { ok: false, message: NOT_ALLOWED };
    const options = await listReplacementOptions(access, { oldDocumentId: documentId });
    if (!options.ok) {
      return { ok: false, message: refusalMessage(options.error.code, options.error.message) };
    }
    return {
      ok: true,
      docType: options.value.docType ?? '',
      kindLabel: options.value.docType ? documentTypeLabel(options.value.docType) : null,
      candidates: options.value.candidates.map((candidate) => ({
        documentId: candidate.documentId,
        name: candidate.name,
        uploadedAt: candidate.uploadedAt.toISOString(),
        ready: candidate.ready,
      })),
      cases: options.value.cases.map((c) => ({ missionId: c.missionId, title: c.title })),
      pdfAccepted: pdfUploadsAccepted(),
    };
  });
}

/** Replace With a Newer Document: links the old document to the chosen newer one. */
export async function replaceDocumentAction(
  applicantId: string,
  oldDocumentId: string,
  newDocumentId: string,
): Promise<ReplaceResult> {
  const result = await withSession(async ({ db, accountId }): Promise<ReplaceResult> => {
    const access = await manageProof(db, accountId, applicantId, oldDocumentId);
    if (!access) return { ok: false, message: NOT_ALLOWED };
    const replaced = await replaceDocument(access, { oldDocumentId, newDocumentId });
    if (!replaced.ok) {
      return { ok: false, message: refusalMessage(replaced.error.code, replaced.error.message) };
    }
    return { ok: true, message: replacedMessage(replaced.value.cases.length) };
  });
  if (result.ok) revalidatePath(`/app/applicant/${applicantId}/documents`);
  return result;
}
