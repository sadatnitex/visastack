'use server';

import {
  agencyCollectionPrincipal,
  collectionResponseAccess,
  previewCollectionResponseVersion,
} from '@visastack/services';
import { redirect } from 'next/navigation';
import { reportServerError } from '../../../../../lib/server-error';
import { withSession } from '../../../../../lib/session';
import { createStorage } from '../../../../../lib/storage';

function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Open a safe preview of one exact file version a traveller chose in their answer (UMPE P7). The
 * agency admin is re-checked live, the answer must be this agency's and not withdrawn, and the
 * version must be one the answer lists; the link it opens is checked again when it is used.
 * Anything else lands back on the request page, the same way for every refusal.
 */
export async function previewResponseFileAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const responseId = String(formData.get('responseId') ?? '');
  const documentVersionId = String(formData.get('documentVersionId') ?? '');
  const back = `/app/agency/${encodeURIComponent(organizationId)}/collection/request?id=${encodeURIComponent(requestId)}&file=unavailable#collection-responses`;
  const accessTokenSecret = readEnv('BLOB_SIGNING_SECRET');
  const url = await withSession(async ({ db, accountId }) => {
    if (!accessTokenSecret) return null;
    const scope = await agencyCollectionPrincipal(db, accountId, organizationId);
    if (!scope.ok) return null;
    const access = await collectionResponseAccess(db, scope.value, responseId);
    if (!access.ok) return null;
    try {
      const ref = await previewCollectionResponseVersion(db, createStorage(db), access.value, {
        documentVersionId,
        accessTokenSecret,
      });
      return ref.ok ? ref.value.url : null;
    } catch (error) {
      reportServerError('collectionResponsePreview', error, { step: 'preview failed' });
      return null;
    }
  });
  redirect(url ?? back);
}
