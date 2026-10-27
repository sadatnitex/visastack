import { outputFileName } from '@visastack/services';
import { fromThisSite } from '../../../../../../lib/same-site';
import { deliverOutput, outputsPath } from '../load';
import { parseOutputRequest, requestParams } from '../query';

/**
 * The file for a summary the person previewed (v1.2 B10, B11, B12, E04). A POST from the page's own
 * form, so a long choice never makes a long address. The file is made again here from the record as
 * it is now, and is handed over only if it is the very summary that was previewed: if the record
 * or the choices changed in between, the person goes back to the page to preview again and no
 * different packet is delivered in silence. One audit entry (kind and size, never the content) is
 * written before the file is returned, and when it cannot be written no file is sent. Owner only
 * through the access gate; anyone else gets "not found". Nothing from the request is echoed.
 */
export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

function backTo(
  id: string,
  request: ReturnType<typeof parseOutputRequest>,
  error: string,
): Response {
  const params = requestParams(request);
  params.set('error', error);
  return new Response(null, {
    status: 303,
    headers: { ...PRIVATE, Location: `${outputsPath(id)}?${params.toString()}` },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!fromThisSite(request)) {
    return new Response('forbidden', { status: 403, headers: PRIVATE });
  }
  const { id } = await params;
  let form: FormData | null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  const parsed = parseOutputRequest(form ?? new FormData());
  // A download always follows a preview: what the file holds is what the preview held.
  const asked = { ...parsed, previewed: true };
  const delivered = await deliverOutput(id, asked);

  switch (delivered.state) {
    case 'denied':
      return new Response('not found', { status: 404, headers: PRIVATE });
    case 'reauth':
      return new Response(null, { status: 303, headers: { ...PRIVATE, Location: delivered.url } });
    case 'not_configured':
    case 'failed':
      return backTo(id, asked, 'failed');
    case 'changed':
      return backTo(id, asked, 'changed');
    case 'nothing':
      return backTo(id, asked, 'nothing');
    case 'file':
      return new Response(delivered.body, {
        status: 200,
        headers: {
          ...PRIVATE,
          'Content-Type': delivered.contentType,
          'Content-Disposition': `attachment; filename="${outputFileName(asked.template, delivered.format, delivered.preparedOn)}"`,
        },
      });
  }
}
