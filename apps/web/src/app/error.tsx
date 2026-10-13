'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Route-level error boundary. Next.js renders this instead of the bare
 * "Application error" white screen when a Server Component throws during
 * render. It shows the digest so a failing request can be correlated with the
 * server logs, and offers a retry (which re-runs the failed render) plus a way
 * back out. The real cause is logged server-side in `withSession`.
 */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="section container center">
      <span className="eyebrow">Something went wrong</span>
      <h1 className="section-title error-title">We hit a snag loading this page</h1>
      <p className="section-sub error-body">
        This is on our side, not yours. Everything you already saved is safe. If you were typing
        something, you may need to enter it again. Try again in a moment; if it keeps happening,
        sign out and back in.
      </p>
      <div className="cta-row cta-row-center">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Try again
        </button>
        <Link className="btn btn-secondary" href="/">
          Back to home
        </Link>
      </div>
      {error.digest ? <p className="muted error-reference">Reference: {error.digest}</p> : null}
    </section>
  );
}
