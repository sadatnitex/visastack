/**
 * True when a form was sent from this site: the Origin header's host is the host the request was
 * made to. A browser always sends Origin with a form POST; a missing or "null" one is refused, so
 * another site cannot make a person's browser start a download or an action here.
 */
export function fromThisSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwarded || request.headers.get('host') || new URL(request.url).host;
  return originHost === host;
}
