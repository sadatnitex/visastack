import { selectedIdentityProvider } from '../../../../lib/identity-selection';

/**
 * Neon Auth's browser-facing endpoints (sign-in, sign-up, session, verification). Present only
 * when `IDENTITY_PROVIDER=neon_auth`; with WorkOS (the default) every path here is a plain 404,
 * so no part of the Neon surface is exposed by accident.
 */
type Context = { params: Promise<{ path: string[] }> };

const notFound = () => new Response(null, { status: 404 });

export async function GET(request: Request, context: Context): Promise<Response> {
  if (selectedIdentityProvider() !== 'neon_auth') return notFound();
  const { getNeonAuth } = await import('../../../../lib/neon-auth');
  return getNeonAuth()
    .handler()
    .GET(request as never, context);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  if (selectedIdentityProvider() !== 'neon_auth') return notFound();
  const { getNeonAuth } = await import('../../../../lib/neon-auth');
  return getNeonAuth()
    .handler()
    .POST(request as never, context);
}
