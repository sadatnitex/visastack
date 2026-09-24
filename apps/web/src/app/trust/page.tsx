import { listPublicTrustPublished } from '@visastack/services';
import Link from 'next/link';
import { withPublicDb } from '../../lib/public-db';

export const dynamic = 'force-dynamic';

/**
 * Public Trust Lite catalog (RUL-06, directive §9). Lists routes, never
 * agencies -- a neutral index by route name is not the "agency ranking"
 * the directive forbids. Genuinely public: no session, no auth.
 */
export default async function PublicTrustCatalogPage() {
  const routes = await withPublicDb((db) => listPublicTrustPublished(db));

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
