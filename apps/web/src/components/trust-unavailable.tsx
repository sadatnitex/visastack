import Link from 'next/link';
import { trustCatalog } from '../i18n/trust';
import { getServerT } from '../lib/i18n-server';

/**
 * Shown on the public route information pages when the stored information cannot be read
 * right now (for example while the database is down). It says so plainly, says nothing was
 * lost, and points at the official sources, because a person planning a trip should not be
 * left on a bare error screen.
 */
export function TrustUnavailable({ withinPage = false }: { readonly withinPage?: boolean } = {}) {
  const t = getServerT(trustCatalog);
  const Heading = withinPage ? 'h2' : 'h1';
  return (
    <section className="section container">
      <article className="card" aria-labelledby="trust-unavailable-title">
        <p className="card-kicker">{t.node('trust.trustUnavailable.routeInformation')}</p>
        <Heading className="card-title" id="trust-unavailable-title">
          {t.node('trust.trustUnavailable.routeInformationIsNotAvailableRight')}
        </Heading>
        <p className="card-body">{t.node('trust.trustUnavailable.weCouldNotLoadThisPage')}</p>
        <div className="cta-row u-mt-100">
          <Link className="btn btn-primary" href="/trust">
            {t.node('trust.trustUnavailable.tryAgain')}
          </Link>
          <Link className="btn btn-secondary" href="/">
            {t.node('trust.trustUnavailable.backToHome')}
          </Link>
        </div>
      </article>
    </section>
  );
}
