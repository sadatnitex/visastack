import { type PublicTrustRoute, listPublicTrustPublished } from '@visastack/services';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { Chapter } from '../../components/public-site/scene';
import { TrustCatalogSection } from '../../components/public-trust-routes';
import { PublicTrustStory } from '../../components/public-trust-story';
import { TrustUnavailable } from '../../components/trust-unavailable';
import { primeLocale } from '../../lib/i18n-server';
import type { SearchParamsRecord } from '../../lib/paging';
import { withPublicDb } from '../../lib/public-db';
import { reportServerError } from '../../lib/server-error';

// WP-PUB3 (owner, 17 Nov 2026): the tab is named as the menu names the page. The footer link keeps
// its own catalogue words. The route list below the story keeps its own heading.
export const metadata: Metadata = { title: 'Privacy and Trust' };

export const dynamic = 'force-dynamic';

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
  // The trust story and the unavailable notice read the visitor's language.
  await primeLocale();
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
        <Chapter tone="light" className="p3-ch p3-catalog-chapter">
          <TrustUnavailable withinPage />
        </Chapter>
      </>
    );
  }

  return (
    <>
      <PublicTrustStory />
      <TrustCatalogSection routes={routes} params={params} />
    </>
  );
}
