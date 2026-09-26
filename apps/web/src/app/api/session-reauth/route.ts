import { getSignInUrl } from '@workos-inc/authkit-nextjs';

/**
 * `getSignInUrl` (WorkOS SDK) sets a PKCE cookie as a side effect of
 * computing the URL -- legal only in a Server Action or Route Handler, never
 * during a Server Component render (Next.js: "Cookies can only be modified
 * in a Server Action or Route Handler"). `enforceSessionAgeLimit`
 * (`../../../../lib/session-age.ts`) runs on every protected page's render
 * via `withSession`, so it cannot call `getSignInUrl` directly -- it builds
 * a link here instead, and this genuinely-legal Route Handler makes the
 * real call, then forwards the browser on to WorkOS.
 *
 * `returnTo` never becomes an off-app redirect: only a same-origin relative
 * path is accepted, and anything else falls back to `/app` -- regardless of
 * what a caller supplies, before it ever reaches the WorkOS sign-in flow.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const maxAge = Number(params.get('maxAge'));
  const requestedReturnTo = params.get('returnTo');
  const returnTo =
    requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//')
      ? requestedReturnTo
      : '/app';
  const reauthUrl = await getSignInUrl({
    ...(Number.isFinite(maxAge) && maxAge > 0 ? { maxAge } : {}),
    returnTo,
  });
  return Response.redirect(reauthUrl, 302);
}
