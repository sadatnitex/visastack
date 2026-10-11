import { listPublicTrustPublished } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicTrustStory } from '../../components/public-trust-story';
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
    return (
      <>
        <PublicTrustStory />
        <TrustUnavailable withinPage />
      </>
    );
  }

  return (
    <>
      <PublicTrustStory />
      <section
        className="section container trust-catalog"
        aria-label="Maintained route information"
      >
        <div className="section-head" style={{ marginBottom: '2rem' }}>
          <span className="eyebrow">Public Trust</span>
          <h2 className="section-title" style={{ margin: '0.25rem 0 0.5rem' }}>
            Maintained route information
          </h2>
          <p className="section-sub">
            Source-backed official fees, application channels, and scam-warning guidance for
            maintained visa routes - never an approval guarantee, an embassy endorsement, or an
            agency ranking.
          </p>
        </div>

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
    </>
  );
}
