import type { PublicTrustRoute } from '@visastack/services';
import Link from 'next/link';
import { getPageLanguage } from '../lib/i18n-server';
import { type SearchParamsRecord, firstParam, nextShow, parseShow } from '../lib/paging';
import { publicText } from './public-site/public-text';
import { Chapter } from './public-site/scene';
import { ShowMore } from './show-more';

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
 * The route list under the Privacy and Trust story: the section that names it, the search, the
 * route cards and Show More. Server-rendered from the address alone, so it works without script.
 * The page and the page-length fixture both render this, so what is measured is what ships.
 */
export function TrustCatalogSection({
  routes,
  params,
}: {
  readonly routes: readonly PublicTrustRoute[];
  readonly params: SearchParamsRecord;
}) {
  const say = (text: string) => publicText(text, getPageLanguage());
  return (
    <Chapter tone="light" className="p3-ch p3-catalog-chapter">
      <section className="section container trust-catalog" aria-labelledby="trust-catalog-title">
        <div className="section-head">
          <span className="eyebrow">Public Trust</span>
          <h2 id="trust-catalog-title" className="section-title">
            {say('Maintained Route Information')}
          </h2>
          <p className="section-sub">
            {say(
              'Official fees, where to apply and scam warnings for visa routes, each with its source. This is information only: never a promise of approval, an embassy endorsement or a ranking of agencies.',
            )}
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
    </Chapter>
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
                <h3 className="card-title">{route.packName}</h3>
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
