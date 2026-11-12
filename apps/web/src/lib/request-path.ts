import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { PATHNAME_REQUEST_HEADER } from './request-headers';

/**
 * The address the middleware passed on for this request (see `request-headers.ts`). With no
 * request to read (a unit test, a static render) the answer is none. Next's own signals (dynamic
 * rendering, redirects, not-found) keep travelling; anything else falls back to none, so a layout
 * never fails over a first-paint improvement.
 */
export async function requestedPath(): Promise<string | null> {
  try {
    return (await headers()).get(PATHNAME_REQUEST_HEADER);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
