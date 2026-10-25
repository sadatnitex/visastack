/** Neon Auth's browser-facing endpoints (sign-in, sign-up, session, verification). */
type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { getNeonAuth } = await import('../../../../lib/neon-auth');
  return getNeonAuth()
    .handler()
    .GET(request as never, context);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { getNeonAuth } = await import('../../../../lib/neon-auth');
  return getNeonAuth()
    .handler()
    .POST(request as never, context);
}
