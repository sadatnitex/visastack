import type { Metadata } from 'next';

/** The browser tab and history name this page (WCAG 2.4.2); the layout adds the product name. */
export const metadata: Metadata = { title: 'Page Not Found' };

/**
 * The 404 for a signed-in page. It lives inside the signed-in area, so the menu stays on screen
 * when a link is out of date, instead of dropping the person onto the public page. It says the
 * same thing for a record that is gone and for one this person may not open, so it never hints
 * which of the two it was. Plain anchors: a full navigation also clears any half-loaded state.
 */
export default function WorkspaceNotFound() {
  return (
    <section className="section container center">
      <span className="eyebrow">Not Found</span>
      <h1 className="section-title" style={{ margin: '0.5rem 0 0' }}>
        We Couldn't Find That Page
      </h1>
      <p className="section-sub" style={{ margin: '0.75rem auto 1.5rem', maxWidth: '34rem' }}>
        The link may be out of date, or the record may have been removed or revoked. Check the
        address, or head back to your overview.
      </p>
      <div className="cta-row" style={{ justifyContent: 'center' }}>
        <a className="btn btn-primary" href="/app">
          Go to Your Overview
        </a>
        <a className="btn btn-secondary" href="/app/help#contact">
          Get Help
        </a>
      </div>
    </section>
  );
}
