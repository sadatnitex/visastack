import { listPublicTrustPublished } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '../../components/icons';
import { TrustUnavailable } from '../../components/trust-unavailable';
import { withPublicDb } from '../../lib/public-db';
import { reportServerError } from '../../lib/server-error';

export const metadata: Metadata = { title: 'Route information' };

export const dynamic = 'force-dynamic';

/**
 * Public Trust Lite catalog (RUL-06, directive §9). Lists routes, never
 * agencies -- a neutral index by route name is not the "agency ranking"
 * the directive forbids. Genuinely public: no session, no auth.
 */
export default async function PublicTrustCatalogPage() {
  let routes: Awaited<ReturnType<typeof listPublicTrustPublished>>;
  try {
    routes = await withPublicDb((db) => listPublicTrustPublished(db));
  } catch (error) {
    // The public pages stay readable when the database is down: say so plainly (UX-02).
    reportServerError('trust catalog', error);
    return <TrustUnavailable />;
  }

  return (
    <section className="section container">
      <div className="section-head" style={{ marginBottom: '2rem' }}>
        <span className="eyebrow">Public Trust</span>
        <h1 className="section-title" style={{ margin: '0.25rem 0 0.5rem' }}>
          Maintained route information
        </h1>
        <p className="section-sub">
          Source-backed official fees, application channels, and scam-warning guidance for
          maintained visa routes - never an approval guarantee, an embassy endorsement, or an agency
          ranking.
        </p>
      </div>

      <section className="trust-principles" aria-label="Control over your records">
        <article className="card">
          <Icon name="user" size={24} />
          <h2 className="card-title">Your records belong to you</h2>
          <p className="card-body">
            Keep one profile and reuse your documents across applications. Changes are recorded as
            new versions, so you can review their history.
          </p>
        </article>
        <article className="card">
          <Icon name="share" size={24} />
          <h2 className="card-title">Share only what is needed</h2>
          <p className="card-body">
            Choose the recipient, purpose, items and time limit. Access begins after acceptance. You
            can pause or revoke future access, but cannot erase copies already downloaded.
          </p>
        </article>
        <article className="card">
          <Icon name="check" size={24} />
          <h2 className="card-title">You approve suggestions</h2>
          <p className="card-body">
            A suggestion is separate from a confirmed fact. Review it before accepting it. You can
            also enter your details by hand.
          </p>
        </article>
        <article className="card">
          <Icon name="shield" size={24} />
          <h2 className="card-title">Clear privacy choices</h2>
          <p className="card-body">
            Review your permissions and request export or deletion. Legal retention can delay
            deletion. Read the <Link href="/privacy">privacy notice</Link> and{' '}
            <Link href="/terms">terms of use</Link> for the details.
          </p>
        </article>
      </section>

      {routes.length === 0 ? (
        <article className="card">
          <p className="card-body">No routes are currently published here.</p>
        </article>
      ) : (
        <div className="grid">
          {routes.map((route) => (
            <Link className="card" key={route.packKey} href={`/trust/${route.packKey}`}>
              <p className="card-kicker">
                {[route.jurisdiction, route.route].filter(Boolean).join(' · ') || 'Route'}
              </p>
              <h2 className="card-title">{route.packName}</h2>
              <p className="card-body">{route.routeDescription}</p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
