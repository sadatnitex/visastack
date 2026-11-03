import {
  agencyCollectionPrincipal,
  downloadGuestSubmissionFile,
  guestFileStepUp,
} from '@visastack/services';
import { isRecordId } from '../../../../../../lib/record-id';
import { reportServerError } from '../../../../../../lib/server-error';
import { withSession } from '../../../../../../lib/session';
import { establishStepUpProof } from '../../../../../../lib/step-up';
import { createStorage } from '../../../../../../lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A file name safe for a header: letters, digits and a few marks; anything else becomes `_`. */
function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9 ._()-]/g, '_')
    .trim()
    .slice(0, 150);
  return cleaned.length > 0 ? cleaned : 'document';
}

/**
 * Download one file a guest sent (UMPE P9), only through the guest submission that lists it, by an
 * active owner or admin of this agency, after a fresh sign-in bound to that file (like every
 * original download). The bytes are served from here only when they still match what was sent;
 * every attempt is audited by the service. Started only from this site's own pages. Every refusal
 * lands back on the request page the same way.
 */
export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ orgId: string }> },
): Promise<Response> {
  const { orgId } = await params;
  const url = new URL(request.url);
  const requestId = url.searchParams.get('request') ?? '';
  const submissionId = url.searchParams.get('submission') ?? '';
  const fileId = url.searchParams.get('file') ?? '';
  const page = `/app/agency/${encodeURIComponent(orgId)}/collection/request?id=${encodeURIComponent(requestId)}`;
  const back = Response.redirect(
    new URL(`${page}&file=unavailable#collection-responses`, url),
    303,
  );
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') return back;
  if (![orgId, requestId, submissionId, fileId].every(isRecordId)) return back;
  const self = `/app/agency/${encodeURIComponent(orgId)}/collection/guest-file?request=${encodeURIComponent(requestId)}&submission=${encodeURIComponent(submissionId)}&file=${encodeURIComponent(fileId)}`;
  try {
    const outcome = await withSession(async ({ db, accountId }) => {
      const scope = await agencyCollectionPrincipal(db, accountId, orgId);
      if (!scope.ok) return null;
      const stepUp = await establishStepUpProof(guestFileStepUp({ accountId, fileId }), self);
      if (stepUp.kind === 'reauth_required') return { reauth: stepUp.reauthUrl } as const;
      if (stepUp.kind !== 'proof') return null;
      const file = await downloadGuestSubmissionFile(db, createStorage(db), scope.value, {
        submissionId,
        fileId,
        stepUp: stepUp.proof,
      });
      return file.ok ? ({ file: file.value } as const) : null;
    });
    if (!outcome) return back;
    if ('reauth' in outcome) return Response.redirect(new URL(outcome.reauth, url), 303);
    const { file } = outcome;
    return new Response(Buffer.from(file.bytes), {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${safeFileName(file.filename)}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    reportServerError('collectionGuestFile', error, { step: 'download failed' });
    return back;
  }
}
