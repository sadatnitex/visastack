import Link from 'next/link';

/**
 * Shown on the public route information pages when the stored information cannot be read
 * right now (for example while the database is down). It says so plainly, says nothing was
 * lost, and points at the official sources, because a person planning a trip should not be
 * left on a bare error screen.
 */
export function TrustUnavailable({ withinPage = false }: { readonly withinPage?: boolean } = {}) {
  const Heading = withinPage ? 'h2' : 'h1';
  return (
    <section className="section container">
      <article className="card" aria-labelledby="trust-unavailable-title">
        <p className="card-kicker">Route Information</p>
        <Heading className="card-title" id="trust-unavailable-title">
          Route information is not available right now
        </Heading>
        <p className="card-body">
          We could not load this page. This is on our side, and nothing you entered anywhere is
          affected. Please try again in a few minutes. For an urgent question about a visa, use the
          official website of the country you are applying to.
        </p>
        <div className="cta-row u-mt-100">
          <Link className="btn btn-primary" href="/trust">
            Try Again
          </Link>
          <Link className="btn btn-secondary" href="/">
            Back to Home
          </Link>
        </div>
      </article>
    </section>
  );
}
