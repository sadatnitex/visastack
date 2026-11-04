'use server';

import {
  EACH_GRANT,
  accountPrincipal,
  downloadEvidenceSubmissionFile,
  isUuid,
  listEvidenceSubmissions,
  requireAccess,
} from '@visastack/services';
import { redirect } from 'next/navigation';
import { reportServerError } from '../../../../lib/server-error';
import { withSession } from '../../../../lib/session';
import { establishStepUpProof } from '../../../../lib/step-up';
import { createStorage } from '../../../../lib/storage';
import { loadEvidenceRequestPage, loadOrgAccess } from './console-data';

function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Download the original of one exact copy a traveller sent in answer to an evidence request (Lane
 * E). Like every original download it needs a fresh identity check: at once when the sign-in is
 * recent, otherwise the admin confirms it is them and comes back to the request.
 *
 * What this action takes from the page is only three ids. The request is read again here as this
 * organization's own request, the copy is looked up on it (the page's word is never used for which
 * file version to open), and the service re-checks the agency admin, the organization's standing
 * and that this is the copy still waiting or the one accepted. Delivery stays on this deployment's
 * authorization route: the address is followed only when it is under /api/blob/, and is never
 * shown, stored or returned. Every refusal lands on the same page the same way, with no reason.
 */
export async function downloadEvidenceCopyAction(formData: FormData): Promise<void> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const submissionId = String(formData.get('submissionId') ?? '');
  const ids = isUuid(organizationId) && isUuid(requestId) && isUuid(submissionId);
  const base = ids ? `/app/agency/${organizationId}/clients` : '/app';
  const page = ids ? `${base}?request=${requestId}#request-${requestId}` : '/app';
  const back = ids ? `${base}?request=${requestId}&file=unavailable#request-${requestId}` : '/app';
  const accessTokenSecret = readEnv('BLOB_SIGNING_SECRET');
  const url = await withSession(async ({ db, accountId }) => {
    if (!ids || !accessTokenSecret) return null;
    try {
      const orgAccess = await loadOrgAccess(db, accountId, organizationId);
      if (!orgAccess?.admin) return null;
      const found = await loadEvidenceRequestPage(db, accountId, organizationId, orgAccess, {
        limit: 1,
        only: requestId,
      });
      const request = found.items[0];
      if (!request || request.id !== requestId || request.kind !== 'DOCUMENT') return null;
      const proof = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        request.missionId ? { missionId: request.missionId } : { applicantId: request.applicantId },
        { purpose: EACH_GRANT, actingFor: { organizationId } },
      );
      if (!proof.ok) return null;
      const listed = await listEvidenceSubmissions(proof.value, { requestId });
      if (!listed.ok) return null;
      const copy = listed.value.submissions.find((s) => s.id === submissionId);
      if (!copy?.fileAvailable) return null;
      const stepUp = await establishStepUpProof(
        { accountId, action: 'DOWNLOAD_ORIGINAL', resourceId: copy.documentVersionId },
        page,
      );
      if (stepUp.kind === 'reauth_required') return stepUp.reauthUrl;
      if (stepUp.kind !== 'proof') return null;
      const ref = await downloadEvidenceSubmissionFile(createStorage(db), proof.value, {
        submissionId,
        accessTokenSecret,
        stepUp: stepUp.proof,
      });
      if (!ref.ok) return null;
      // Keep delivery on this deployment's authorization route, never an upstream bearer URL.
      const target = new URL(ref.value.url, 'https://visastack.invalid');
      return target.pathname.startsWith('/api/blob/') ? `${target.pathname}${target.search}` : null;
    } catch (error) {
      reportServerError('evidenceCopyDownload', error, { step: 'download failed' });
      return null;
    }
  });
  redirect(url ?? back);
}
