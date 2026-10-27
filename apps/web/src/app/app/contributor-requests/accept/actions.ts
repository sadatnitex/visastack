'use server';

import { createHash } from 'node:crypto';
import type { AddDocumentVersionResult } from '@visastack/services';
import {
  abandonContributorSubmission,
  beginContributorSubmission,
  completeContributorSubmission,
  enqueueIntakeJob,
  failUpload,
  finalizeUpload,
  loadUploadQuotaConfig,
  mbLabel,
  registerDocumentWithVersion,
  reserveUpload,
} from '@visastack/services';
import { after } from 'next/server';
import { withSession } from '../../../../lib/session';
import { createStorage } from '../../../../lib/storage';
import { triggerIntakeAndReading } from '../../../api/jobs/process-ai-reading/run';

export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * CAS-08's one action: claim the single-use request, then run the exact
 * same reserve -> blob write -> verify -> register+version -> finalize ->
 * scan pipeline `apps/web/.../applicant/[id]/actions.ts`'s own
 * `uploadDocumentAction` uses, substituting the contributor's own claimed
 * request for ownership. Every failure branch below releases the upload
 * reservation (`failUpload`) AND the contributor's own claim
 * (`abandonContributorSubmission`) so a contributor whose attempt merely
 * failed - a bad file, a transient storage error - is never permanently
 * locked out by a token their own attempt already consumed.
 */
export async function submitContributorEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get('token') ?? '');
  const allowWalletReuse = formData.get('allowWalletReuse') === 'true';
  const file = formData.get('file');
  if (token.length === 0) return { ok: false, message: 'Missing request token.' };
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a file to upload.' };
  }

  const quotaConfig = loadUploadQuotaConfig();
  if (file.size > quotaConfig.maxUploadBytes) {
    return {
      ok: false,
      message: `File exceeds the ${mbLabel(quotaConfig.maxUploadBytes)} upload limit.`,
    };
  }

  const contentType = file.type || 'application/octet-stream';
  const originalName = file.name || 'document';

  return withSession(async ({ db, accountId, email }) => {
    const begun = await beginContributorSubmission(db, {
      rawToken: token,
      actorAccountId: accountId,
      actorEmail: email,
      allowWalletReuse,
    });
    if (!begun.ok) return { ok: false, message: begun.error.message } satisfies ActionState;
    const request = begun.value;

    const reservation = await reserveUpload(
      db,
      { accountId, applicantId: request.applicantId, sizeBytes: file.size },
      quotaConfig,
    );
    if (!reservation.ok) {
      await abandonContributorSubmission(db, request.id);
      return { ok: false, message: reservation.error.message } satisfies ActionState;
    }
    const intent = reservation.value;
    const storage = createStorage(db);

    const outcome = await (async (): Promise<
      { ok: true; version: AddDocumentVersionResult } | { ok: false; message: string }
    > => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength !== file.size) {
          await failUpload(
            db,
            intent.id,
            `declared size ${file.size} did not match actual bytes read ${bytes.byteLength}`,
          );
          return { ok: false, message: 'Upload failed: the file changed while uploading.' };
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');

        try {
          await storage.putObject({
            objectKey: intent.objectKey,
            bucket: 'QUARANTINE',
            contentType,
            bytes,
          });
        } catch (error) {
          await failUpload(db, intent.id, error instanceof Error ? error.message : String(error));
          return { ok: false, message: 'Upload failed while storing the file. Please try again.' };
        }

        const verification = await storage.getObject(intent.objectKey);
        if (!verification || verification.bytes.byteLength !== bytes.byteLength) {
          await storage.deleteObject('QUARANTINE', intent.objectKey).catch(() => undefined);
          await failUpload(
            db,
            intent.id,
            'stored object failed verification immediately after write',
          );
          return { ok: false, message: 'Upload failed verification. Please try again.' };
        }

        const created = await registerDocumentWithVersion(db, {
          actorAccountId: accountId,
          applicantId: request.applicantId,
          originalName,
          docType: request.docType,
          source: 'CONTRIBUTOR',
          bucket: 'QUARANTINE',
          objectKey: intent.objectKey,
          sizeBytes: bytes.byteLength,
          sha256,
          walletVisible: allowWalletReuse,
          onBehalfOfContributorRequestId: request.id,
        });
        if (!created.ok) {
          await storage.deleteObject('QUARANTINE', intent.objectKey).catch(() => undefined);
          await failUpload(db, intent.id, created.error.message);
          return { ok: false, message: created.error.message };
        }
        return { ok: true, version: created.value };
      } catch (error) {
        await storage.deleteObject('QUARANTINE', intent.objectKey).catch(() => undefined);
        await failUpload(db, intent.id, error instanceof Error ? error.message : String(error));
        return { ok: false, message: 'Upload failed unexpectedly. Please try again.' };
      }
    })();

    if (!outcome.ok) {
      await abandonContributorSubmission(db, request.id);
      return { ok: false, message: outcome.message } satisfies ActionState;
    }

    await enqueueIntakeJob(db, { documentVersionId: outcome.version.version.id });
    await finalizeUpload(db, intent.id, outcome.version.version.id);
    after(() => triggerIntakeAndReading());

    const completed = await completeContributorSubmission(db, {
      contributorRequestId: request.id,
      documentId: outcome.version.version.documentId,
    });
    if (!completed.ok) {
      return { ok: false, message: completed.error.message } satisfies ActionState;
    }

    return {
      ok: true,
      message: 'Thank you - your document was submitted and queued for a safety scan.',
    } satisfies ActionState;
  });
}
