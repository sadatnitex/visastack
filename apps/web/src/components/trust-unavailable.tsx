import Link from 'next/link';

/**
 * Shown on the public route information pages when the stored information cannot be read
 * right now (for example while the database is down). It says so plainly, says nothing was
 * lost, and points at the official sources, because a person planning a trip should not be
 * left on a bare error screen.
 */
export function TrustUnavailable() {
  return (
    <section className="section container">
      <article className="card" aria-labelledby="trust-unavailable-title">
        <p className="card-kicker">Route information</p>
        <h1 className="card-title" id="trust-unavailable-title">
          Route information is not available right now
        </h1>
        <p className="card-body">
          We could not load this page. This is on our side, and nothing you entered anywhere is
          affected. Please try again in a few minutes. For an urgent question about a visa, use the
          official website of the country you are applying to.
        </p>
        <div className="cta-row" style={{ marginTop: '1rem' }}>
          <Link className="btn btn-primary" href="/trust">
            Try again
          </Link>
          <Link className="btn btn-secondary" href="/">
            Back to home
          </Link>
        </div>
      </article>
    </section>
  );
}
