import { parseCalendarExportOptions } from '@visastack/core/calendar';
import {
  CALENDAR_FILE_NAME,
  buildIcsCalendar,
  selectCalendarEvents,
} from '../../../../../../lib/ics';
import { fromThisSite } from '../../../../../../lib/same-site';
import { exportCalendarDates, readCalendarKeys } from '../load';

/**
 * The calendar file for the dates the traveller chose (v1.2 B05). A POST from the calendar page's
 * own form, so a long choice never makes a long address. It changes no record; it writes one
 * audit entry (count and kinds only) once the file is built, and sends no file without it. Owner-only through
 * the access gate. The file is rebuilt here from the server's own items: only the chosen keys and
 * the options come from the request, both parsed by the one parser each. A key that is not one
 * of this person's items now (another person's, made up, or finished since the preview) is left
 * out without saying anything about it; if none is left, the person goes back to the page.
 */
export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

function backTo(id: string, error: 'nothing' | 'failed'): Response {
  return new Response(null, {
    status: 303,
    headers: {
      ...PRIVATE,
      Location: `/app/applicant/${encodeURIComponent(id)}/calendar?error=${error}`,
    },
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
  const keys = form ? readCalendarKeys(form) : [];
  const options = parseCalendarExportOptions(form ?? new FormData());
  const exported = await exportCalendarDates(id, (dates) => {
    const { events } = selectCalendarEvents(dates.items, keys, options);
    // The file is built here, before the audit entry, so an entry always means a file was made.
    // The entry names only what the file holds: its count and its kinds of date.
    return {
      ics: events.length > 0 ? buildIcsCalendar(events) : '',
      eventCount: events.length,
      kinds: events.map((event) => event.source.kind),
    };
  });
  if (exported.state === 'denied') {
    return new Response('not found', { status: 404, headers: PRIVATE });
  }
  if (exported.state === 'failed') return backTo(id, 'failed');
  // Back to the page with a plain message; nothing from the request is echoed.
  if (exported.state === 'empty') return backTo(id, 'nothing');

  return new Response(exported.chosen.ics, {
    status: 200,
    headers: {
      ...PRIVATE,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${CALENDAR_FILE_NAME}"`,
    },
  });
}
