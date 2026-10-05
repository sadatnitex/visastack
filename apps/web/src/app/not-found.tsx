import Link from 'next/link';

/**
 * Global 404. Without this, Next.js falls back to its bare, unstyled default
 * page for any bad or stale link (an old bookmark to a deleted applicant, a
 * revoked share link, a typo) — off-brand and a dead end. This mirrors
 * `error.tsx`'s recoverable-error framing but for "not found" rather than
 * "something broke," with a real way back into the app.
 */
export default function NotFound() {
  return (
    <section className="section container center">
      <span className="eyebrow">Not found</span>
      <h1 className="section-title" style={{ margin: '0.5rem 0 0' }}>
        We couldn't find that page
      </h1>
      <p className="section-sub" style={{ margin: '0.75rem auto 1.5rem', maxWidth: '34rem' }}>
        The link may be out of date, or the record may have been removed or revoked. Check the
        address, or head back to your workspace.
      </p>
      <div className="cta-row" style={{ justifyContent: 'center' }}>
        {/* A plain anchor, like the landing page and the nav: `/app` answers a
            signed-out visitor with a redirect to WorkOS, and a `<Link>` would
            prefetch it with a script request that the browser (and the
            Content-Security-Policy's `connect-src`) refuses to follow
            off-site. Crossing into the signed-in area is a full navigation. */}
        <a className="btn btn-primary" href="/app">
          Go to workspace
        </a>
        <Link className="btn btn-secondary" href="/">
          Back to home
        </Link>
      </div>
    </section>
  );
}
