import { NextResponse } from 'next/server';
import {
  COLLECT_COOKIE,
  COLLECT_COOKIE_SECONDS,
  COLLECT_PAGE,
  collectSwitchOn,
  cookieValue,
  loadCollectPage,
} from '../load';

export const dynamic = 'force-dynamic';

/**
 * The first visit to an agency's request link (UMPE P6): the token arrives in the address once,
 * moves into a short-lived httpOnly, Secure, SameSite=Lax cookie bound to the link's id (only
 * while the link is open), and the browser is sent on to `/collect` with no token, so it never stays
 * in the address bar, the history or a Referer. Every link answers the same way.
 */
export async function GET(request: Request): Promise<Response> {
  if (!collectSwitchOn()) return new Response('Not Found', { status: 404 });
  const token = new URL(request.url).searchParams.get('token');
  const page = await loadCollectPage(request.headers, token);
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: COLLECT_PAGE.href,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
  if (page.state === 'open' && token) {
    response.cookies.set(COLLECT_COOKIE, cookieValue(page.view.linkId, token), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/collect',
      maxAge: COLLECT_COOKIE_SECONDS,
    });
  } else if (page.state === 'closed') {
    response.cookies.set(COLLECT_COOKIE, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/collect',
      maxAge: 0,
    });
  }
  return response;
}
