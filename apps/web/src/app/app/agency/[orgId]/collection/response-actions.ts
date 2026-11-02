'use server';

import {
  agencyCollectionPrincipal,
  collectionResponseAccess,
  downloadCollectionResponseVersion,
} from '@visastack/services';
import { redirect } from 'next/navigation';
import { reportServerError } from '../../../../../lib/server-error';
import { withSession } from '../../../../../lib/session';
import { establishStepUpProof } from '../../../../../lib/step-up';
import { createStorage } from '../../../../../lib/storage';

function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Download the original of one exact file version a traveller chose in their answer (UMPE P7).
 * Like every original download it needs a fresh identity check (at once when the sign-in is
 * recent, otherwise the admin confirms it is them and comes back to the request). The agency admin
 * is re-checked live, the answer must be this agency's, unchanged and not withdrawn, and the version
 * must be one the answer lists; the link is checked again when it is used. Anything else lands back
 * on the request page, the same way for every refusal.
 */
export async function downloadResponseFileAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const responseId = String(formData.get('responseId') ?? '');
  const documentVersionId = String(formData.get('documentVersionId') ?? '');
  const page = `/app/agency/${encodeURIComponent(organizationId)}/collection/request?id=${encodeURIComponent(requestId)}`;
  const back = `${page}&file=unavailable#collection-responses`;
  const accessTokenSecret = readEnv('BLOB_SIGNING_SECRET');
  const url = await withSession(async ({ db, accountId }) => {
    if (!accessTokenSecret) return null;
    const scope = await agencyCollectionPrincipal(db, accountId, organizationId);
    if (!scope.ok) return null;
    const access = await collectionResponseAccess(db, scope.value, responseId);
    if (!access.ok) return null;
    const stepUp = await establishStepUpProof(
      { accountId, action: 'DOWNLOAD_ORIGINAL', resourceId: documentVersionId },
      page,
    );
    if (stepUp.kind === 'reauth_required') return stepUp.reauthUrl;
    if (stepUp.kind !== 'proof') return null;
    try {
      const ref = await downloadCollectionResponseVersion(db, createStorage(db), access.value, {
        documentVersionId,
        accessTokenSecret,
        stepUp: stepUp.proof,
      });
      return ref.ok ? ref.value.url : null;
    } catch (error) {
      reportServerError('collectionResponsePreview', error, { step: 'preview failed' });
      return null;
    }
  });
  redirect(url ?? back);
}
