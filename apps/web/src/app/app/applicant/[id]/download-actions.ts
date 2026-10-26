'use server';

import type { ApplicantId } from '@visastack/core';
import { downloadDocument, getApplicant } from '@visastack/services';
import { redirect } from 'next/navigation';
import { getPlatformCapabilities } from '../../../../lib/capabilities';
import { withSession } from '../../../../lib/session';
import { establishStepUp } from '../../../../lib/step-up';
import { createStorage } from '../../../../lib/storage';

function readEnv(name: string): string | undefined {
  return process.env[name];
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Owner download uses fresh server authentication and the existing revocable delivery tokens. */
export async function downloadOriginalAction(formData: FormData): Promise<void> {
  const applicantId = formData.get('applicantId');
  const documentId = formData.get('documentId');
  if (
    typeof applicantId !== 'string' ||
    typeof documentId !== 'string' ||
    !UUID.test(applicantId) ||
    !UUID.test(documentId)
  )
    redirect('/app');
  const returnTo = `/app/applicant/${applicantId}/documents`;
  if (getPlatformCapabilities().originalDownload !== 'available') {
    redirect(`${returnTo}?download_error=1`);
  }
  const accessTokenSecret = readEnv('BLOB_SIGNING_SECRET');
  const target = await withSession(async ({ db, accountId }) => {
    if (!accessTokenSecret) return null;
    const applicant = await getApplicant(db, applicantId);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    let assurance: Awaited<ReturnType<typeof establishStepUp>>;
    try {
      assurance = await establishStepUp(
        { accountId, action: 'DOWNLOAD_ORIGINAL', resourceId: documentId },
        returnTo,
      );
    } catch {
      // The sign-in check cannot be made right now: say the download failed, not a server error.
      return null;
    }
    if (!assurance.satisfied) redirect(assurance.reauthUrl);
    const ref = await downloadDocument(db, createStorage(db), {
      actor: { kind: 'applicant_owner', applicantId: applicantId as ApplicantId },
      documentId,
      purpose: 'owner_download',
      variant: 'original',
      stepUpSatisfied: true,
      accessTokenSecret,
    });
    if (!ref.ok) return null;
    // Keep delivery on this deployment's authorization route, never an upstream bearer URL.
    const url = new URL(ref.value.url, 'https://visastack.invalid');
    return url.pathname.startsWith('/api/blob/') ? `${url.pathname}${url.search}` : null;
  });
  redirect(target ?? `${returnTo}?download_error=1`);
}
