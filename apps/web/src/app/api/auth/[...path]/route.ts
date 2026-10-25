/** Neon Auth's browser-facing endpoints (session reads, email links). */
type Context = { params: Promise<{ path: string[] }> };

/**
 * POST paths the browser may call through this proxy. Everything else is refused.
 *
 * VisaStack's sign-in, sign-up, recovery, reset and confirmation forms are server actions
 * (`app/auth/actions.ts`) that call Neon Auth from the server, where the attempt limits in
 * `lib/auth-throttle.ts` apply; email links arrive as GET. Nothing in the browser posts sign-in or
 * email-sending requests here, so allowing them would only offer a way around those limits.
 * Matching the whole joined path exactly also rejects `..` and encoded tricks that a prefix or
 * deny list would miss. Adding browser-started sign-in (for example social sign-in) means adding
 * its path here deliberately.
 */
const BROWSER_POST_PATHS = new Set(['sign-out']);

export async function GET(request: Request, context: Context): Promise<Response> {
  const { getNeonAuth } = await import('../../../../lib/neon-auth');
  return getNeonAuth()
    .handler()
    .GET(request as never, context);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  if (!BROWSER_POST_PATHS.has((await context.params).path.join('/'))) {
    return new Response('Not found', { status: 404 });
  }
  const { getNeonAuth } = await import('../../../../lib/neon-auth');
  return getNeonAuth()
    .handler()
    .POST(request as never, context);
}
