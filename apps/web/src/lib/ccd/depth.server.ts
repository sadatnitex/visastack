import 'server-only';
import { cookies } from 'next/headers';
import {
  DEPTH_COOKIE,
  type DepthChoice,
  type DepthFamily,
  choiceFor,
  parseDepthCookie,
} from './depth';

/**
 * The level this visitor last chose for a screen family, or "auto". Reading the request's
 * cookies is what makes the page render per request, so the saved level is in the first
 * markup and the page does not flash at the wrong depth.
 */
export async function readDepth(family: DepthFamily): Promise<DepthChoice> {
  const store = await cookies();
  return choiceFor(parseDepthCookie(store.get(DEPTH_COOKIE)?.value), family);
}
