import { NextResponse } from 'next/server';
import {
  COLLECT_COOKIE,
  COLLECT_COOKIE_OPTIONS,
  COLLECT_COOKIE_SECONDS,
  COLLECT_PAGE,
  collectSwitchOn,
  openLinkIntoSession,
} from '../load';

export const dynamic = 'force-dynamic';

/**
 * The first visit to an agency's request link (UMPE P6, P8): the token arrives in the address once
 * and is exchanged for a server-side desk session; the browser keeps only the session's random id
 * in an httpOnly, Secure, SameSite=Lax cookie, and is sent on to `/collect` with no token, so the
 * token never stays in the address bar, the history, a Referer or a cookie. A live session of the
 * same link on this device is kept. Every closed link answers the same way.
 */
export async function GET(request: Request): Promise<Response> {
  if (!collectSwitchOn()) return new Response('Not Found', { status: 404 });
  const token = new URL(request.url).searchParams.get('token');
  const current = cookieValue(request.headers.get('cookie'));
  const opened = await openLinkIntoSession(request.headers, token, current);
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: opened.state === 'busy' ? COLLECT_PAGE.busyHref : COLLECT_PAGE.href,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
  if (opened.state === 'open') {
    if (opened.rawSessionId) {
      response.cookies.set(COLLECT_COOKIE, opened.rawSessionId, {
        ...COLLECT_COOKIE_OPTIONS,
        maxAge: COLLECT_COOKIE_SECONDS,
      });
    }
  } else {
    // Closed or busy: an older session must not stand in for this link.
    response.cookies.set(COLLECT_COOKIE, '', { ...COLLECT_COOKIE_OPTIONS, maxAge: 0 });
  }
  return response;
}

function cookieValue(header: string | null): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COLLECT_COOKIE) return rest.join('=');
  }
  return undefined;
}
