import { type PublicTrustRoute, listPublicTrustPublished } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { PublicTrustStory } from '../../components/public-trust-story';
import { ShowMore } from '../../components/show-more';
import { TrustUnavailable } from '../../components/trust-unavailable';
import { type SearchParamsRecord, firstParam, nextShow, parseShow } from '../../lib/paging';
import { withPublicDb } from '../../lib/public-db';
import { reportServerError } from '../../lib/server-error';

export const metadata: Metadata = { title: 'Route Information' };

export const dynamic = 'force-dynamic';

/** Routes shown at first, and how many more each Show More adds (WP-SB8 scroll budget). */
const TRUST_ROUTE_STEP = 12;
const ROUTE_NOUN = { one: 'route', other: 'routes' } as const;
const MAX_QUERY = 80;
const QUERY_KEY = 'q';
const SHOW_KEY = 'show';

/** The search words from `?q=`, trimmed and capped; empty when there are none. */
function searchWords(params: SearchParamsRecord): string {
  return (firstParam(params[QUERY_KEY]) ?? '').trim().slice(0, MAX_QUERY);
}

/** A route matches when its name, country, route type or description holds the search words. */
function matchesSearch(route: PublicTrustRoute, words: string): boolean {
  if (words === '') return true;
  const needle = words.toLocaleLowerCase();
  return [route.packName, route.jurisdiction, route.route, route.routeDescription].some((field) =>
    (field ?? '').toLocaleLowerCase().includes(needle),
  );
}

/**
 * Public Trust Lite catalog (RUL-06, directive §9). Lists routes, never
 * agencies -- a neutral index by route name is not the "agency ranking"
 * the directive forbids. Genuinely public: no session, no auth.
 *
 * WP-SB8: the list shows 12 routes, then a Show More link (`?show=`) that adds 12 at a time,
 * and a search (`?q=`) once there are more than 12. Both work without script. Nothing is lost:
 * the ceiling grows with the list, so every route is reachable by Show More alone.
 */
interface TrustCatalogProps {
  readonly searchParams: Promise<SearchParamsRecord>;
}

// Two signatures: Next.js passes the address (the last signature is the one it checks), and the
// shared page checks call the page with nothing, which reads as the first page with no search.
export default function PublicTrustCatalogPage(): Promise<ReactElement>;
export default function PublicTrustCatalogPage(props: TrustCatalogProps): Promise<ReactElement>;
export default async function PublicTrustCatalogPage(
  props?: TrustCatalogProps,
): Promise<ReactElement> {
  const params: SearchParamsRecord = (await props?.searchParams) ?? {};
  let routes: PublicTrustRoute[];
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
        aria-label="Maintained Route Information"
      >
        <div className="section-head" style={{ marginBottom: '2rem' }}>
          <span className="eyebrow">Public Trust</span>
          <h2 className="section-title" style={{ margin: '0.25rem 0 0.5rem' }}>
            Maintained Route Information
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
          <RouteList routes={routes} params={params} />
        )}
      </section>
    </>
  );
}

function RouteList({
  routes,
  params,
}: {
  readonly routes: readonly PublicTrustRoute[];
  readonly params: SearchParamsRecord;
}) {
  const words = searchWords(params);
  const matches = routes.filter((route) => matchesSearch(route, words));
  // The ceiling is the whole list, rounded up to a step, so Show More can always reach the end.
  const max = Math.max(1, Math.ceil(matches.length / TRUST_ROUTE_STEP)) * TRUST_ROUTE_STEP;
  const shown = parseShow(params[SHOW_KEY], { step: TRUST_ROUTE_STEP, max });
  const visible = matches.slice(0, shown);
  const following =
    matches.length > visible.length ? nextShow(shown, { step: TRUST_ROUTE_STEP, max }) : null;
  const searchable = routes.length > TRUST_ROUTE_STEP || words !== '';

  return (
    <>
      {searchable ? (
        <form className="trust-search" action="/trust" method="get">
          <label className="field">
            <span className="label">Search Routes</span>
            <input
              className="input"
              type="search"
              name={QUERY_KEY}
              defaultValue={words}
              maxLength={MAX_QUERY}
              placeholder="For example: Japan"
            />
          </label>
          <button className="btn btn-secondary" type="submit">
            Search
          </button>
          {words !== '' ? <Link href="/trust">Clear Search</Link> : null}
        </form>
      ) : null}
      {visible.length === 0 ? (
        <article className="card">
          <p className="card-body">No routes match your search. Try another country or route.</p>
        </article>
      ) : (
        <>
          <div className="grid">
            {visible.map((route, index) => (
              <Link
                className="card"
                key={route.packKey}
                id={`trust-route-${index}`}
                href={`/trust/${route.packKey}`}
              >
                <p className="card-kicker">
                  {[route.jurisdiction, route.route].filter(Boolean).join(' · ') || 'Route'}
                </p>
                <h2 className="card-title">{route.packName}</h2>
                <p className="card-body">{route.routeDescription}</p>
              </Link>
            ))}
          </div>
          <ShowMore
            id="trust-routes-more"
            pathname="/trust"
            searchParams={words === '' ? {} : { q: words }}
            next={following === null ? null : { show: following }}
            shown={visible.length}
            total={matches.length}
            noun={ROUTE_NOUN}
            landOn={`trust-route-${visible.length}`}
          />
        </>
      )}
    </>
  );
}
