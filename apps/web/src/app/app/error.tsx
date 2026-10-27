'use client';

import { useEffect } from 'react';

/**
 * Error screen for a signed-in page. Because it lives inside the signed-in area, the menu stays
 * on screen when a page cannot be drawn, so a person can move on instead of being left on a
 * bare page. It promises only what is true: records that were already saved are safe, and
 * anything still being typed may need entering again. "Try Again" re-runs the failed page; the
 * real cause is logged on the server (see `withSession`), and the reference number lets someone
 * find it. Plain anchors are used because a full navigation also clears the broken state.
 */
export default function WorkspaceError({
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
      <span className="eyebrow">Something Went Wrong</span>
      <h1 className="section-title error-title">This page did not load</h1>
      <p className="section-sub error-body">
        The problem is on our side. Everything you already saved is safe. If you were typing
        something, you may need to enter it again.
      </p>
      <div className="cta-row cta-row-center">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Try Again
        </button>
        <a className="btn btn-secondary" href="/app">
          Go to Your Overview
        </a>
      </div>
      <p className="muted error-reference">
        Still happening? <a href="/app/help#contact">Get help</a>
        {error.digest ? ` and quote reference ${error.digest}` : ''}.
      </p>
    </section>
  );
}
