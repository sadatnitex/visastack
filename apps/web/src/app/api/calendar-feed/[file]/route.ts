import { headers } from 'next/headers';
import { calendarFeedSecretFrom, loadCalendarFeed } from '../../../../lib/calendar-feed';
import { clientAddressFrom } from '../../../../lib/client-address';
import { CALENDAR_FILE_NAME } from '../../../../lib/ics';
import { reportServerError } from '../../../../lib/server-error';

/**
 * A private calendar subscription link (v1.2 B05 live feed, ADR 0016), checked by calendar apps
 * on their own schedule. They cannot sign in, so this needs no session: the secret in the address
 * names the account that made the link, and `loadCalendarFeed` asks the access gate as that
 * account every time. An unknown, stopped or replaced link answers 404, exactly like a made-up
 * one. A temporary problem answers 503, never an empty calendar, so an app keeps the dates it has.
 * Nothing is cached anywhere: a stopped link must stop at once.
 */
export const dynamic = 'force-dynamic';

const PRIVATE = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

function plain(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { ...PRIVATE, 'Content-Type': 'text/plain; charset=utf-8', ...extra },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const secret = calendarFeedSecretFrom(file);
  if (!secret) return plain(404, 'not found');
  try {
    const answer = await loadCalendarFeed(secret, clientAddressFrom(await headers()));
    if (answer.state === 'not_found') return plain(404, 'not found');
    if (answer.state === 'busy') return plain(429, 'too many requests', { 'Retry-After': '3600' });
    return new Response(answer.ics, {
      status: 200,
      headers: {
        ...PRIVATE,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `inline; filename="${CALENDAR_FILE_NAME}"`,
      },
    });
  } catch (error) {
    reportServerError('calendarFeed', error, { step: 'feed failed' });
    return plain(503, 'temporarily unavailable', { 'Retry-After': '900' });
  }
}
