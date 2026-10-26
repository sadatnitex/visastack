import {
  CALENDAR_FILE_NAME,
  buildIcsCalendar,
  selectCalendarEvents,
} from '../../../../../../lib/ics';
import { loadCalendarDates, readCalendarSelection } from '../load';

/**
 * The calendar file for the dates the traveller chose (v1.2 B05). Owner-only through the access
 * gate. The file is rebuilt here from the server's own items: only the chosen keys come from the
 * request, and a key that is not one of this person's items is ignored without saying anything
 * about it. Nothing is written.
 */
export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const loaded = await loadCalendarDates(id);
  if (loaded.state === 'denied') {
    return new Response('not found', { status: 404, headers: PRIVATE });
  }
  const back = `/app/applicant/${encodeURIComponent(id)}/calendar`;
  if (loaded.state === 'failed') {
    return new Response(null, {
      status: 303,
      headers: { ...PRIVATE, Location: `${back}?error=failed` },
    });
  }

  const selection = readCalendarSelection(new URL(request.url).searchParams);
  const { events } = selectCalendarEvents(loaded.dates.items, selection.keys, {
    caseNames: selection.caseNames,
  });
  if (events.length === 0) {
    // Back to the page with a plain message; nothing from the request is echoed.
    return new Response(null, {
      status: 303,
      headers: { ...PRIVATE, Location: `${back}?error=nothing` },
    });
  }

  return new Response(buildIcsCalendar(events), {
    status: 200,
    headers: {
      ...PRIVATE,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${CALENDAR_FILE_NAME}"`,
    },
  });
}
