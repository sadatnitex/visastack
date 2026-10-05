import { withAuth } from '@workos-inc/authkit-nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Invite-only pilot' };

export const dynamic = 'force-dynamic';

/**
 * Shown to an authenticated WorkOS identity that is not on the controlled
 * pilot's invited/allowlisted set (docs/audits/post-programme-defect-register.md
 * finding #2). Deliberately outside `/app` — `apps/web/src/app/app/layout.tsx`
 * calls `withSession`, which would re-run this exact check and redirect back
 * here, looping. This page only ever reads the session (never provisions an
 * account, never calls `withSession`), so it is reachable regardless of
 * pilot-access outcome.
 *
 * Honest and narrow: never explains why (invitation vs. allowlist vs. a
 * specific denial reason) — only that this pilot is invite-only and this
 * identity is not yet on the list, per "explain why unavailable without
 * exposing internal security detail."
 */
export default async function PilotAccessDeniedPage() {
  let email: string | null = null;
  try {
    const { user } = await withAuth();
    email = user?.email ?? null;
  } catch {
    email = null;
  }

  return (
    <section className="section container center">
      <span className="eyebrow">Controlled pilot</span>
      <h1 className="section-title" style={{ margin: '0.5rem 0 0' }}>
        This pilot is invite-only
      </h1>
      <p className="section-sub" style={{ margin: '0.75rem auto 1.5rem', maxWidth: '34rem' }}>
        {email
          ? `${email} isn't on the invited list for this controlled pilot yet.`
          : "This account isn't on the invited list for this controlled pilot yet."}{' '}
        If you were expecting access, ask the person who invited you to confirm your invitation, or
        try signing in with a different account.
      </p>
      <div className="cta-row" style={{ justifyContent: 'center' }}>
        <form
          action={async () => {
            'use server';
            const { signOut } = await import('@workos-inc/authkit-nextjs');
            await signOut();
          }}
        >
          <button type="submit" className="btn btn-primary">
            Sign out
          </button>
        </form>
        <Link className="btn btn-secondary" href="/">
          Back to home
        </Link>
      </div>
    </section>
  );
}
