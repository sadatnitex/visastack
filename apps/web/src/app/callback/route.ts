import { randomUUID } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { selectedIdentityProvider } from '../../lib/identity-selection';
import { reportServerError } from '../../lib/server-error';

/** Old callback links on Neon go to sign-in without exchanging a legacy code. */
export async function GET(request: NextRequest): Promise<Response> {
  if (selectedIdentityProvider() === 'neon_auth') {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url));
  }

  // Keep explicitly selected legacy deployments working until migration is complete.
  const { handleAuth } = await import('@workos-inc/authkit-nextjs');
  return handleAuth({
    returnPathname: '/app',
    onError: async ({ error, request }) => {
      const referenceId = randomUUID().slice(0, 8);
      reportServerError('legacy callback', error, { referenceId });
      const target = new URL('/', request.url);
      target.searchParams.set('auth_error', referenceId);
      return NextResponse.redirect(target);
    },
  })(request);
}
